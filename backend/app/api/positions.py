import structlog
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

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
    device_id: str


class OverlandLocation(BaseModel):
    geometry: OverlandGeometry
    properties: OverlandProperties


class OverlandForward(BaseModel):
    locations: list[OverlandLocation]


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
) -> dict:
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
    async with request.app.state.db_pool.acquire() as conn:
        for location in body.locations:
            device_id = location.properties.device_id
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
            )

    return {"result": "ok"}
