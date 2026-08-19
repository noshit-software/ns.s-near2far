from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.events import publish
from app.geocode import nearest_address
from app.middleware.auth import require_admin_auth
from app.push import send_push_to_household

router = APIRouter()

CATEGORY_LABELS = {
    "general": "SOS",
    "medical": "Medical emergency",
    "security": "Authority threat",
    "suspicious": "Being followed",
    "car": "Car trouble",
}

KINDS = {"sos", "help"}


class SosTriggerBody(BaseModel):
    origin_client_id: str
    lat: float | None = None
    lng: float | None = None
    category: str = "general"
    kind: str = "sos"
    contact_name: str | None = None
    exclude_endpoint: str | None = None


def _alert_dict(row) -> dict:
    return {
        "id": row["id"],
        "lat": row["lat"],
        "lng": row["lng"],
        "address": row["address"],
        "category": row["category"],
        "kind": row["kind"],
        "contact_name": row["contact_name"],
        "origin_client_id": row["origin_client_id"],
        "created_at": row["created_at"].isoformat(),
    }


@router.post("/api/sos/trigger", dependencies=[Depends(require_admin_auth)])
async def trigger_sos(body: SosTriggerBody, request: Request) -> dict:
    category = body.category if body.category in CATEGORY_LABELS else "general"
    kind = body.kind if body.kind in KINDS else "sos"

    async with request.app.state.db_pool.acquire() as conn:
        household_id = await conn.fetchval(
            "SELECT id FROM substrate.households ORDER BY created_at LIMIT 1"
        )

        address = None
        if body.lat is not None and body.lng is not None:
            address = await nearest_address(body.lat, body.lng)

        # 'help' alerts (a category helper number like AAA was dialed) have nothing to
        # actively disable — auto-resolve them immediately so they never show up as an
        # "active SOS" needing the code-gated disable flow.
        row = await conn.fetchrow(
            "INSERT INTO runtime.sos_alerts "
            "(household_id, lat, lng, address, category, kind, contact_name, origin_client_id, "
            "acknowledged_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'help' THEN now() ELSE NULL END) "
            "RETURNING id, lat, lng, address, category, kind, contact_name, origin_client_id, created_at",
            household_id,
            body.lat,
            body.lng,
            address,
            category,
            kind,
            body.contact_name,
            body.origin_client_id,
        )

        alert = _alert_dict(row)
        await publish("sos.triggered", alert)

        if kind == "help":
            title = f"{body.contact_name or 'Contact'} called — {CATEGORY_LABELS[category]}"
            push_payload = {"title": title, "body": address or "Location unavailable", "tag": "sos-help"}
        else:
            title = CATEGORY_LABELS[category]
            push_payload = {
                "title": title,
                "body": f"Near {address}" if address else "Location unavailable",
                "tag": "sos",
                "requireInteraction": True,
            }

        await send_push_to_household(conn, household_id, push_payload, exclude_endpoint=body.exclude_endpoint)

    return {"success": True, "data": alert}


@router.post("/api/sos/{alert_id}/acknowledge", dependencies=[Depends(require_admin_auth)])
async def acknowledge_sos(alert_id: int, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE runtime.sos_alerts SET acknowledged_at = now() "
            "WHERE id = $1 AND acknowledged_at IS NULL RETURNING id",
            alert_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Alert not found or already acknowledged")

    await publish("sos.acknowledged", {"id": alert_id})
    return {"success": True, "data": None}


@router.get("/api/sos/active", dependencies=[Depends(require_admin_auth)])
async def active_sos(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, lat, lng, address, category, kind, contact_name, origin_client_id, created_at "
            "FROM runtime.sos_alerts WHERE acknowledged_at IS NULL "
            "ORDER BY created_at DESC LIMIT 1"
        )

    if row is None:
        return {"success": True, "data": None}

    return {"success": True, "data": _alert_dict(row)}
