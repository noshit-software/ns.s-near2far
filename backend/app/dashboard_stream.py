import asyncio

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

    # nginx (both the container's and the VPS's system proxy) has a default
    # proxy_read_timeout of 60s — any WebSocket idle longer than that gets silently
    # closed. With OwnTracks updates several minutes apart, the connection dies between
    # every pair of events. A 30s heartbeat keeps it alive without touching nginx config.
    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                return

    task = asyncio.create_task(_heartbeat())
    try:
        async for event in subscribe("*"):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
