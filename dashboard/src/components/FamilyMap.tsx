import "leaflet/dist/leaflet.css"

import L from "leaflet"
import { useEffect, useMemo, useRef, useState } from "react"
import { GeoJSON, MapContainer, Marker, Popup, Tooltip, TileLayer, useMap, useMapEvents } from "react-leaflet"

import { apiGet } from "../lib/api"
import { generatedAvatarDataUri, resolveMemberColor } from "../lib/avatar"

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
  battery: number | null
  recorded_at: string
}

// Matches the backend's own low-battery push threshold (app/battery_alerts.py) so the map
// badge appears exactly when a warning would've fired, not at some independently-chosen cutoff.
const LOW_BATTERY_THRESHOLD = 20

const STALE_THRESHOLD_MS = 30 * 60 * 1000

function isStale(recorded_at: string): boolean {
  return Date.now() - new Date(recorded_at).getTime() > STALE_THRESHOLD_MS
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

function iconSizePx(zoom: number): number {
  const tier = ZOOM_SIZE_TIERS.find(([minZoom]) => zoom >= minZoom)
  return Math.round(BASE_SIZE * (tier ? tier[1] : DOT_FRACTION))
}

function memberIcon(p: Position, zoom: number): L.DivIcon {
  const color = resolveMemberColor({ id: p.member_id, color: p.color })
  const tier = ZOOM_SIZE_TIERS.find(([minZoom]) => zoom >= minZoom)
  const size = iconSizePx(zoom)

  if (!tier) {
    return L.divIcon({
      className: "member-pin-wrapper",
      html: `<div class="member-pin-dot" style="background:${color}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    })
  }

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

// When two+ members are close enough on screen that their icons would overlap, nudge each
// one outward from the shared centroid instead of letting them stack directly on top of each
// other and hide all but the topmost. Pixel-space clustering (via the map's own projection at
// the current zoom) rather than a fixed lat/lng threshold, so "close enough to overlap" tracks
// the icon's actual on-screen size at every zoom level instead of being wrong at some of them.
function spreadOverlapping(
  positions: Position[],
  map: L.Map | null,
  zoom: number,
): Record<string, L.LatLng> {
  const result: Record<string, L.LatLng> = {}
  if (!map) {
    for (const p of positions) result[p.member_id] = L.latLng(p.lat, p.lng)
    return result
  }

  const size = iconSizePx(zoom)
  const minDist = size * 0.9
  const projected = positions.map((p) => ({ p, pt: map.project([p.lat, p.lng], zoom) }))
  const placed = new Set<string>()

  for (const { p, pt } of projected) {
    if (placed.has(p.member_id)) continue

    const cluster = projected.filter(
      (o) => !placed.has(o.p.member_id) && Math.hypot(o.pt.x - pt.x, o.pt.y - pt.y) < minDist,
    )

    if (cluster.length === 1) {
      result[p.member_id] = L.latLng(p.lat, p.lng)
      placed.add(p.member_id)
      continue
    }

    const cx = cluster.reduce((sum, c) => sum + c.pt.x, 0) / cluster.length
    const cy = cluster.reduce((sum, c) => sum + c.pt.y, 0) / cluster.length
    const radius = size * 0.55

    cluster.forEach((c, i) => {
      const angle = (2 * Math.PI * i) / cluster.length - Math.PI / 2
      const offsetPt = L.point(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
      result[c.p.member_id] = map.unproject(offsetPt, zoom)
      placed.add(c.p.member_id)
    })
  }

  return result
}

function sosIcon(): L.DivIcon {
  return L.divIcon({
    className: "sos-map-marker-wrapper",
    html: `<div class="sos-map-marker"><div class="sos-map-marker-ring"></div><div class="sos-map-marker-dot"></div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
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

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function projectPoint(lat: number, lng: number, bearing: number, distanceM: number): [number, number] {
  const R = 6371000
  const d = distanceM / R
  const b = (bearing * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lng1 = (lng * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI]
}

// Zoom to snap to when centering on a member, based on their current speed — close-in for
// someone stationary/walking, progressively further out the faster they're moving so a
// driving member's road context stays visible instead of the map staying at walking-zoom.
// Thresholds match the backend's own walking/driving classification (app/trips.py).
function zoomForSpeed(speedMps: number | undefined): number {
  if (speedMps === undefined) return 16
  if (speedMps < 0.8) return 18   // stationary
  if (speedMps < 3) return 17     // walking (~6 mph)
  if (speedMps < 8) return 16     // slow city (~18 mph)
  if (speedMps < 18) return 15    // city driving (~40 mph)
  if (speedMps < 30) return 13    // fast/highway (~67 mph)
  if (speedMps < 40) return 12    // very fast (~89 mph)
  return 8                         // aircraft (40+ m/s ≈ 145+ km/h)
}

function motionLabel(speedMps: number | undefined, recordedAt: string): string {
  const ageS = (Date.now() - new Date(recordedAt).getTime()) / 1000
  if (ageS > 300) return "Stopped"
  if (speedMps === undefined || speedMps < 0.8) return "Stationary"
  if (speedMps < 3) return "Walking"
  return "Driving"
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

function FitToMarkers({
  positions,
  home,
  locked,
}: {
  positions: Position[]
  home: { lat: number; lng: number }
  locked: boolean
}) {
  const map = useMap()
  useEffect(() => {
    if (locked) return
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
  }, [positions.map((p) => `${p.member_id}:${p.lat}:${p.lng}`).join(","), home.lat, home.lng, locked])
  return null
}

function ZoomTracker({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  })
  return null
}

const _flameIcon = L.divIcon({
  className: "",
  html: '<span style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">🔥</span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function _ringCentroid(coords: number[][]): [number, number] {
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length
  return [lat, lng]
}

function _featureCentroid(f: GeoJSON.Feature): [number, number] | null {
  const g = f.geometry
  if (g.type === "Polygon") return _ringCentroid(g.coordinates[0])
  if (g.type === "MultiPolygon") {
    const largest = g.coordinates.reduce((a, b) => a[0].length >= b[0].length ? a : b)
    return _ringCentroid(largest[0])
  }
  return null
}

function WildfireLayer({ onLoading }: { onLoading: (v: boolean) => void }) {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null)

  useEffect(() => {
    function fetch_() {
      onLoading(true)
      fetch("/api/layers/wildfire")
        .then((r) => r.json())
        .then((d) => { setData(d); onLoading(false) })
        .catch(() => onLoading(false))
    }
    fetch_()
    const id = setInterval(fetch_, 10 * 60 * 1000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const centroids = useMemo(() => {
    if (!data || !Array.isArray(data.features)) return []
    return data.features.flatMap((f) => {
      const pos = _featureCentroid(f)
      if (!pos) return []
      return [{ pos, name: f.properties?.IncidentName as string | undefined, acres: f.properties?.GISAcres as number | undefined }]
    })
  }, [data])

  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) return null
  return (
    <>
      <GeoJSON
        key={data.features.length}
        data={data}
        style={{ color: "#ff4500", weight: 1.5, fillColor: "#ff6b00", fillOpacity: 0.25 }}
      />
      {centroids.map((c, i) => (
        <Marker key={i} position={c.pos} icon={_flameIcon}>
          <Popup>
            <strong>{c.name ?? "Wildfire"}</strong>
            {c.acres != null && <><br />{Math.round(c.acres).toLocaleString()} acres</>}
          </Popup>
        </Marker>
      ))}
    </>
  )
}

const _ICE_PRIORITY_OPACITY = [0.2, 0.25, 0.45, 0.65, 0.85, 1.0]

function iceIcon(priority: number | null, ageMin: number | null): L.DivIcon {
  const opacity = _ICE_PRIORITY_OPACITY[Math.max(1, Math.min(priority ?? 1, 5))]
  // Grayscale 0% (fresh) → 85% (23h) — independent of priority
  const gray = ageMin != null ? Math.min(85, Math.round((ageMin / 1440) * 85)) : 0
  return L.divIcon({
    className: "",
    html: `<span style="font-size:18px;line-height:1;opacity:${opacity};filter:grayscale(${gray}%) drop-shadow(0 1px 2px rgba(0,0,0,.6))">🧊</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function IceLayer({
  positions,
  refreshToken,
  onData,
  onLoading,
}: {
  positions: Position[]
  refreshToken: number
  onData: (features: GeoJSON.Feature[]) => void
  onLoading: (v: boolean) => void
}) {
  const [features, setFeatures] = useState<GeoJSON.Feature[]>([])

  async function refresh() {
    if (positions.length === 0) return
    onLoading(true)
    const auth = `Bearer ${localStorage.getItem("near2far_admin_password") ?? ""}`
    const seen = new Map<string, GeoJSON.Feature>()

    await Promise.all(
      positions.map(async (p) => {
        const params = new URLSearchParams({ lat: p.lat.toFixed(5), lng: p.lng.toFixed(5), distance: "75" })
        try {
          const r = await fetch(`/api/layers/ice?${params}`, { headers: { Authorization: auth } })
          const d = await r.json() as GeoJSON.FeatureCollection
          if (d.type === "FeatureCollection") {
            for (const f of d.features) {
              const key = (f.properties?.id as string | null) ?? JSON.stringify(f.geometry)
              if (!seen.has(key)) seen.set(key, f)
            }
          }
        } catch { /* ignore */ }
      })
    )

    const merged = Array.from(seen.values())
    setFeatures(merged)
    onData(merged)
    onLoading(false)
  }

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 5 * 60 * 1000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, positions.map((p) => `${p.lat},${p.lng}`).join("|")])

  return (
    <>
      {features.map((f, i) => {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
        const props = f.properties ?? {}
        const ageMin = props.created_at
          ? Math.round((Date.now() - new Date(props.created_at as string).getTime()) / 60000)
          : null
        const ageLabel = ageMin == null ? null
          : ageMin < 60 ? `${ageMin}m ago`
          : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago`
          : `${Math.round(ageMin / 1440)}d ago`
        return (
          <Marker key={(props.id as string | null) ?? i} position={[lat, lng]} icon={iceIcon(props.priority != null ? Number(props.priority) : null, ageMin)}>
            <Popup>
              <strong>ICE Activity</strong>
              {props.address && <><br />{props.address}</>}
              {ageLabel != null && <><br />{ageLabel}</>}
              {props.priority != null && (() => {
                const p = Math.max(1, Math.min(Number(props.priority), 5))
                return <><br /><span style={{ fontWeight: 600 }}>{"●".repeat(p)}{"○".repeat(5 - p)}</span> confidence</>
              })()}
              {props.description && <><br /><em style={{ fontSize: "0.85em" }}>{(props.description as string).replace(/ - stopice\.net$/, "")}</em></>}
              {props.url && <><br /><a href={props.url as string} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em" }}>stopice.net</a></>}
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}

type ChimeNote = { freq: number; start: number; duration: number }

function _playNotes(notes: ChimeNote[]) {
  try {
    const ctx = new AudioContext()
    for (const { freq, start, duration } of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.28, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + duration + 0.05)
    }
  } catch {
    // AudioContext blocked (no user gesture yet) — silent fallback
  }
}

// Warm ascending arpeggio (C5–E5–G5–C6) for home arrivals
function chimeHome() {
  _playNotes([
    { freq: 523.25, start: 0.00, duration: 0.55 },
    { freq: 659.25, start: 0.16, duration: 0.55 },
    { freq: 783.99, start: 0.32, duration: 0.55 },
    { freq: 1046.5, start: 0.48, duration: 0.90 },
  ])
}

// Softer 2-note chime for any other place
function chimePlace() {
  _playNotes([
    { freq: 659.25, start: 0.00, duration: 0.45 },
    { freq: 880.00, start: 0.20, duration: 0.70 },
  ])
}

export function FamilyMap({ household, lastEvent }: { household: Household; lastEvent: unknown }) {
  const [wildfireOn, setWildfireOn] = useState(false)
  const [wildfireLoading, setWildfireLoading] = useState(false)
  const [iceOn, setIceOn] = useState(false)
  const [iceLoading, setIceLoading] = useState(false)
  const [iceRefreshCount, setIceRefreshCount] = useState(0)
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [zoom, setZoom] = useState(14)
  const mapRef = useRef<L.Map | null>(null)
  const motionRef = useRef<Record<string, { speed: number; bearing: number | null }>>({})
  const iceDataRef = useRef<GeoJSON.Feature[]>([])
  const [sosMarker, setSosMarker] = useState<{ id: number; lat: number; lng: number; category: string } | null>(
    null,
  )
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null)
  const activeMemberIdRef = useRef<string | null>(null)
  const followZoomRef = useRef<number | null>(null)
  const [, forceTick] = useState(0)

  function setActiveAndTrack(id: string | null) {
    activeMemberIdRef.current = id
    followZoomRef.current = null
    setActiveMemberId(id)
  }

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  function updateMotion(prev: Position | undefined, next: Position) {
    if (!prev) return
    const dtS = (new Date(next.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000
    if (dtS < 5) return
    const distM = haversineM(prev.lat, prev.lng, next.lat, next.lng)
    const mps = distM / dtS
    if (mps > 60) return
    const bearing = mps >= 0.8 ? bearingDeg(prev.lat, prev.lng, next.lat, next.lng) : null
    motionRef.current[next.member_id] = { speed: mps, bearing }
  }

  function snapTo(p: Position) {
    const z = zoomForSpeed(motionRef.current[p.member_id]?.speed)
    followZoomRef.current = z
    mapRef.current?.flyTo([p.lat, p.lng], z)
  }

  function refetchPositions() {
    apiGet<Position[]>("/positions/latest")
      .then((rows) => {
        const byMember: Record<string, Position> = {}
        for (const row of rows) byMember[row.member_id] = row
        setPositions(byMember)
      })
      .catch(() => {})
  }

  useEffect(() => {
    refetchPositions()
  }, [])

  // A backgrounded/locked/slept device can leave the WebSocket dead for a long stretch without
  // the tab itself ever closing — reconnecting (see lib/ws.ts) or the tab becoming visible again
  // are the two moments that matter: catch up on whatever position updates were missed, rather
  // than leaving a marker frozen at its last-known spot indefinitely.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refetchPositions()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  useEffect(() => {
    if (!lastEvent || typeof lastEvent !== "object") return
    const { type, payload } = lastEvent as { type?: string; payload?: unknown }

    if (type === "position.updated") {
      const p = payload as Position
      setPositions((prev) => {
        updateMotion(prev[p.member_id], p)
        return { ...prev, [p.member_id]: p }
      })
      if (activeMemberIdRef.current === p.member_id) {
        const targetZoom = zoomForSpeed(motionRef.current[p.member_id]?.speed)
        if (followZoomRef.current !== targetZoom) {
          followZoomRef.current = targetZoom
          mapRef.current?.flyTo([p.lat, p.lng], targetZoom)
        } else {
          mapRef.current?.panTo([p.lat, p.lng])
        }
      }
    } else if (type === "sos.triggered") {
      const a = payload as { id: number; lat: number | null; lng: number | null; category: string; kind: string }
      if (a.lat == null || a.lng == null || a.kind !== "sos") return
      setSosMarker({ id: a.id, lat: a.lat, lng: a.lng, category: a.category })
      mapRef.current?.flyTo([a.lat, a.lng], 17)
    } else if (type === "sos.acknowledged") {
      const { id } = payload as { id: number }
      setSosMarker((prev) => (prev?.id === id ? null : prev))
    } else if (type === "geofence.entered") {
      const g = payload as { is_home: boolean }
      if (g.is_home) chimeHome(); else chimePlace()
    } else if (type === "ws.reconnected") {
      refetchPositions()
    }
  }, [lastEvent])

  const positionList = Object.values(positions)
  const spread = spreadOverlapping(positionList, mapRef.current, zoom)

  // If the active member disappears (left the household, etc.), clear the selection so the
  // map goes back to fit-all mode. But don't auto-select on startup — start with no selection.
  useEffect(() => {
    if (!activeMemberId || positions[activeMemberId]) return
    setActiveAndTrack(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionList.map((p) => p.member_id).join(",")])

  const activeMember = activeMemberId ? positions[activeMemberId] : undefined
  const activeMotion = activeMember ? motionRef.current[activeMember.member_id] : undefined
  const activeSpeedMps = activeMotion?.speed

  // For a driving member, project their trajectory and warn if ICE activity is on the path.
  // Look-ahead: 10 min at current speed (capped at 25 mi). Warn if alert within 2 mi of that point.
  let iceAhead: { distMi: number; address: string | null } | null = null
  if (activeMember && iceOn && iceDataRef.current.length > 0 && activeMotion) {
    const { speed, bearing } = activeMotion
    if (speed >= 3 && bearing !== null) {
      const lookAheadM = Math.min(speed * 600, 40_000)
      const [projLat, projLng] = projectPoint(activeMember.lat, activeMember.lng, bearing, lookAheadM)
      for (const f of iceDataRef.current) {
        if (f.geometry.type !== "Point") continue
        const [fLng, fLat] = (f.geometry as GeoJSON.Point).coordinates
        if (haversineM(projLat, projLng, fLat, fLng) < 3200) {
          const distMi = Math.round(haversineM(activeMember.lat, activeMember.lng, fLat, fLng) / 1609)
          iceAhead = { distMi, address: (f.properties?.address as string | null) ?? null }
          break
        }
      }
    }
  }

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
        <FitToMarkers positions={positionList} home={household.home_geofence} locked={activeMemberId !== null} />
        <ZoomTracker onZoom={setZoom} />
        {positionList.map((p) => (
          <Marker key={p.member_id} position={spread[p.member_id] ?? [p.lat, p.lng]} icon={memberIcon(p, zoom)}>
            <Popup>
              {p.display_name}
              <br />
              {new Date(p.recorded_at).toLocaleTimeString()}
            </Popup>
          </Marker>
        ))}
        {sosMarker && <Marker position={[sosMarker.lat, sosMarker.lng]} icon={sosIcon()} zIndexOffset={1000} />}
        {wildfireOn && <WildfireLayer onLoading={setWildfireLoading} />}
        {iceOn && (
          <IceLayer
            positions={positionList}
            refreshToken={iceRefreshCount}
            onData={(f) => { iceDataRef.current = f }}
            onLoading={setIceLoading}
          />
        )}
      </MapContainer>
      <div className="map-layer-toggles">
        <button
          type="button"
          className={`map-layer-btn ${wildfireOn ? "active" : ""} ${wildfireLoading ? "loading" : ""}`}
          onClick={() => setWildfireOn((v) => !v)}
          title="Wildfire"
        >{wildfireLoading ? "⏳" : "🔥"}</button>
        <button
          type="button"
          className={`map-layer-btn ${iceOn ? "active" : ""} ${iceLoading ? "loading" : ""}`}
          onClick={() => { setIceOn((v) => !v); setIceRefreshCount((n) => n + 1) }}
          title="ICE activity"
        >{iceLoading ? "⏳" : "🧊"}</button>
      </div>
      <div className="map-overlay-bottom">
        {positionList.length > 0 && (
          <div className="member-strip">
            {positionList.map((p) => (
              <div key={p.member_id} className="member-strip-avatar-wrap">
                <button
                  type="button"
                  className={`member-strip-avatar ${p.member_id === activeMemberId ? "active" : ""}`}
                  onClick={() => {
                    if (p.member_id === activeMemberId) {
                      setActiveAndTrack(null)
                    } else {
                      setActiveAndTrack(p.member_id)
                      snapTo(p)
                    }
                  }}
                  aria-label={p.display_name}
                >
                  <img
                    src={
                      p.avatar_filename
                        ? `/uploads/avatars/${p.avatar_filename}`
                        : generatedAvatarDataUri(p.avatar_seed)
                    }
                    alt=""
                  />
                </button>
                {p.member_id === activeMemberId && <span className="member-strip-deselect">✕</span>}
                {isStale(p.recorded_at) && <span className="member-strip-stale" title="Location is stale" />}
              </div>
            ))}
          </div>
        )}
        {activeMember && (
          <div className="member-detail">
            <img
              className="member-detail-avatar"
              src={
                activeMember.avatar_filename
                  ? `/uploads/avatars/${activeMember.avatar_filename}`
                  : generatedAvatarDataUri(activeMember.avatar_seed)
              }
              alt=""
            />
            <div className="member-detail-info">
              <span className="member-detail-name">{activeMember.display_name}</span>
              <span className="member-detail-meta">
                <span className="member-panel-status">
                  {motionLabel(activeSpeedMps, activeMember.recorded_at)}
                  {activeSpeedMps !== undefined && activeSpeedMps >= 0.8 &&
                    (Date.now() - new Date(activeMember.recorded_at).getTime()) / 1000 <= 300 && (
                    <>
                      {" · "}
                      <strong>{Math.round(activeSpeedMps * 2.237)} mph</strong>
                      {" | "}
                      {Math.round(activeSpeedMps * 3.6)} km/h
                    </>
                  )}
                </span>
                <span className="member-panel-time">{relativeTime(activeMember.recorded_at)}</span>
                {activeMember.battery !== null && activeMember.battery <= LOW_BATTERY_THRESHOLD && (
                  <span className="member-panel-battery-low">🔋 {activeMember.battery}%</span>
                )}
                {isStale(activeMember.recorded_at) && (
                  <span className="member-panel-stale">⚠ Location stale — OwnTracks may have stopped</span>
                )}
                {iceAhead && (
                  <span className="member-panel-ice-ahead">
                    🧊 ICE activity ~{iceAhead.distMi}mi ahead{iceAhead.address ? ` · ${iceAhead.address}` : ""}
                  </span>
                )}
              </span>
            </div>
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
