import asyncpg

from app.config import settings


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.execute("LOAD 'age'")
    await conn.execute('SET search_path = ag_catalog, "$user", public')


async def create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_pass,
        database=settings.postgres_db,
        init=_init_conn,
    )
