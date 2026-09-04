import { useState } from "react"

import { apiDelete, apiPost } from "../lib/api"
import { LocationPicker } from "./LocationPicker"

export type Place = {
  id: string
  name: string
  lat: number
  lng: number
  radius_m: number
}

// Named places beyond "Home" (school, work, grandma's...) — arriving/leaving any of them
// pushes an alert to the household the same way trip-end and low-battery alerts do. Home
// itself is edited separately above this (household.home_geofence), since every household
// already has exactly one and it predates this open-ended list.
export function PlacesManager({
  householdId,
  places,
  onChange,
}: {
  householdId: string
  places: Place[]
  onChange: (places: Place[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [radiusM, setRadiusM] = useState("100")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function submitNewPlace() {
    if (!name.trim() || !location) return
    setError(null)
    try {
      const created = await apiPost<Place>("/setup/places", {
        household_id: householdId,
        name: name.trim(),
        lat: location.lat,
        lng: location.lng,
        radius_m: Number(radiusM) || 100,
      })
      onChange([...places, created])
      setAdding(false)
      setName("")
      setLocation(null)
      setRadiusM("100")
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function updatePlace(place: Place) {
    setError(null)
    try {
      const updated = await apiPost<Place>(`/setup/places/${place.id}`, {
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        radius_m: place.radius_m,
      })
      onChange(places.map((p) => (p.id === place.id ? updated : p)))
      setEditingId(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function removePlace(placeId: string) {
    setError(null)
    try {
      await apiDelete(`/setup/places/${placeId}`)
      onChange(places.filter((p) => p.id !== placeId))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="places-manager settings-group">
      {places.length > 0 && (
        <ul className="places-list">
          {places.map((place) =>
            editingId === place.id ? (
              <li key={place.id} className="place-row place-row-editing">
                <input
                  value={place.name}
                  onChange={(e) =>
                    onChange(places.map((p) => (p.id === place.id ? { ...p, name: e.target.value } : p)))
                  }
                />
                <LocationPicker
                  value={{ lat: place.lat, lng: place.lng }}
                  radiusM={place.radius_m}
                  onChange={(pos) =>
                    onChange(places.map((p) => (p.id === place.id ? { ...p, ...pos } : p)))
                  }
                  height={270}
                />
                <label>
                  Radius (m)
                  <input
                    value={place.radius_m}
                    onChange={(e) =>
                      onChange(
                        places.map((p) =>
                          p.id === place.id ? { ...p, radius_m: Number(e.target.value) || 0 } : p,
                        ),
                      )
                    }
                  />
                </label>
                <div className="place-row-actions">
                  <button type="button" className="btn btn-add" onClick={() => updatePlace(place)}>
                    Save
                  </button>
                  <button type="button" className="btn btn-edit" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={place.id} className="place-row">
                <span className="place-row-name">{place.name}</span>
                <span className="place-row-radius">±{place.radius_m}m</span>
                <button type="button" className="btn btn-edit" onClick={() => setEditingId(place.id)}>
                  Edit
                </button>
                <button type="button" className="btn btn-remove" onClick={() => removePlace(place.id)}>
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {adding ? (
        <div className="place-add-form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="School, Work, Grandma's…"
              autoFocus
            />
          </label>
          <LocationPicker value={location} radiusM={Number(radiusM) || 0} onChange={setLocation} height={300} />
          <label>
            Radius (m)
            <input value={radiusM} onChange={(e) => setRadiusM(e.target.value)} />
          </label>
          <div className="place-row-actions">
            <button
              type="button"
              className="btn btn-add"
              onClick={submitNewPlace}
              disabled={!name.trim() || !location}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-edit"
              onClick={() => {
                setAdding(false)
                setName("")
                setLocation(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-add" onClick={() => setAdding(true)}>
          Add
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
