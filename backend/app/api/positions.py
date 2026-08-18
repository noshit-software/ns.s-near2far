import base64
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import verify_password
from app.events import publish
from app.middleware.auth import require_admin_auth
from app.trips import on_position as _on_position

router = APIRouter()
log = structlog.get_logger(__name__)


class TraccarDevice(BaseModel):
    uniqueId: str


class TraccarPosition(BaseModel):
    latitude: float
    longitude: float


class TraccarForward(BaseModel):
    device: TraccarDevice
    position: TraccarPosition


class OverlandGeometry(BaseModel):
    coordinates: list[float]  # [lon, lat]


class OverlandProperties(BaseModel):
    device_id: str | None = None
    timestamp: datetime | None = None


class OverlandLocation(BaseModel):
    geometry: OverlandGeometry
    properties: OverlandProperties


class OverlandForward(BaseModel):
    locations: list[OverlandLocation]


class OwnTracksLocation(BaseModel):
    type_: str = Field(alias="_type")
    lat: float
    lon: float
    tst: int | None = None  # unix seconds
    tid: str | None = None  # tracker ID — used as our device_id


def _position_dict(
    member_id: str, display_name: str, avatar_filename: str | None, avatar_seed: str, row
) -> dict:
    return {
        "member_id": member_id,
        "display_name": display_name,
        "avatar_filename": avatar_filename,
        "avatar_seed": avatar_seed,
        "lat": row["lat"],
        "lng": row["lng"],
        "recorded_at": row["recorded_at"].isoformat(),
    }


async def _record_position(
    conn,
    member_id: str,
    household_id: str,
    display_name: str,
    avatar_filename: str | None,
    avatar_seed: str,
    lat: float,
    lng: float,
    recorded_at: datetime | None = None,
) -> dict | None:
    if lat == 0 and lng == 0:
        # (0, 0) — "null island" — is the standard sentinel a GPS source sends when it has no
        # real fix yet. Never a genuine location; recording it would put a member's marker in
        # the Gulf of Guinea and, worse, could win as "latest" over a real point if it arrives
        # later in a queued/batched delivery.
        log.warning("position_rejected_null_island", member_id=member_id)
        return None

    if recorded_at is not None:
        row = await conn.fetchrow(
            "INSERT INTO runtime.positions (member_id, lat, lng, recorded_at) VALUES ($1, $2, $3, $4) "
            "RETURNING id, member_id, lat, lng, recorded_at",
            member_id,
            lat,
            lng,
            recorded_at,
        )
    else:
        row = await conn.fetchrow(
            "INSERT INTO runtime.positions (member_id, lat, lng) VALUES ($1, $2, $3) "
            "RETURNING id, member_id, lat, lng, recorded_at",
            member_id,
            lat,
            lng,
        )
    data = _position_dict(member_id, display_name, avatar_filename, avatar_seed, row)
    await publish("position.updated", data)
    await _on_position(conn, member_id, display_name, household_id, lat, lng, row["recorded_at"])
    return data


