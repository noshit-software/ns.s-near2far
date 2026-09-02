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
    conn = FakeConn()  # fetch() returns [] by default — no subscriptions to push to
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    first_call_count = len(conn.calls)
    assert first_call_count > 0  # send_push_to_household queried subscriptions

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 10)
    assert len(conn.calls) == first_call_count  # no repeat push while still low


async def test_recovery_allows_realert():
    conn = FakeConn()
    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    calls_after_first_alert = len(conn.calls)

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 50)
    assert len(conn.calls) == calls_after_first_alert  # recovery itself doesn't push

    await battery_alerts.on_battery(conn, "member-1", "Alex", "household-1", 15)
    assert len(conn.calls) > calls_after_first_alert  # dropped low again -> re-alerts


def test_forget_member_clears_state():
    battery_alerts._alerted.add("member-1")
    battery_alerts.forget_member("member-1")
    assert "member-1" not in battery_alerts._alerted
