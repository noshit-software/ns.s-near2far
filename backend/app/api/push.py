from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.config import settings
from app.middleware.auth import require_admin_auth

router = APIRouter()


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionBody(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


@router.get("/api/push/vapid-public-key")
async def vapid_public_key() -> dict:
    return {"success": True, "data": {"public_key": settings.vapid_public_key}}


@router.post("/api/push/subscribe", dependencies=[Depends(require_admin_auth)])
async def subscribe(body: PushSubscriptionBody, request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        household_id = await conn.fetchval(
            "SELECT id FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        await conn.execute(
            "INSERT INTO substrate.push_subscriptions (household_id, endpoint, p256dh, auth) "
            "VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO NOTHING",
            household_id,
            body.endpoint,
            body.keys.p256dh,
            body.keys.auth,
        )

    return {"success": True, "data": None}
