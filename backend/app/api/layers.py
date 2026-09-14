import time

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter()

_fire_cache: dict = {"data": None, "expires": 0.0}

USFS_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
    "Current_WildlandFire_Perimeters/FeatureServer/0/query"
    "?where=1%3D1&outFields=IncidentName,GISAcres,CreateDate"
    "&f=geojson&resultRecordCount=500"
)


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
    _fire_cache["expires"] = now + 600  # 10-minute cache
    return data


@router.get("/api/layers/ice")
async def get_ice():
    # Placeholder — crowdsourced checkpoint sources TBD
    return {"type": "FeatureCollection", "features": []}
