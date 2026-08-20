import json
import re
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app import trips
from app.auth import hash_password, verify_password
from app.config import settings
from app.events import publish
from app.middleware.auth import require_admin_auth

router = APIRouter()

HOUSEHOLD_COLUMNS = "id, name, home_geofence"

# App-enforced caps, not DB constraints — keeps the SOS quick-dial row from growing unbounded.
# 2 general (shown for every category) + 3 per specific category.
GENERAL_CONTACT_CAP = 2
CATEGORY_CONTACT_CAP = 3
SOS_CATEGORIES = {"medical", "security", "suspicious", "car"}

AVATAR_DIR = Path(settings.upload_dir) / "avatars"
AVATAR_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def _household_dict(row) -> dict:
    data = dict(row)
    data["id"] = str(data["id"])
    data["home_geofence"] = json.loads(data["home_geofence"])
    data.pop("admin_password_hash", None)
    return data


class HomeGeofence(BaseModel):
    lat: float
    lng: float
    radius_m: float


# E.164-ish: optional leading +, 7-15 digits — loose enough for real-world numbers (some
# countries' numbers run short) but tight enough to catch typos, stray letters, or a name
# pasted into the wrong field before it ends up silently dead in a tel: link during an actual
# emergency. Stored normalized (punctuation/spacing stripped) so tel: links are always clean.
_PHONE_RE = re.compile(r"^\+?\d{7,15}$")


def _normalize_phone(phone: str) -> str:
    cleaned = re.sub(r"[\s().-]", "", phone)
    if not _PHONE_RE.match(cleaned):
        raise ValueError("Enter a valid phone number (7-15 digits, optional leading +)")
    return cleaned


class CreateEmergencyContact(BaseModel):
    category: str | None = None
    name: str
    phone: str


class UpdateEmergencyContact(BaseModel):
    name: str
    phone: str


class ReorderEmergencyContacts(BaseModel):
    category: str | None = None
    ids: list[int]


class CreateHousehold(BaseModel):
    name: str
    admin_password: str
    home_geofence: HomeGeofence


class CreateMember(BaseModel):
    household_id: str
    display_name: str


class SetMemberDevice(BaseModel):
    device_id: str | None = None


class SetMemberAvatarSeed(BaseModel):
    avatar_seed: str


class UpdateMember(BaseModel):
    display_name: str | None = None
    color: str | None = None


class VerifyPassword(BaseModel):
    password: str


