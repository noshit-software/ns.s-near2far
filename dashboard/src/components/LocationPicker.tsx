import "leaflet/dist/leaflet.css"

import L from "leaflet"
import { useEffect, useRef, useState } from "react"
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
  height = 300,
  lockedByDefault = false,
}: {
  value: LatLng | null
  radiusM: number
  onChange: (pos: LatLng) => void
  height?: number
  lockedByDefault?: boolean
}) {
  const hadInitialValue = useRef(value !== null)
  const [center, setCenter] = useState<LatLng | null>(value)
  const [locating, setLocating] = useState(!hadInitialValue.current)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [editing, setEditing] = useState(!lockedByDefault)

  useEffect(() => {
    if (hadInitialValue.current) return

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

  function handleMove(pos: LatLng) {
    if (!editing) return
    onChange(pos)
  }

  return (
    <div className="location-picker">
      <div className="location-map-wrap">
        <MapContainer
          center={marker}
          zoom={16}
          attributionControl={false}
          style={{ height, width: "100%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickToMove onMove={handleMove} />
          <FitToRadius center={marker} radiusM={radiusM} />
          <CircleMarker center={marker} radius={6} />
          <Circle center={marker} radius={radiusM} />
        </MapContainer>
        {lockedByDefault && (
          <button
            type="button"
            className="location-edit-toggle"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <p className="hint">
        {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)} · ±{radiusM}m
        {editing ? " — click the map to move the pin" : ""}
      </p>
      {locateError && <p className="hint">{locateError}</p>}
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
