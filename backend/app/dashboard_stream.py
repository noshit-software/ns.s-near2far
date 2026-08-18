from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth import verify_password
from app.events import subscribe

router = APIRouter()


async def _authorized(websocket: WebSocket) -> bool:
    """WebSockets can't carry the Authorization header the REST API uses, so the admin
    password travels as a query param instead — the dashboard already treats that password as
    the credential (stored client-side, sent as Bearer everywhere else), so this isn't a new
    trust boundary, just a different transport for the same one."""
    async with websocket.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            "SELECT admin_password_hash FROM substrate.households LIMIT 1"
        )

    if household is None:
        return True  # no household yet — nothing sensitive to protect

    token = websocket.query_params.get("token", "")
    return bool(token) and verify_password(token, household["admin_password_hash"])


@router.websocket("/ws/events")
async def dashboard_stream(websocket: WebSocket) -> None:
    if not await _authorized(websocket):
        await websocket.close(code=1008)  # policy violation
        return

    await websocket.accept()
    try:
        async for event in subscribe("*"):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
