import pytest
from fastapi import HTTPException

from app.auth import hash_password
from app.middleware.auth import require_admin_auth
from tests.conftest import FakeConn


class _AcquireCtx:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc):
        return False


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _AcquireCtx(self.conn)


class FakeRequest:
    def __init__(self, conn, headers=None):
        self.app = type("App", (), {"state": type("State", (), {"db_pool": FakePool(conn)})()})()
        self.headers = headers or {}


async def test_no_household_yet_allows_through():
    conn = FakeConn(fetchrow_result=None)
    request = FakeRequest(conn)
    # Should not raise — before a household exists, nothing is gated yet.
    await require_admin_auth(request)


async def test_correct_bearer_password_passes():
    stored_hash = hash_password("hunter2")
    conn = FakeConn(fetchrow_result={"admin_password_hash": stored_hash})
    request = FakeRequest(conn, headers={"authorization": "Bearer hunter2"})
    await require_admin_auth(request)


async def test_wrong_bearer_password_401s():
    stored_hash = hash_password("hunter2")
    conn = FakeConn(fetchrow_result={"admin_password_hash": stored_hash})
    request = FakeRequest(conn, headers={"authorization": "Bearer wrong"})
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_auth(request)
    assert exc_info.value.status_code == 401


async def test_missing_auth_header_401s():
    stored_hash = hash_password("hunter2")
    conn = FakeConn(fetchrow_result={"admin_password_hash": stored_hash})
    request = FakeRequest(conn, headers={})
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_auth(request)
    assert exc_info.value.status_code == 401
