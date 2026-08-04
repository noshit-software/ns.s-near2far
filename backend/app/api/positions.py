import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.events import publish
from app.middleware.auth import require_admin_auth

router = APIRouter()
log = structlog.get_logger(__name__)


class ReportPosition(BaseModel):
    member_id: str
    lat: float
    lng: float


class TraccarDevice(BaseModel):
    uniqueId: str


class TraccarPosition(BaseModel):
    latitude: float
    longitude: float


class TraccarForward(BaseModel):
    device: TraccarDevice
    position: TraccarPosition


def _position_dict(row) -> dict:
    data = dict(row)
    data["member_id"] = str(data["member_id"])
    data["recorded_at"] = data["recorded_at"].isoformat()
    return data


async def _record_position(conn, member_id: str, lat: float, lng: float) -> dict:
    row = await conn.fetchrow(
        "INSERT INTO runtime.positions (member_id, lat, lng) VALUES ($1, $2, $3) "
        "RETURNING id, member_id, lat, lng, recorded_at",
        member_id,
        lat,
        lng,
    )
    data = _position_dict(row)
    await publish("position.updated", data)
    return data


@router.post("/api/positions", dependencies=[Depends(require_admin_auth)])
async def report_position(body: ReportPosition, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        member_exists = await conn.fetchval(
            "SELECT id FROM substrate.members WHERE id = $1", body.member_id
        )
        if member_exists is None:
            raise HTTPException(status_code=404, detail="Member not found")

        data = await _record_position(conn, body.member_id, body.lat, body.lng)

    return {"success": True, "data": data}


@router.get("/api/positions/latest", dependencies=[Depends(require_admin_auth)])
async def latest_positions(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (p.member_id)
                p.member_id, m.display_name, p.lat, p.lng, p.recorded_at
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
        member_id = await conn.fetchval(
            "SELECT id FROM substrate.members WHERE traccar_unique_id = $1", body.device.uniqueId
        )
        if member_id is None:
            log.info("traccar_forward_unmapped_device", unique_id=body.device.uniqueId)
            return {"success": True, "data": None}

        await _record_position(conn, str(member_id), body.position.latitude, body.position.longitude)

    return {"success": True, "data": None}
