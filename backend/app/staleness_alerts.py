"""
Background task that pushes a notification when a member's location report goes stale.

OwnTracks doesn't send a signal when it stops (killed by OS, background permission revoked,
phone off, etc.) — the server just goes quiet. This polls the DB every CHECK_INTERVAL seconds
and fires one push per stale period so the admin knows to check the phone. The alert
clears automatically once a fresh position comes in.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from app.push import send_push_to_household

log = structlog.get_logger(__name__)

STALE_THRESHOLD = timedelta(minutes=30)
CHECK_INTERVAL = 5 * 60  # seconds

_alerted: set[str] = set()  # member_ids we've already pushed for this stale period


def on_fresh_position(member_id: str) -> None:
    """Call this whenever a live position arrives so the alert rearms after recovery."""
    _alerted.discard(member_id)


async def _check(db_pool) -> None:
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (p.member_id)
                p.member_id::text,
                m.display_name,
                m.household_id::text,
                p.recorded_at
            FROM runtime.positions p
            JOIN substrate.members m ON m.id = p.member_id
            ORDER BY p.member_id, p.recorded_at DESC
            """
        )

        now = datetime.now(timezone.utc)
        for row in rows:
            member_id = row["member_id"]
            recorded_at = row["recorded_at"]
            if recorded_at.tzinfo is None:
                recorded_at = recorded_at.replace(tzinfo=timezone.utc)
            age = now - recorded_at

            if age > STALE_THRESHOLD and member_id not in _alerted:
                _alerted.add(member_id)
                hours = int(age.total_seconds() // 3600)
                mins = int((age.total_seconds() % 3600) // 60)
                age_str = f"{hours}h {mins}m" if hours else f"{mins}m"
                log.warning("position_stale", member=row["display_name"], age=age_str)
                await send_push_to_household(
                    conn,
                    row["household_id"],
                    {
                        "title": f"{row['display_name']}'s location is stale",
                        "body": f"No update in {age_str}. OwnTracks may have stopped reporting.",
                        "tag": f"stale-{member_id}",
                    },
                )
            elif age <= STALE_THRESHOLD:
                _alerted.discard(member_id)


async def run_staleness_watcher(db_pool) -> None:
    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            await _check(db_pool)
        except Exception:
            log.exception("staleness_check_error")
