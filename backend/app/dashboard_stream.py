from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.events import subscribe

router = APIRouter()


@router.websocket("/ws/events")
async def dashboard_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        async for event in subscribe("*"):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
