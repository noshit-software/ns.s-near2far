from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.events import publish
from app.middleware.auth import require_admin_auth

router = APIRouter(dependencies=[Depends(require_admin_auth)])


class ReportPosition(BaseModel):
    member_id: str
    lat: float
    lng: float


def _position_dict(row) -> dict:
    data = dict(row)
    data["member_id"] = str(data["member_id"])
    data["recorded_at"] = data["recorded_at"].isoformat()
    return data


@router.post("/api/positions")
async def report_position(body: ReportPosition, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        member_exists = await conn.fetchval(
            "SELECT id FROM substrate.members WHERE id = $1", body.member_id
        )
        if member_exists is None:
            raise HTTPException(status_code=404, detail="Member not found")

        row = await conn.fetchrow(
            "INSERT INTO runtime.positions (member_id, lat, lng) VALUES ($1, $2, $3) "
            "RETURNING id, member_id, lat, lng, recorded_at",
            body.member_id,
            body.lat,
            body.lng,
        )

    data = _position_dict(row)
    await publish("position.updated", data)
    return {"success": True, "data": data}


@router.get("/api/positions/latest")
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