@router.get("/api/setup/household")
async def get_household(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            f"SELECT {HOUSEHOLD_COLUMNS} FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        if household is None:
            return {"success": True, "data": None}

        members = await conn.fetch(
            "SELECT id, display_name, device_id, avatar_filename, avatar_seed, color FROM substrate.members "
            "WHERE household_id = $1",
            household["id"],
        )
        contacts = await conn.fetch(
            "SELECT id, category, name, phone FROM substrate.emergency_contacts "
            "WHERE household_id = $1 ORDER BY sort_order, id",
            household["id"],
        )

    return {
        "success": True,
        "data": {
            **_household_dict(household),
            "members": [{**dict(m), "id": str(m["id"])} for m in members],
            "emergency_contacts": [{**dict(c), "id": str(c["id"])} for c in contacts],
        },
    }


@router.post("/api/setup/household")
async def create_household(body: CreateHousehold, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM substrate.households LIMIT 1")
        if existing is not None:
            raise HTTPException(status_code=409, detail="Household already configured")

        row = await conn.fetchrow(
            f"INSERT INTO substrate.households (name, home_geofence, admin_password_hash) "
            f"VALUES ($1, $2::jsonb, $3) RETURNING {HOUSEHOLD_COLUMNS}",
            body.name,
            body.home_geofence.model_dump_json(),
            hash_password(body.admin_password),
        )

    data = _household_dict(row)
    await publish("household.created", data)
    return {"success": True, "data": data}


@router.post("/api/setup/household/geofence", dependencies=[Depends(require_admin_auth)])
async def update_geofence(body: HomeGeofence, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE substrate.households SET home_geofence = $1::jsonb "
            "WHERE id = (SELECT id FROM substrate.households ORDER BY created_at LIMIT 1) "
            "RETURNING id, name, home_geofence",
            body.model_dump_json(),
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Household not found")

    data = _household_dict(row)
    await publish("household.updated", data)
    return {"success": True, "data": data}


@router.post("/api/setup/emergency-contacts", dependencies=[Depends(require_admin_auth)])
async def create_emergency_contact(body: CreateEmergencyContact, request: Request) -> dict:
    if body.category is not None and body.category not in SOS_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")

    try:
        phone = _normalize_phone(body.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async with request.app.state.db_pool.acquire() as conn:
        household_id = await conn.fetchval(
            "SELECT id FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        if household_id is None:
            raise HTTPException(status_code=404, detail="Household not found")

        cap = GENERAL_CONTACT_CAP if body.category is None else CATEGORY_CONTACT_CAP
        count = await conn.fetchval(
            "SELECT count(*) FROM substrate.emergency_contacts "
            "WHERE household_id = $1 AND category IS NOT DISTINCT FROM $2",
            household_id,
            body.category,
        )
        if count >= cap:
            raise HTTPException(status_code=400, detail=f"Limit of {cap} contacts reached for this category")

        row = await conn.fetchrow(
            "INSERT INTO substrate.emergency_contacts (household_id, category, name, phone, sort_order) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id, category, name, phone",
            household_id,
            body.category,
            body.name,
            phone,
            count,
        )

    data = {**dict(row), "id": str(row["id"])}
    await publish("household.updated", None)
    return {"success": True, "data": data}


@router.post("/api/setup/emergency-contacts/reorder", dependencies=[Depends(require_admin_auth)])
async def reorder_emergency_contacts(body: ReorderEmergencyContacts, request: Request) -> dict:
    # Scoped to `category` as a safety check — only reorders contacts that actually belong to
    # the category the caller claims, so a stale/tampered id list can't silently move a contact
    # into a different group's ordering.
    async with request.app.state.db_pool.acquire() as conn:
        async with conn.transaction():
            for index, contact_id in enumerate(body.ids):
                await conn.execute(
                    "UPDATE substrate.emergency_contacts SET sort_order = $1 "
                    "WHERE id = $2 AND category IS NOT DISTINCT FROM $3",
                    index,
                    contact_id,
                    body.category,
                )

    await publish("household.updated", None)
    return {"success": True, "data": None}


@router.post("/api/setup/emergency-contacts/{contact_id}", dependencies=[Depends(require_admin_auth)])
async def update_emergency_contact(contact_id: int, body: UpdateEmergencyContact, request: Request) -> dict:
    try:
        phone = _normalize_phone(body.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE substrate.emergency_contacts SET name = $1, phone = $2 "
            "WHERE id = $3 RETURNING id, category, name, phone",
            body.name,
            phone,
            contact_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    data = {**dict(row), "id": str(row["id"])}
    await publish("household.updated", None)
    return {"success": True, "data": data}


@router.delete("/api/setup/emergency-contacts/{contact_id}", dependencies=[Depends(require_admin_auth)])
async def delete_emergency_contact(contact_id: int, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM substrate.emergency_contacts WHERE id = $1", contact_id
        )

    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Contact not found")

    await publish("household.updated", None)
    return {"success": True, "data": None}


@router.post("/api/setup/verify")
async def verify_admin_password(body: VerifyPassword, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            "SELECT admin_password_hash FROM substrate.households LIMIT 1"
        )

    if household is None:
        raise HTTPException(status_code=404, detail="No household configured")

    ok = verify_password(body.password, household["admin_password_hash"])
    return {"success": True, "data": {"ok": ok}}


@router.post("/api/setup/members", dependencies=[Depends(require_admin_auth)])
async def create_member(body: CreateMember, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        household_exists = await conn.fetchval(
            "SELECT id FROM substrate.households WHERE id = $1", body.household_id
        )
        if household_exists is None:
            raise HTTPException(status_code=404, detail="Household not found")

        row = await conn.fetchrow(
            "INSERT INTO substrate.members (household_id, display_name) VALUES ($1, $2) "
            "RETURNING id, display_name, device_id, avatar_filename, avatar_seed, color",
            body.household_id,
            body.display_name,
        )

    data = {**dict(row), "id": str(row["id"])}
    await publish("member.created", data)
    return {"success": True, "data": data}


@router.post("/api/setup/members/{member_id}/device", dependencies=[Depends(require_admin_auth)])
async def set_member_device(member_id: str, body: SetMemberDevice, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "UPDATE substrate.members SET device_id = $1 WHERE id = $2 "
                "RETURNING id, display_name, device_id, avatar_filename, avatar_seed, color",
                body.device_id,
                member_id,
            )
        except asyncpg.UniqueViolationError as e:
            raise HTTPException(
                status_code=409, detail="That device is already assigned to another member"
            ) from e

    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    data = {**dict(row), "id": str(row["id"])}
    await publish("member.updated", data)
    return {"success": True, "data": data}


@router.post("/api/setup/members/{member_id}", dependencies=[Depends(require_admin_auth)])
async def update_member(member_id: str, body: UpdateMember, request: Request) -> dict:
    """Renames a member and/or sets their custom map marker color. Both fields optional —
    only what's provided gets updated (COALESCE keeps the rest as-is)."""
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE substrate.members SET "
            "display_name = COALESCE($1, display_name), color = COALESCE($2, color) "
            "WHERE id = $3 "
            "RETURNING id, display_name, device_id, avatar_filename, avatar_seed, color",
            body.display_name,
            body.color,
            member_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    data = {**dict(row), "id": str(row["id"])}
    await publish("member.updated", data)
    return {"success": True, "data": data}


@router.delete("/api/setup/members/{member_id}", dependencies=[Depends(require_admin_auth)])
async def delete_member(member_id: str, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "DELETE FROM substrate.members WHERE id = $1 RETURNING id, avatar_filename", member_id
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    if row["avatar_filename"]:
        (AVATAR_DIR / row["avatar_filename"]).unlink(missing_ok=True)

    trips.forget_member(member_id)
    await publish("member.deleted", {"id": str(row["id"])})
    return {"success": True, "data": None}


@router.post("/api/setup/members/{member_id}/avatar-seed", dependencies=[Depends(require_admin_auth)])
async def set_member_avatar_seed(member_id: str, body: SetMemberAvatarSeed, request: Request) -> dict:
    """Picks a new generated placeholder avatar (see dashboard's @dicebear picker). Ignored
    once a member has a real uploaded photo — avatar_filename always wins on the map."""
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE substrate.members SET avatar_seed = $1 WHERE id = $2 "
            "RETURNING id, display_name, device_id, avatar_filename, avatar_seed, color",
            body.avatar_seed,
            member_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    data = {**dict(row), "id": str(row["id"])}
    await publish("member.updated", data)
    return {"success": True, "data": data}


@router.post("/api/setup/members/{member_id}/avatar", dependencies=[Depends(require_admin_auth)])
async def upload_member_avatar(member_id: str, file: UploadFile, request: Request) -> dict:
    ext = AVATAR_CONTENT_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status_code=400, detail="Photo must be JPEG, PNG, or WebP")

    body = await file.read(MAX_AVATAR_BYTES + 1)
    if len(body) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Photo must be under 5MB")

    async with request.app.state.db_pool.acquire() as conn:
        exists = await conn.fetchval("SELECT id FROM substrate.members WHERE id = $1", member_id)
        if exists is None:
            raise HTTPException(status_code=404, detail="Member not found")

        filename = f"{member_id}.{ext}"
        AVATAR_DIR.mkdir(parents=True, exist_ok=True)
        (AVATAR_DIR / filename).write_bytes(body)

        row = await conn.fetchrow(
            "UPDATE substrate.members SET avatar_filename = $1 WHERE id = $2 "
            "RETURNING id, display_name, device_id, avatar_filename, avatar_seed, color",
            filename,
            member_id,
        )

    data = {**dict(row), "id": str(row["id"])}
    await publish("member.updated", data)
    return {"success": True, "data": data}
