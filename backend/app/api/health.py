import time

from fastapi import APIRouter, Request

router = APIRouter()
_started_at = time.monotonic()


@router.get("/health")
@router.get("/api/health")
async def health(request: Request) -> dict:
    db_ok = True
    try:
        async with request.app.state.db_pool.acquire() as conn:
            await conn.execute("SELECT 1")
    except Exception:
        db_ok = False

    return {
        "success": True,
        "data": {
            "status": "ok" if db_ok else "degraded",
            "db": db_ok,
            "uptime_s": round(time.monotonic() - _started_at, 1),
        },
    }
