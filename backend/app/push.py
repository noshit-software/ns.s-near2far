import asyncio
import json

import structlog
from pywebpush import WebPushException, webpush

from app.config import settings

log = structlog.get_logger(__name__)


def _send_one(endpoint: str, p256dh: str, auth: str, payload: dict) -> int | None:
    """Blocking send (pywebpush uses requests). Returns an HTTP status code on
    failure so the caller can prune dead subscriptions, None on success."""
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_claims_sub},
        )
        return None
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        log.warning("push_send_failed", status=status, error=str(e))
        return status


async def send_push_to_household(
    conn, household_id: str, payload: dict, exclude_endpoint: str | None = None
) -> None:
    if not settings.vapid_private_key:
        log.warning("push_skipped_no_vapid_key")
        return

    rows = await conn.fetch(
        "SELECT id, endpoint, p256dh, auth FROM substrate.push_subscriptions "
        "WHERE household_id = $1 AND ($2::text IS NULL OR endpoint != $2)",
        household_id,
        exclude_endpoint,
    )

    dead_ids = []
    for row in rows:
        status = await asyncio.to_thread(_send_one, row["endpoint"], row["p256dh"], row["auth"], payload)
        if status in (404, 410):
            dead_ids.append(row["id"])

    if dead_ids:
        await conn.execute("DELETE FROM substrate.push_subscriptions WHERE id = ANY($1::bigint[])", dead_ids)