@router.get("/api/positions/latest", dependencies=[Depends(require_admin_auth)])
async def latest_positions(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (p.member_id)
                p.member_id, m.display_name, m.avatar_filename, m.avatar_seed, p.lat, p.lng, p.recorded_at
            FROM runtime.positions p
            JOIN substrate.members m ON m.id = p.member_id
            ORDER BY p.member_id, p.recorded_at DESC
            """
        )

    return {
        "success": True,
        "data": [{**dict(r), "member_id": str(r["member_id"]), "recorded_at": r["recorded_at"].isoformat()} for r in rows],
    }


@router.post("/api/traccar/forward")
async def traccar_forward(body: TraccarForward, request: Request) -> dict:
    """Receives Traccar's position-forwarding webhook (forward.type=json). No admin auth —
    only reachable from the traccar container / host, never exposed publicly. Silently
    no-ops for devices not yet assigned to a member, since Traccar has no useful way to
    react to an error here and would otherwise retry forever."""
    async with request.app.state.db_pool.acquire() as conn:
        member = await conn.fetchrow(
            "SELECT id, household_id, display_name, avatar_filename, avatar_seed FROM substrate.members "
            "WHERE device_id = $1",
            body.device.uniqueId,
        )
        if member is None:
            log.info("traccar_forward_unmapped_device", unique_id=body.device.uniqueId)
            return {"success": True, "data": None}

        await _record_position(
            conn,
            str(member["id"]),
            str(member["household_id"]),
            member["display_name"],
            member["avatar_filename"],
            member["avatar_seed"],
            body.position.latitude,
            body.position.longitude,
        )

    return {"success": True, "data": None}


@router.post("/api/overland/forward", dependencies=[Depends(require_admin_auth)])
async def overland_forward(body: OverlandForward, request: Request) -> dict:
    """Receives Overland's location batch (iOS GPS client — Traccar Client is unreliable on
    iOS). Overland sends the household admin password as its configured access token
    (Authorization: Bearer <password>). Silently no-ops for devices not yet assigned to a
    member. Responds in the shape Overland expects so it doesn't keep retrying."""
    log.info("overland_forward_received", location_count=len(body.locations))
    async with request.app.state.db_pool.acquire() as conn:
        for location in body.locations:
            device_id = location.properties.device_id
            if device_id is None:
                log.warning("overland_forward_missing_device_id")
                continue

            member = await conn.fetchrow(
                "SELECT id, household_id, display_name, avatar_filename, avatar_seed FROM substrate.members "
                "WHERE device_id = $1",
                device_id,
            )
            if member is None:
                log.info("overland_forward_unmapped_device", device_id=device_id)
                continue

            lon, lat = location.geometry.coordinates[0], location.geometry.coordinates[1]
            await _record_position(
                conn,
                str(member["id"]),
                str(member["household_id"]),
                member["display_name"],
                member["avatar_filename"],
                member["avatar_seed"],
                lat,
                lon,
                recorded_at=location.properties.timestamp,
            )

    return {"result": "ok"}


async def _verify_owntracks_auth(conn, request: Request) -> str:
    """OwnTracks' HTTP endpoint only supports HTTP Basic auth, not the Bearer scheme every
    other endpoint here uses — so this can't reuse require_admin_auth. The password must
    match the household admin password, same credential as everywhere else. The username is
    returned (not just discarded) since it doubles as our device_id — OwnTracks' own
    "Tracker ID" field is capped at 2 characters by the app itself, too short to be a
    meaningful identifier, but the Basic auth username has no such limit."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Basic "):
        raise HTTPException(status_code=401, detail="Missing Basic auth")

    try:
        decoded = base64.b64decode(auth_header.removeprefix("Basic ").strip()).decode()
        username, _, password = decoded.partition(":")
    except (ValueError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=401, detail="Invalid Basic auth") from e

    household = await conn.fetchrow("SELECT admin_password_hash FROM substrate.households LIMIT 1")
    if household is None or not verify_password(password, household["admin_password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return username


@router.post("/api/owntracks/forward")
async def owntracks_forward(body: OwnTracksLocation, request: Request) -> dict:
    """Receives OwnTracks' HTTP-mode location report — an alternative iOS/Android GPS client
    to Overland, no forced batch-size floor. Maps to a member via the Basic auth username
    (see _verify_owntracks_auth), not `tid` — OwnTracks' 2-character Tracker ID field is too
    short to be a meaningful device_id. Ignores non-location report types (OwnTracks also
    posts 'transition'/'waypoint' events through the same endpoint)."""
    async with request.app.state.db_pool.acquire() as conn:
        username = await _verify_owntracks_auth(conn, request)

        if body.type_ != "location":
            return {}

        member = await conn.fetchrow(
            "SELECT id, household_id, display_name, avatar_filename, avatar_seed FROM substrate.members "
            "WHERE device_id = $1",
            username,
        )
        if member is None:
            log.info("owntracks_forward_unmapped_device", username=username)
            return {}

        recorded_at = datetime.fromtimestamp(body.tst, tz=timezone.utc) if body.tst else None
        await _record_position(
            conn,
            str(member["id"]),
            str(member["household_id"]),
            member["display_name"],
            member["avatar_filename"],
            member["avatar_seed"],
            body.lat,
            body.lon,
            recorded_at=recorded_at,
        )

    return {}
