import json

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import hash_password, verify_password
from app.events import publish
from app.middleware.auth import require_admin_auth

router = APIRouter()


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


class CreateHousehold(BaseModel):
    name: str
    admin_password: str
    home_geofence: HomeGeofence


class CreateMember(BaseModel):
    household_id: str
    display_name: str


class SetMemberDevice(BaseModel):
    device_id: str | None = None


class VerifyPassword(BaseModel):
    password: str


@router.get("/api/setup/household")
async def get_household(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            "SELECT id, name, home_geofence FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        if household is None:
            return {"success": True, "data": None}

        members = await conn.fetch(
            "SELECT id, display_name, device_id FROM substrate.members WHERE household_id = $1",
            household["id"],
        )

    return {
        "success": True,
        "data": {
            **_household_dict(household),
            "members": [{**dict(m), "id": str(m["id"])} for m in members],
        },
    }


@router.post("/api/setup/household")
async def create_household(body: CreateHousehold, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM substrate.households LIMIT 1")
        if existing is not None:
            raise HTTPException(status_code=409, detail="Household already configured")

        row = await conn.fetchrow(
            "INSERT INTO substrate.households (name, home_geofence, admin_password_hash) "
            "VALUES ($1, $2::jsonb, $3) RETURNING id, name, home_geofence",
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
            "RETURNING id, display_name, device_id",
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
                "RETURNING id, display_name, device_id",
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
