"""Low-battery push warning — a dead phone silently stops reporting location with no signal
that anything's wrong, which matters most exactly when it's least convenient to notice (a family
member traveling). OwnTracks reports battery percentage on every location report; this fires a
single push the first time a member's battery drops to the threshold, then stays quiet until it
recovers, so it's not a nag on every subsequent low-battery position update.
"""

from app.push import send_push_to_household

LOW_BATTERY_THRESHOLD = 20  # percent — push once when a member's battery drops to/below this
RECOVERY_THRESHOLD = 40  # percent — battery must climb back above this before re-alerting

# Per-member in-memory "already warned this low period" state. Not persisted — a backend
# restart just costs one possible re-alert, not a correctness issue.
_alerted: set[str] = set()


def forget_member(member_id: str) -> None:
    """Called on member deletion so this doesn't grow unbounded over the life of the process."""
    _alerted.discard(member_id)


async def on_battery(conn, member_id: str, display_name: str, household_id: str, battery: int | None) -> None:
    if battery is None:
        return

    if battery <= LOW_BATTERY_THRESHOLD and member_id not in _alerted:
        _alerted.add(member_id)
        await send_push_to_household(
            conn,
            household_id,
            {
                "title": f"{display_name}'s phone is low on battery",
                "body": f"{battery}% remaining — location tracking may stop reporting soon.",
                "tag": f"low-battery-{member_id}",
            },
        )
    elif battery > RECOVERY_THRESHOLD:
        _alerted.discard(member_id)
