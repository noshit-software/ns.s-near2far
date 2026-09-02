"""Arrival/departure push alerts for named places — Home (households.home_geofence, every
household already has exactly one) plus any custom places (substrate.places: school, work,
grandma's, etc.). Mirrors trips.py's per-member in-memory state pattern: track which places a
member is currently inside, and push only on the transition in/out, not on every position update
while stationary inside one.
"""

import json

from app.push import send_push_to_household
from app.trips import _haversine_m

# Per-member in-memory "which place ids are they currently inside" state. Not persisted — a
# backend restart just costs one possible missed transition, not a correctness issue.
_state: dict[str, set[str]] = {}


def forget_member(member_id: str) -> None:
    """Called on member deletion so this doesn't grow unbounded over the life of the process."""
    _state.pop(member_id, None)


async def on_position(
    conn,
    member_id: str,
    display_name: str,
    household_id: str,
    lat: float,
    lng: float,
) -> None:
    places: list[tuple[str, str, float, float, float]] = []

    household = await conn.fetchrow(
        "SELECT home_geofence FROM substrate.households WHERE id = $1", household_id
    )
    home_geofence = dict(household).get("home_geofence") if household is not None else None
    if home_geofence is not None:
        home = json.loads(home_geofence)
        places.append(("home", "Home", home["lat"], home["lng"], home["radius_m"]))

    rows = await conn.fetch(
        "SELECT id, name, lat, lng, radius_m FROM substrate.places WHERE household_id = $1",
        household_id,
    )
    for row in rows:
        places.append((str(row["id"]), row["name"], row["lat"], row["lng"], row["radius_m"]))

    now_inside = {
        place_id
        for place_id, _name, place_lat, place_lng, radius_m in places
        if _haversine_m(lat, lng, place_lat, place_lng) <= radius_m
    }
    was_inside = _state.get(member_id, set())
    names = {place_id: name for place_id, name, *_ in places}

    for place_id in now_inside - was_inside:
        await send_push_to_household(
            conn,
            household_id,
            {
                "title": f"{display_name} arrived at {names[place_id]}",
                "body": f"{display_name} is now at {names[place_id]}.",
                "tag": f"geofence-{member_id}-{place_id}",
            },
        )

    for place_id in was_inside - now_inside:
        # The place may have been deleted since the member entered it — fall back to a generic
        # label rather than KeyError-ing on a stale id.
        name = names.get(place_id, "a saved place")
        await send_push_to_household(
            conn,
            household_id,
            {
                "title": f"{display_name} left {name}",
                "body": f"{display_name} is no longer at {name}.",
                "tag": f"geofence-{member_id}-{place_id}",
            },
        )

    _state[member_id] = now_inside
