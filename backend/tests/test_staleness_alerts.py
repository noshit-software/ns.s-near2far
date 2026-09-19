from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app import staleness_alerts
from tests.conftest import FakeConn, FakePool


def _patched_push():
    """Patch send_push_to_household so tests don't need a live VAPID key or push subscriptions."""
    return patch("app.staleness_alerts.send_push_to_household", new=AsyncMock())


@pytest.fixture(autouse=True)
def _reset_state():
    staleness_alerts._alerted.clear()
    yield
    staleness_alerts._alerted.clear()


def test_on_fresh_position_clears_alerted():
    staleness_alerts._alerted.add("member-1")
    staleness_alerts.on_fresh_position("member-1")
    assert "member-1" not in staleness_alerts._alerted


def test_on_fresh_position_is_safe_when_not_alerted():
    staleness_alerts.on_fresh_position("member-1")
    assert "member-1" not in staleness_alerts._alerted


async def test_check_alerts_stale_member():
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=45)
    conn = FakeConn(fetch_result=[{
        "member_id": "member-1",
        "display_name": "Alex",
        "household_id": "household-1",
        "recorded_at": stale_time,
    }])
    with _patched_push():
        await staleness_alerts._check(FakePool(conn))
    assert "member-1" in staleness_alerts._alerted


async def test_check_does_not_alert_fresh_member():
    fresh_time = datetime.now(timezone.utc) - timedelta(minutes=10)
    conn = FakeConn(fetch_result=[{
        "member_id": "member-1",
        "display_name": "Alex",
        "household_id": "household-1",
        "recorded_at": fresh_time,
    }])
    await staleness_alerts._check(FakePool(conn))
    assert "member-1" not in staleness_alerts._alerted


async def test_check_does_not_double_alert():
    """A member already in _alerted does not trigger another push while still stale."""
    staleness_alerts._alerted.add("member-1")
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=60)
    conn = FakeConn(fetch_result=[{
        "member_id": "member-1",
        "display_name": "Alex",
        "household_id": "household-1",
        "recorded_at": stale_time,
    }])
    await staleness_alerts._check(FakePool(conn))
    assert "member-1" in staleness_alerts._alerted


async def test_check_clears_alert_when_member_recovers():
    """_check itself discards the alert when the recorded position is now fresh."""
    staleness_alerts._alerted.add("member-1")
    fresh_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    conn = FakeConn(fetch_result=[{
        "member_id": "member-1",
        "display_name": "Alex",
        "household_id": "household-1",
        "recorded_at": fresh_time,
    }])
    await staleness_alerts._check(FakePool(conn))
    assert "member-1" not in staleness_alerts._alerted


async def test_check_handles_naive_datetime():
    """Positions stored without timezone info (naive datetimes from older DB rows) are treated
    as UTC and still detected as stale — the check adds UTC tzinfo before comparing."""
    stale_time = datetime.now() - timedelta(minutes=45)  # naive, no tzinfo
    conn = FakeConn(fetch_result=[{
        "member_id": "member-1",
        "display_name": "Alex",
        "household_id": "household-1",
        "recorded_at": stale_time,
    }])
    with _patched_push():
        await staleness_alerts._check(FakePool(conn))
    assert "member-1" in staleness_alerts._alerted
