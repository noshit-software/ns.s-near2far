import "leaflet/dist/leaflet.css"

import L from "leaflet"
import { useEffect, useRef, useState } from "react"
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet"

import { apiGet } from "../lib/api"
import { generatedAvatarDataUri, memberColor } from "../lib/avatar"
import { useEventStream } from "../lib/ws"

type Household = {
  id: string
  name: string
  home_geofence: { lat: number; lng: number; radius_m: number }
}

type Position = {
  member_id: string
  display_name: string
  avatar_filename: string | null
  avatar_seed: string
  lat: number
  lng: number
  recorded_at: string
}

// Below this zoom, avatars shrink to plain colored dots — a full photo/generated avatar
// reads as noise once the map is showing a whole city rather than a neighborhood.
const AVATAR_ZOOM_THRESHOLD = 15

function memberIcon(p: Position, zoom: number): L.DivIcon {
  const color = memberColor(p.member_id)

  if (zoom < AVATAR_ZOOM_THRESHOLD) {
    return L.divIcon({
      className: "member-pin-wrapper",
      html: `<div class="member-pin-dot" style="background:${color}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -8],
    })
  }

  const imageUrl = p.avatar_filename
    ? `/uploads/avatars/${p.avatar_filename}`
    : generatedAvatarDataUri(p.avatar_seed)

  return L.divIcon({
    className: "member-pin-wrapper",
    html: `<div class="member-pin-photo" style="background-image:url('${imageUrl}');border-color:${color}"></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  })
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

function ZoomTracker({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  })
  return null
}

export function FamilyMap({ household }: { household: Household }) {
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [zoom, setZoom] = useState(14)
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
        className="family-map-canvas"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitToMarkers positions={positionList} home={household.home_geofence} />
        <ZoomTracker onZoom={setZoom} />
        {positionList.map((p) => (
          <Marker key={p.member_id} position={{ lat: p.lat, lng: p.lng }} icon={memberIcon(p, zoom)}>
            <Popup>
              {p.display_name}
              <br />
              {new Date(p.recorded_at).toLocaleTimeString()}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="map-overlay-bottom">
        {positionList.length > 0 && (
          <div className="member-snap-row">
            {positionList.map((p) => (
              <button
                key={p.member_id}
                type="button"
                className="member-snap-button"
                onClick={() => snapTo(p)}
              >
                <img
                  className="member-snap-avatar"
                  src={p.avatar_filename ? `/uploads/avatars/${p.avatar_filename}` : generatedAvatarDataUri(p.avatar_seed)}
                  alt=""
                />
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
    </div>
  )
}
