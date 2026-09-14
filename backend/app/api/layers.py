import re
import time

import httpx
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()

_fire_cache: dict = {"data": None, "expires": 0.0}
_ice_cache: dict = {}  # keyed by bbox string, value: {data, expires}

USFS_URL = (
    "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/"
    "USA_Wildfires_v1/FeatureServer/1/query"
    "?where=1%3D1&outFields=IncidentName,GISAcres,CreateDate"
    "&f=geojson&resultRecordCount=500"
)

WAZE_URL = (
    "https://www.waze.com/live-map/api/georss"
    "?top={top}&bottom={bottom}&left={left}&right={right}"
    "&env=row&types=alerts"
)

# Keywords that appear in Waze report text for immigration enforcement activity
_ICE_RE = re.compile(
    r"ice\b|immigration|border patrol|migra|checkpoint|ret[eé]n|inmigr",
    re.IGNORECASE,
)


def _is_ice_alert(alert: dict) -> bool:
    text = " ".join(filter(None, [
        alert.get("reportDescription", ""),
        alert.get("subtype", ""),
        alert.get("street", ""),
    ]))
    return bool(_ICE_RE.search(text))


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
async def get_ice(
    top: float = Query(...),
    bottom: float = Query(...),
    left: float = Query(...),
    right: float = Query(...),
):
    bbox_key = f"{top:.3f},{bottom:.3f},{left:.3f},{right:.3f}"
    now = time.time()
    cached = _ice_cache.get(bbox_key)
    if cached and cached["expires"] > now:
        return cached["data"]

    url = WAZE_URL.format(top=top, bottom=bottom, left=left, right=right)
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.get(url)
            r.raise_for_status()
            waze_data = r.json()
    except Exception:
        return {"type": "FeatureCollection", "features": []}

    alerts = [
        a for a in (waze_data.get("alerts") or [])
        if a.get("type") == "POLICE" and _is_ice_alert(a)
    ]

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [a["location"]["x"], a["location"]["y"]]},
            "properties": {
                "description": a.get("reportDescription") or a.get("subtype", "Checkpoint"),
                "reported_at": a.get("pubMillis"),
            },
        }
        for a in alerts
        if a.get("location")
    ]

    result = {"type": "FeatureCollection", "features": features}
    _ice_cache[bbox_key] = {"data": result, "expires": now + 300}  # 5-minute cache
    return result
