import base64

import pytest
from fastapi import HTTPException

from app.api.positions import _verify_owntracks_auth
from app.auth import hash_password
from tests.conftest import FakeConn


def _basic_header(username: str, password: str) -> str:
    raw = f"{username}:{password}".encode()
    return "Basic " + base64.b64encode(raw).decode()


class FakeRequest:
    def __init__(self, headers):
        self.headers = headers


async def test_correct_password_returns_username():
    stored_hash = hash_password("household-pass")
    conn = FakeConn(fetchrow_result={"admin_password_hash": stored_hash})
    request = FakeRequest({"authorization": _basic_header("alex-iphone", "household-pass")})
    username = await _verify_owntracks_auth(conn, request)
    assert username == "alex-iphone"


async def test_wrong_password_401s():
    stored_hash = hash_password("household-pass")
    conn = FakeConn(fetchrow_result={"admin_password_hash": stored_hash})
    request = FakeRequest({"authorization": _basic_header("alex-iphone", "wrong-pass")})
    with pytest.raises(HTTPException) as exc_info:
        await _verify_owntracks_auth(conn, request)
    assert exc_info.value.status_code == 401


async def test_missing_auth_header_401s():
    conn = FakeConn()
    request = FakeRequest({})
    with pytest.raises(HTTPException) as exc_info:
        await _verify_owntracks_auth(conn, request)
    assert exc_info.value.status_code == 401


async def test_bearer_scheme_instead_of_basic_401s():
    # OwnTracks only ever sends Basic — a Bearer header (the scheme every other endpoint here
    # uses) must not be accidentally accepted.
    conn = FakeConn()
    request = FakeRequest({"authorization": "Bearer sometoken"})
    with pytest.raises(HTTPException) as exc_info:
        await _verify_owntracks_auth(conn, request)
    assert exc_info.value.status_code == 401


async def test_malformed_base64_401s_not_500s():
    conn = FakeConn()
    request = FakeRequest({"authorization": "Basic not-valid-base64!!!"})
    with pytest.raises(HTTPException) as exc_info:
        await _verify_owntracks_auth(conn, request)
    assert exc_info.value.status_code == 401


async def test_no_household_yet_401s():
    conn = FakeConn(fetchrow_result=None)
    request = FakeRequest({"authorization": _basic_header("alex-iphone", "anything")})
    with pytest.raises(HTTPException) as exc_info:
        await _verify_owntracks_auth(conn, request)
    assert exc_info.value.status_code == 401
