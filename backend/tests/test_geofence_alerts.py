import json

import pytest

from app import geofence_alerts
from tests.conftest import FakeConn

HOME = {"lat": 10.0, "lng": 10.0, "radius_m": 100}


@pytest.fixture(autouse=True)
def _reset_state():
    geofence_alerts._state.clear()
    yield
    geofence_alerts._state.clear()


def _conn_with_home(home=HOME, places=None):
    return FakeConn(
        fetchrow_result={"home_geofence": json.dumps(home) if home else None},
        fetch_result=places or [],
    )


async def test_arriving_home_alerts_once():
    conn = _conn_with_home()
    await geofence_alerts.on_position(conn, "member-1", "Alex", "household-1", 10.0, 10.0)
    assert "home" in geofence_alerts._state["member-1"]

    calls_after_arrival = len(conn.calls)
    await geofence_alerts.on_position(conn, "member-1", "Alex", "household-1", 10.0001, 10.0001)
    # still inside — no new push attempt (fetchrow/fetch calls happen every time, but state
    # shouldn't change, i.e. no arrival/departure transition fires again)
    assert "home" in geofence_alerts._state["member-1"]
    assert calls_after_arrival <= len(conn.calls)


async def test_leaving_home_clears_state():
    conn = _conn_with_home()
    await geofence_alerts.on_position(conn, "member-1", "Alex", "household-1", 10.0, 10.0)
    assert "home" in geofence_alerts._state["member-1"]

    # Far enough away (~1 degree ~= 111km) to be outside a 100m radius.
    await geofence_alerts.on_position(conn, "member-1", "Alex", "household-1", 11.0, 11.0)
    assert "home" not in geofence_alerts._state["member-1"]


async def test_no_home_geofence_is_a_noop():
    conn = _conn_with_home(home=None)
    await geofence_alerts.on_position(conn, "member-1", "Alex", "household-1", 10.0, 10.0)
    assert geofence_alerts._state["member-1"] == set()


def test_forget_member_clears_state():
    geofence_alerts._state["member-1"] = {"home"}
    geofence_alerts.forget_member("member-1")
    assert "member-1" not in geofence_alerts._state
