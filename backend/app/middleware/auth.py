from fastapi import HTTPException, Request

from app.auth import verify_password


async def require_admin_auth(request: Request) -> None:
    async with request.app.state.db_pool.acquire() as conn:
        household = await conn.fetchrow(
            "SELECT admin_password_hash FROM substrate.households LIMIT 1"
        )

    if household is None:
        return

    header_key = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not header_key or not verify_password(header_key, household["admin_password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid or missing admin password")
