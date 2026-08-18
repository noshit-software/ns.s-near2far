import "leaflet/dist/leaflet.css"

import L from "leaflet"
import { useEffect, useRef, useState } from "react"
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet"

import { apiGet } from "../lib/api"
import { generatedAvatarDataUri, resolveMemberColor } from "../lib/avatar"
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
  color: string | null
  lat: number
  lng: number
  recorded_at: string
}

// Full avatar size at "close" zoom, in px. Every other tier below is a fraction of this.
const BASE_SIZE = 120

// Zoom >= the key's threshold gets that fraction of BASE_SIZE, photo/generated avatar. Below
// the lowest key (15), it drops to a plain colored dot at 20% — a full avatar reads as noise
// once the map is showing a whole city rather than a neighborhood, and shouldn't just cap out
// at one fixed size for every zoom level above that, it should keep shrinking as you zoom out.
const ZOOM_SIZE_TIERS: [minZoom: number, fraction: number][] = [
  [18, 1.0],
  [17, 0.8],
  [16, 0.6],
  [15, 0.4],
]
const DOT_FRACTION = 0.2

function memberIcon(p: Position, zoom: number): L.DivIcon {
  const color = resolveMemberColor({ id: p.member_id, color: p.color })
  const tier = ZOOM_SIZE_TIERS.find(([minZoom]) => zoom >= minZoom)

  if (!tier) {
    const size = Math.round(BASE_SIZE * DOT_FRACTION)
    return L.divIcon({
      className: "member-pin-wrapper",
      html: `<div class="member-pin-dot" style="background:${color}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    })
  }

  const size = Math.round(BASE_SIZE * tier[1])
  const borderWidth = Math.max(2, Math.round(size * (5 / BASE_SIZE)))
  const imageUrl = p.avatar_filename
    ? `/uploads/avatars/${p.avatar_filename}`
    : generatedAvatarDataUri(p.avatar_seed)

  return L.divIcon({
    className: "member-pin-wrapper",
    html: `<div class="member-pin-photo" style="background-image:url('${imageUrl}');border-color:${color};border-width:${borderWidth}px"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

// Zoom to snap to when centering on a member, based on their current speed — close-in for
// someone stationary/walking, progressively further out the faster they're moving so a
// driving member's road context stays visible instead of the map staying at walking-zoom.
// Thresholds match the backend's own walking/driving classification (app/trips.py).
function zoomForSpeed(speedMps: number | undefined): number {
  if (speedMps === undefined) return 16
  if (speedMps < 0.8) return 18 // stationary
  if (speedMps < 3) return 17 // walking
  if (speedMps < 8) return 15 // city driving
  if (speedMps < 15) return 13 // faster driving
  return 11 // highway
}

function statusForSpeed(speedMps: number | undefined): string {
  if (speedMps === undefined) return ""
  if (speedMps < 0.8) return "Stationary"
  if (speedMps < 3) return `Walking · ${Math.round(speedMps * 3.6)} km/h`
  return `Driving · ${Math.round(speedMps * 3.6)} km/h`
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
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
  const speedsRef = useRef<Record<string, number>>({})
  const lastEvent = useEventStream()
  const [, forceTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  function updateSpeed(prev: Position | undefined, next: Position) {
    if (!prev) return
    const dtS = (new Date(next.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000
    if (dtS <= 0) return
    const distM = haversineM(prev.lat, prev.lng, next.lat, next.lng)
    speedsRef.current[next.member_id] = distM / dtS
  }

  function snapTo(p: Position) {
    mapRef.current?.flyTo([p.lat, p.lng], zoomForSpeed(speedsRef.current[p.member_id]))
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
      setPositions((prev) => {
        updateSpeed(prev[payload.member_id], payload)
        return { ...prev, [payload.member_id]: payload }
      })
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
          <div className="member-panel-grid">
            {positionList.map((p) => {
              const status = statusForSpeed(speedsRef.current[p.member_id])
              return (
                <button
                  key={p.member_id}
                  type="button"
                  className="member-panel"
                  onClick={() => snapTo(p)}
                >
                  <img
                    className="member-panel-avatar"
                    src={
                      p.avatar_filename
                        ? `/uploads/avatars/${p.avatar_filename}`
                        : generatedAvatarDataUri(p.avatar_seed)
                    }
                    alt=""
                  />
                  <div className="member-panel-info">
                    <span className="member-panel-name">{p.display_name}</span>
                    <span className="member-panel-meta">
                      {status && <span className="member-panel-status">{status}</span>}
                      <span className="member-panel-time">{relativeTime(p.recorded_at)}</span>
                    </span>
                  </div>
                </button>
              )
            })}
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
