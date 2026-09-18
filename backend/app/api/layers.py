import json
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.middleware.auth import require_admin_auth

log = logging.getLogger(__name__)

router = APIRouter()

_fire_cache: dict = {"data": None, "expires": 0.0}

USFS_URL = (
    "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/"
    "USA_Wildfires_v1/FeatureServer/1/query"
    "?where=1%3D1&outFields=IncidentName,GISAcres,CreateDate"
    "&f=geojson&resultRecordCount=500"
)

# Cache keyed by (rounded_lat, rounded_lng) — rounds to ~1 km grid
_ice_cache: dict = {"data": None, "expires": 0.0, "lat": None, "lng": None}


@router.get("/api/layers/wildfire")
async def get_wildfire():
    now = time.time()
    if _fire_cache["data"] is not None and _fire_cache["expires"] > now:
        return _fire_cache["data"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(USFS_URL)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        if _fire_cache["data"] is not None:
            return _fire_cache["data"]
        raise HTTPException(502, f"Failed to fetch fire data: {e}")

    _fire_cache["data"] = data
    _fire_cache["expires"] = now + 600
    return data


@router.get("/api/layers/ice", dependencies=[Depends(require_admin_auth)])
async def get_ice(
    lat: float = Query(...),
    lng: float = Query(...),
    distance: int = Query(default=75, ge=1, le=150),
):
    if not settings.stopice_api_key:
        raise HTTPException(503, "STOPICE_API_KEY not configured")

    now = time.time()
    cache_lat = round(lat, 2)
    cache_lng = round(lng, 2)
    if (
        _ice_cache["data"] is not None
        and _ice_cache["expires"] > now
        and _ice_cache["lat"] == cache_lat
        and _ice_cache["lng"] == cache_lng
    ):
        return _ice_cache["data"]

    url = (
        f"https://stopice.net/api/?key={settings.stopice_api_key}"
        f"&recentalerts=1&lat={lat}&long={lng}&distance={distance}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            clean = re.sub(r"[\x00-\x1f\x7f]", " ", r.text)
            raw = json.loads(clean)
    except Exception as e:
        if _ice_cache["data"] is not None:
            return _ice_cache["data"]
        raise HTTPException(502, f"StopICE API error: {e}")

    # Response: {"success":"true", "DATASET-ALERT:<id>": [{alert obj}], ...}
    # Each value is a single-element list; alert fields: id, created, priority,
    # address, lat, long (all strings), description, media, url
    if not isinstance(raw, dict):
        log.warning("stopice_unexpected_shape type=%s", type(raw).__name__)
        raw = {}

    features = []
    for key, val in raw.items():
        if not key.startswith("DATASET-ALERT:"):
            continue
        a = val[0] if isinstance(val, list) and val else val
        if not isinstance(a, dict):
            continue
        a_lat = a.get("lat")
        a_lng = a.get("long")
        if not a_lat or not a_lng:
            continue
        # "SEP 18, 2026 (09:41:19)" → ISO for the frontend age calculation
        created_iso: str | None = None
        created_raw = a.get("created", "")
        if created_raw:
            try:
                from datetime import datetime, timezone
                dt = datetime.strptime(created_raw, "%b %d, %Y (%H:%M:%S)")
                created_iso = dt.replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                created_iso = created_raw
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(a_lng), float(a_lat)]},
            "properties": {
                "id": a.get("id"),
                "address": a.get("address"),
                "description": a.get("description"),
                "priority": a.get("priority"),
                "created_at": created_iso,
                "url": a.get("url"),
            },
        })

    geojson: dict = {"type": "FeatureCollection", "features": features}
    _ice_cache.update({"data": geojson, "expires": now + 300, "lat": cache_lat, "lng": cache_lng})
    return geojson
