from fastapi import HTTPException, Request

from app.config import settings


async def require_api_key(request: Request) -> None:
    if not settings.api_key:
        return

    header_key = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    query_key = request.query_params.get("api_key", "")

    if settings.api_key not in (header_key, query_key):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
