import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.middleware.auth import require_admin_auth

router = APIRouter()

_fire_cache: dict = {"data": None, "expires": 0.0}

USFS_URL = (
    "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/"
    "USA_Wildfires_v1/FeatureServer/1/query"
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
    _fire_cache["expires"] = now + 600
    return data


@router.get("/api/layers/ice", dependencies=[Depends(require_admin_auth)])
async def get_ice(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        household_id = await conn.fetchval(
            "SELECT id FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        rows = await conn.fetch(
            "SELECT id, lat, lng, note, reported_at FROM runtime.checkpoint_reports "
            "WHERE household_id = $1 AND expires_at > now() ORDER BY reported_at DESC",
            household_id,
        )

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]},
            "properties": {
                "id": r["id"],
                "note": r["note"],
                "reported_at": r["reported_at"].isoformat(),
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


class CheckpointReport(BaseModel):
    lat: float
    lng: float
    note: str | None = None


@router.post("/api/layers/ice/report", dependencies=[Depends(require_admin_auth)])
async def report_checkpoint(body: CheckpointReport, request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        household_id = await conn.fetchval(
            "SELECT id FROM substrate.households ORDER BY created_at LIMIT 1"
        )
        row = await conn.fetchrow(
            "INSERT INTO runtime.checkpoint_reports (household_id, lat, lng, note) "
            "VALUES ($1, $2, $3, $4) RETURNING id, reported_at, expires_at",
            household_id, body.lat, body.lng, body.note,
        )
    return {"success": True, "data": {"id": row["id"], "reported_at": row["reported_at"].isoformat()}}
