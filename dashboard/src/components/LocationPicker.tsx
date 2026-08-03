import "leaflet/dist/leaflet.css"

import L from "leaflet"
import { useEffect, useState } from "react"
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet"

type LatLng = { lat: number; lng: number }

const FALLBACK_CENTER: LatLng = { lat: 39.8283, lng: -98.5795 } // geographic center of the US

function ClickToMove({ onMove }: { onMove: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onMove({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

function FitToRadius({ center, radiusM }: { center: LatLng; radiusM: number }) {
  const map = useMap()
  useEffect(() => {
    const bounds = L.latLng(center.lat, center.lng).toBounds(Math.max(radiusM, 30) * 2.5)
    map.fitBounds(bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, radiusM])
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
  const [locating, setLocating] = useState(true)
  const [locateError, setLocateError] = useState<string | null>(null)

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setCenter(FALLBACK_CENTER)
      setLocateError("This browser doesn't support geolocation — click the map to set your pin.")
      setLocating(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCenter(here)
        setLocating(false)
        onChange(here)
      },
      (err) => {
        setCenter(FALLBACK_CENTER)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — click the map to set your pin."
            : "Couldn't get your location — click the map to set your pin.",
        )
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [onChange])

  if (locating || center === null) {
    return <div className="location-picker">finding your location…</div>
  }

  const marker = value ?? center

  return (
    <div className="location-picker">
      <MapContainer center={marker} zoom={16} style={{ height: 300, width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToMove onMove={onChange} />
        <FitToRadius center={marker} radiusM={radiusM} />
        <CircleMarker center={marker} radius={6} />
        <Circle center={marker} radius={radiusM} />
      </MapContainer>
      {locateError && <p className="hint">{locateError}</p>}
      <p className="hint">Click the map to move the pin — the shaded circle is your home geofence.</p>
    </div>
  )
}
