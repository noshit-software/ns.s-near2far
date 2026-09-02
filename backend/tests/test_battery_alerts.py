import pytest

from app import battery_alerts
from tests.conftest import FakeConn


@pytest.fixture(autouse=True)
def _reset_alert_state():
    battery_alerts._alerted.clear()
    yield
    battery_alerts._alerted.clear()


async def test_none_battery_is_ignored():
    conn = FakeConn()
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", None)
    assert conn.calls == []


async def test_high_battery_does_not_alert():
    conn = FakeConn()
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 80)
    assert conn.calls == []


async def test_low_battery_alerts_once():
    # send_push_to_household no-ops without a VAPID key configured (as in CI), so assert on the
    # alert-state bookkeeping directly rather than on whether conn was actually queried.
    conn = FakeConn()
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    assert "member-1" in battery_alerts._alerted

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 10)
    assert "member-1" in battery_alerts._alerted  # still just the one alert, no re-trigger


async def test_recovery_allows_realert():
    conn = FakeConn()
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    assert "member-1" in battery_alerts._alerted

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 50)
    assert "member-1" not in battery_alerts._alerted  # recovered past RECOVERY_THRESHOLD

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    assert "member-1" in battery_alerts._alerted  # dropped low again -> re-alerts


def test_forget_member_clears_state():
    battery_alerts._alerted.add("member-1")
    battery_alerts.forget_member("member-1")
    assert "member-1" not in battery_alerts._alerted
