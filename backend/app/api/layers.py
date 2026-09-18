import logging
import os
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

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

STOPICE_API_KEY = os.getenv("STOPICE_API_KEY", "")

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
    distance: int = Query(default=20, ge=1, le=100),
):
    if not STOPICE_API_KEY:
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
        f"https://stopice.net/api/?key={STOPICE_API_KEY}"
        f"&recentalerts=1&lat={lat}&long={lng}&distance={distance}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            raw = r.json()
    except Exception as e:
        if _ice_cache["data"] is not None:
            return _ice_cache["data"]
        raise HTTPException(502, f"StopICE API error: {e}")

    # Response shape is undocumented — try common patterns
    alerts: list = []
    if isinstance(raw, list):
        alerts = raw
    elif isinstance(raw, dict):
        for key in ("alerts", "data", "results", "items"):
            if key in raw and isinstance(raw[key], list):
                alerts = raw[key]
                break
        if not alerts:
            log.warning("stopice_unexpected_shape keys=%s", list(raw.keys()))

    features = []
    for a in alerts:
        a_lat = a.get("lat") or a.get("latitude")
        a_lng = a.get("lng") or a.get("lon") or a.get("longitude") or a.get("long")
        if a_lat is None or a_lng is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(a_lng), float(a_lat)]},
            "properties": {
                "id": a.get("id"),
                "address": a.get("address"),
                "comments": a.get("comments"),
                "priority": a.get("priority"),
                "created_at": a.get("created_at") or a.get("date") or a.get("timestamp") or a.get("time"),
            },
        })

    geojson: dict = {"type": "FeatureCollection", "features": features}
    _ice_cache.update({"data": geojson, "expires": now + 300, "lat": cache_lat, "lng": cache_lng})
    return geojson
