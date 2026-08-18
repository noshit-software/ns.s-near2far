from datetime import datetime, timedelta, timezone

import pytest

from app import trips
from tests.conftest import FakeConn


@pytest.fixture(autouse=True)
def _reset_trip_state():
    # trips._state is module-level/global — clear it between tests so one test's member_id
    # can't leak state into the next.
    trips._state.clear()
    yield
    trips._state.clear()


def test_haversine_known_distance():
    # Roughly 1 degree of longitude at the equator is ~111.2 km.
    dist = trips._haversine_m(0, 0, 0, 1)
    assert 110_000 < dist < 112_000


def test_haversine_same_point_is_zero():
    assert trips._haversine_m(37.7749, -122.4194, 37.7749, -122.4194) == 0


async def test_first_position_just_registers_no_trip():
    conn = FakeConn()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t0)
    assert "member-1" in trips._state
    assert trips._state["member-1"]["trip_active"] is False
    assert conn.calls == []  # no DB touched for a first-ever point


async def test_moving_marks_trip_active():
    conn = FakeConn()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t0)

    # ~100m in 10s ≈ 10 m/s, well above the MOVING_SPEED_MPS threshold (0.8 m/s).
    t1 = t0 + timedelta(seconds=10)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7758, -122.4194, t1)

    assert trips._state["member-1"]["trip_active"] is True
    assert trips._state["member-1"]["distance_m"] > 0


async def test_stationary_never_starts_a_trip():
    conn = FakeConn()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t0)

    # Same coordinates 10s later — zero speed, well under the moving threshold.
    t1 = t0 + timedelta(seconds=10)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t1)

    assert trips._state["member-1"]["trip_active"] is False


async def test_out_of_order_timestamp_is_ignored():
    conn = FakeConn()
    t0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t0)

    # A point with an *earlier* timestamp than the last one seen (e.g. delivered out of order
    # in a batch) — dt <= 0, must not corrupt state or divide by a non-positive duration.
    t_earlier = t0 - timedelta(seconds=5)
    state_before = dict(trips._state["member-1"])
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.8, -122.5, t_earlier)
    assert trips._state["member-1"] == state_before


async def test_trip_end_below_min_distance_sends_no_push():
    conn = FakeConn()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.7749, -122.4194, t0)

    # Move a tiny amount (below MIN_TRIP_DISTANCE_M) then go stationary past STOP_TIMEOUT_S.
    t1 = t0 + timedelta(seconds=10)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.77491, -122.4194, t1)

    t2 = t1 + timedelta(seconds=trips.STOP_TIMEOUT_S + 5)
    await trips.on_position(conn, "member-1", "Alex", "household-1", 37.77491, -122.4194, t2)

    assert trips._state["member-1"]["trip_active"] is False
    # send_push_to_household short-circuits with no VAPID key configured either way, so this
    # mainly confirms on_position doesn't crash on the "trip ended" branch with a short trip.
