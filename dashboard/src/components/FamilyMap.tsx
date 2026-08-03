import "leaflet/dist/leaflet.css"

import { useEffect, useRef, useState } from "react"
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet"

import { apiGet, apiPost } from "../lib/api"
import { useEventStream } from "../lib/ws"

const IDENTITY_KEY = "near2far_member_id"
const REPORT_INTERVAL_MS = 15_000

type Member = { id: string; display_name: string }

type Household = {
  id: string
  name: string
  home_geofence: { lat: number; lng: number; radius_m: number }
  members: Member[]
}

type Position = {
  member_id: string
  display_name: string
  lat: number
  lng: number
  recorded_at: string
}

function FitToMarkers({ positions, home }: { positions: Position[]; home: { lat: number; lng: number } }) {
  const map = useMap()
  useEffect(() => {
    const points: [number, number][] = [
      [home.lat, home.lng],
      ...positions.map((p): [number, number] => [p.lat, p.lng]),
    ]
    if (points.length === 1) {
      map.setView(points[0], 14)
    } else {
      map.fitBounds(points, { padding: [40, 40] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map((p) => `${p.member_id}:${p.lat}:${p.lng}`).join(","), home.lat, home.lng])
  return null
}

export function FamilyMap({ household }: { household: Household }) {
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [selfId, setSelfId] = useState<string>(() => localStorage.getItem(IDENTITY_KEY) ?? "")
  const [geoError, setGeoError] = useState<string | null>(null)
  const lastSentAt = useRef(0)
  const lastEvent = useEventStream()

  useEffect(() => {
    apiGet<Position[]>("/positions/latest")
      .then((rows) => {
        const byMember: Record<string, Position> = {}
        for (const row of rows) byMember[row.member_id] = row
        setPositions(byMember)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (
      lastEvent &&
      typeof lastEvent === "object" &&
      (lastEvent as { type?: string }).type === "position.updated"
    ) {
      const payload = (lastEvent as { payload: Position }).payload
      setPositions((prev) => ({ ...prev, [payload.member_id]: payload }))
    }
  }, [lastEvent])

  useEffect(() => {
    if (!selfId) return
    if (!("geolocation" in navigator)) {
      setGeoError("This browser doesn't support geolocation.")
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastSentAt.current < REPORT_INTERVAL_MS) return
        lastSentAt.current = now
        apiPost("/positions", {
          member_id: selfId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }).catch(() => {})
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — can't report your position."
            : "Couldn't get your location.",
        )
      },
      { enableHighAccuracy: true },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [selfId])

  function selectSelf(id: string) {
    setSelfId(id)
    if (id) localStorage.setItem(IDENTITY_KEY, id)
    else localStorage.removeItem(IDENTITY_KEY)
  }

  const positionList = Object.values(positions)

  return (
    <div className="family-map">
      <label className="identity-picker">
        Reporting as
        <select value={selfId} onChange={(e) => selectSelf(e.target.value)}>
          <option value="">Not reporting</option>
          {household.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>
      {geoError && <p className="hint">{geoError}</p>}

      <MapContainer
        center={household.home_geofence}
        zoom={14}
        attributionControl={false}
        style={{ height: 400, width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitToMarkers positions={positionList} home={household.home_geofence} />
        {positionList.map((p) => (
          <CircleMarker key={p.member_id} center={{ lat: p.lat, lng: p.lng }} radius={8}>
            <Popup>
              {p.display_name}
              <br />
              {new Date(p.recorded_at).toLocaleTimeString()}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <p className="map-attribution">
        Map data &copy;{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  )
}
