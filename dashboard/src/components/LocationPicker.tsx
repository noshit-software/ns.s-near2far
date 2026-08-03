import "leaflet/dist/leaflet.css"

import { useEffect, useState } from "react"
import { Circle, CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet"

type LatLng = { lat: number; lng: number }

const FALLBACK_CENTER: LatLng = { lat: 39.8283, lng: -98.5795 } // geographic center of the US
const FALLBACK_ZOOM = 4
const LOCATED_ZOOM = 16

function ClickToMove({ onMove }: { onMove: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onMove({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

export function LocationPicker({
  value,
  radiusM,
  onChange,
}: {
  value: LatLng | null
  radiusM: number
  onChange: (pos: LatLng) => void
}) {
  const [center, setCenter] = useState<LatLng | null>(null)
  const [zoom, setZoom] = useState(FALLBACK_ZOOM)
  const [locating, setLocating] = useState(true)

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setCenter(FALLBACK_CENTER)
      setLocating(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCenter(here)
        setZoom(LOCATED_ZOOM)
        setLocating(false)
        onChange(here)
      },
      () => {
        setCenter(FALLBACK_CENTER)
        setLocating(false)
      },
      { timeout: 8000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (locating || center === null) {
    return <div className="location-picker">finding your location…</div>
  }

  const marker = value ?? center

  return (
    <div className="location-picker">
      <MapContainer center={center} zoom={zoom} style={{ height: 300, width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToMove onMove={onChange} />
        <CircleMarker center={marker} radius={6} />
        <Circle center={marker} radius={radiusM} />
      </MapContainer>
      <p className="hint">Click the map to move the pin. This sets your home geofence.</p>
    </div>
  )
}
