import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.events import subscribe
from app.ws_tickets import consume_ticket

router = APIRouter()


async def _authorized(websocket: WebSocket) -> bool:
    """WebSockets can't carry the Authorization header the REST API uses. The dashboard
    calls POST /api/setup/ws-ticket (a normal REST endpoint with Bearer auth) to get a
    short-lived single-use token, then passes that token as ?ticket= here. The raw admin
    password never touches the WebSocket URL or query string."""
    async with websocket.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            "SELECT id FROM substrate.households LIMIT 1"
        )

    if household is None:
        return True  # no household yet — nothing sensitive to protect

    ticket = websocket.query_params.get("ticket", "")
    return bool(ticket) and consume_ticket(ticket)


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
