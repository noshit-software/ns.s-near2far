"""Best-effort auto-provisioning of Traccar devices via its own REST API — so setting a
member's Device ID in near2far's own Settings is the only manual step, instead of also having to
create a matching device in Traccar's separate web UI. Entirely optional: every function here
no-ops (logs a warning, never raises) when `TRACCAR_API_URL`/`TRACCAR_ADMIN_EMAIL`/
`TRACCAR_ADMIN_PASS` aren't all set, so an install that hasn't configured this just falls back to
today's manual step with no behavior change.
"""

import httpx
import structlog

from app.config import settings

log = structlog.get_logger(__name__)


async def ensure_traccar_device(unique_id: str) -> None:
    if not (settings.traccar_api_url and settings.traccar_admin_email and settings.traccar_admin_pass):
        return

    try:
        async with httpx.AsyncClient(base_url=settings.traccar_api_url, timeout=5.0) as client:
            # Traccar's API is session-cookie authenticated, not token-based — log in once per
            # call. Cheap enough (this only runs when an admin sets a Device ID, not per-position).
            session = await client.post(
                "/api/session",
                data={"email": settings.traccar_admin_email, "password": settings.traccar_admin_pass},
            )
            session.raise_for_status()

            existing = await client.get("/api/devices", params={"uniqueId": unique_id})
            existing.raise_for_status()
            if existing.json():
                return  # already provisioned — nothing to do

            created = await client.post(
                "/api/devices", json={"name": unique_id, "uniqueId": unique_id}
            )
            created.raise_for_status()
            log.info("traccar_device_created", unique_id=unique_id)
    except httpx.HTTPError as e:
        # Never blocks the near2far-side Device ID save over this — worst case, the operator
        # falls back to creating the device by hand in Traccar's own UI, same as before this
        # existed.
        log.warning("traccar_device_provision_failed", unique_id=unique_id, error=str(e))
