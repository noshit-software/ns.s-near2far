import "leaflet/dist/leaflet.css"

import type L from "leaflet"
import { useEffect, useRef, useState } from "react"
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet"

import { apiGet } from "../lib/api"
import { useEventStream } from "../lib/ws"

type Household = {
  id: string
  name: string
  home_geofence: { lat: number; lng: number; radius_m: number }
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
  const mapRef = useRef<L.Map | null>(null)
  const lastEvent = useEventStream()

  function snapTo(p: Position) {
    mapRef.current?.flyTo([p.lat, p.lng], 16)
  }

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

  const positionList = Object.values(positions)

  return (
    <div className="family-map">
      <MapContainer
        ref={mapRef}
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
      {positionList.length > 0 && (
        <div className="member-snap-row">
          {positionList.map((p) => (
            <button
              key={p.member_id}
              type="button"
              className="member-snap-button"
              onClick={() => snapTo(p)}
            >
              {p.display_name}
            </button>
          ))}
        </div>
      )}
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
