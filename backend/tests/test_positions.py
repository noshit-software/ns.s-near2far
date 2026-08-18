from datetime import datetime, timezone

import pytest

from app import trips
from app.api.positions import _record_position
from tests.conftest import FakeConn


@pytest.fixture(autouse=True)
def _reset_trip_state():
    trips._state.clear()
    yield
    trips._state.clear()


async def test_null_island_is_rejected_without_touching_db():
    conn = FakeConn()
    result = await _record_position(
        conn, "member-1", "household-1", "Alex", None, "seed123", None, 0.0, 0.0
    )
    assert result is None
    assert conn.calls == []  # never even attempted the INSERT


async def test_real_position_is_recorded():
    fake_row = {
        "id": 1,
        "member_id": "member-1",
        "lat": 37.7749,
        "lng": -122.4194,
        "recorded_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    conn = FakeConn(fetchrow_result=fake_row)
    result = await _record_position(
        conn, "member-1", "household-1", "Alex", None, "seed123", "#ff0000", 37.7749, -122.4194
    )
    assert result is not None
    assert result["lat"] == 37.7749
    assert result["lng"] == -122.4194
    assert result["color"] == "#ff0000"
    assert result["display_name"] == "Alex"
    assert len(conn.calls) == 1
    assert conn.calls[0][0] == "fetchrow"


async def test_explicit_recorded_at_is_used_over_server_time():
    client_ts = datetime(2020, 1, 1, tzinfo=timezone.utc)  # deliberately not "now"
    fake_row = {
        "id": 1,
        "member_id": "member-1",
        "lat": 1.0,
        "lng": 2.0,
        "recorded_at": client_ts,
    }
    conn = FakeConn(fetchrow_result=fake_row)
    await _record_position(
        conn, "member-1", "household-1", "Alex", None, "seed123", None, 1.0, 2.0,
        recorded_at=client_ts,
    )
    # The INSERT query text differs depending on whether recorded_at was passed explicitly —
    # confirm the 4-column form (with recorded_at) was used, not the 3-column server-time form.
    query = conn.calls[0][1][0]
    assert "recorded_at" in query
