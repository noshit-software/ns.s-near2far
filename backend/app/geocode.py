import httpx
import structlog

log = structlog.get_logger(__name__)

# Nominatim reverse geocoding just needs to name the nearest road, not resolve a precise
# house-level point (the thing that made forward/search geocoding unreliable for this app —
# see README). Best-effort only: an SOS alert should never fail to send because geocoding
# timed out, so any error here just means the alert goes out without an address.
_NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
_USER_AGENT = "near2far/1.0 (family location app; https://near2far.family)"


async def nearest_address(lat: float, lng: float) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(
                _NOMINATIM_URL,
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 17},
                headers={"User-Agent": _USER_AGENT},
            )
            res.raise_for_status()
            data = res.json()
    except Exception as e:
        log.warning("reverse_geocode_failed", error=str(e))
        return None

    addr = data.get("address", {})
    road = addr.get("road")
    if not road:
        return data.get("display_name")

    locality = addr.get("suburb") or addr.get("city") or addr.get("town") or addr.get("village")
    return f"{road}, {locality}" if locality else road
