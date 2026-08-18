import math
from datetime import datetime

import structlog

from app.push import send_push_to_household

log = structlog.get_logger(__name__)

MOVING_SPEED_MPS = 0.8  # ~1.8 mph — below this, a member is considered stationary
STOP_TIMEOUT_S = 180  # how long stationary before an active trip is considered ended
DRIVING_AVG_SPEED_MPS = 3.0  # ~6.7 mph — trips averaging above this are reported as driving
MIN_TRIP_DURATION_S = 30
MIN_TRIP_DISTANCE_M = 50

# Per-member in-memory trip state. Not persisted — restarting the backend just
# forgets any trip in progress, which only costs one missed end-of-trip alert.
_state: dict[str, dict] = {}


def forget_member(member_id: str) -> None:
    """Called on member deletion so this doesn't grow unbounded over the life of the process."""
    _state.pop(member_id, None)


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def on_position(
    conn,
    member_id: str,
    display_name: str,
    household_id: str,
    lat: float,
    lng: float,
    recorded_at: datetime,
) -> None:
    ts = recorded_at.timestamp()
    st = _state.get(member_id)

    if st is None:
        _state[member_id] = {
            "lat": lat,
            "lng": lng,
            "ts": ts,
            "trip_active": False,
            "trip_start_ts": None,
            "distance_m": 0.0,
            "max_speed_mps": 0.0,
            "last_moving_ts": ts,
        }
        return

    dt = ts - st["ts"]
    if dt <= 0:
        return

    dist = _haversine_m(st["lat"], st["lng"], lat, lng)
    speed = dist / dt

    if speed >= MOVING_SPEED_MPS:
        if not st["trip_active"]:
            st["trip_active"] = True
            st["trip_start_ts"] = st["ts"]
            st["distance_m"] = 0.0
            st["max_speed_mps"] = 0.0
        st["distance_m"] += dist
        st["max_speed_mps"] = max(st["max_speed_mps"], speed)
        st["last_moving_ts"] = ts
    elif st["trip_active"] and ts - st["last_moving_ts"] >= STOP_TIMEOUT_S:
        duration_s = st["last_moving_ts"] - st["trip_start_ts"]
        if duration_s >= MIN_TRIP_DURATION_S and st["distance_m"] >= MIN_TRIP_DISTANCE_M:
            avg_speed = st["distance_m"] / duration_s
            mode = "driving" if avg_speed >= DRIVING_AVG_SPEED_MPS else "walking"
            await send_push_to_household(
                conn,
                household_id,
                {
                    "title": f"{display_name} stopped",
                    "body": (
                        f"Finished {mode} — {st['distance_m'] / 1000:.1f} km in "
                        f"{round(duration_s / 60)} min, avg {avg_speed * 3.6:.0f} km/h"
                    ),
                    "tag": f"trip-end-{member_id}",
                },
            )
        st["trip_active"] = False

    st["lat"], st["lng"], st["ts"] = lat, lng, ts
