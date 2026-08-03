from fastapi import APIRouter, Depends, Request

from app.middleware.auth import require_admin_auth

router = APIRouter(dependencies=[Depends(require_admin_auth)])


@router.get("/api/topics")
async def list_topics(request: Request) -> dict:
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, display_name, trust_tier FROM substrate.members")

    return {"success": True, "data": [dict(row) for row in rows]}
