import os

# app.config.Settings requires these at import time (no defaults) since it's meant to run
# against a real Postgres — set harmless placeholders before any `app.*` module gets imported
# by a test, so pure-logic tests don't need a live database or a .env file just to collect.
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASS", "test")
os.environ.setdefault("POSTGRES_DB", "test")


class FakeConn:
    """Minimal stand-in for an asyncpg connection, for tests that exercise application logic
    without needing a real Postgres. Configure `fetchrow_result`/`fetch_result` per test; every
    call is recorded in `.calls` so tests can assert whether (and how) the DB was touched."""

    def __init__(self, fetchrow_result=None, fetch_result=None, fetchval_result=None):
        self.fetchrow_result = fetchrow_result
        self.fetch_result = fetch_result if fetch_result is not None else []
        self.fetchval_result = fetchval_result
        self.calls: list[tuple[str, tuple]] = []

    async def fetchrow(self, query, *args):
        self.calls.append(("fetchrow", (query, *args)))
        return self.fetchrow_result

    async def fetch(self, query, *args):
        self.calls.append(("fetch", (query, *args)))
        return self.fetch_result

    async def fetchval(self, query, *args):
        self.calls.append(("fetchval", (query, *args)))
        return self.fetchval_result

    async def execute(self, query, *args):
        self.calls.append(("execute", (query, *args)))
