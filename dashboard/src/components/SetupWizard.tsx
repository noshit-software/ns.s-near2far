import { useEffect, useState } from "react"

import { apiGet, apiPost } from "../lib/api"

type TrustTier = "intimate" | "named" | "ambient"

type Member = {
  id: string
  display_name: string
  trust_tier: TrustTier
}

type Household = {
  id: string
  name: string
  home_geofence: { lat: number; lng: number; radius_m: number }
  members: Member[]
}

export function SetupWizard() {
  const [household, setHousehold] = useState<Household | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [radiusM, setRadiusM] = useState("150")

  const [memberName, setMemberName] = useState("")
  const [memberTier, setMemberTier] = useState<TrustTier>("ambient")

  useEffect(() => {
    apiGet<Household | null>("/setup/household")
      .then(setHousehold)
      .catch((e) => setError(e.message))
  }, [])

  async function submitHousehold() {
    setError(null)
    try {
      const created = await apiPost<Household>("/setup/household", {
        name,
        home_geofence: { lat: Number(lat), lng: Number(lng), radius_m: Number(radiusM) },
      })
      setHousehold({ ...created, members: [] })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function submitMember() {
    if (!household) return
    setError(null)
    try {
      const created = await apiPost<Member>("/setup/members", {
        household_id: household.id,
        display_name: memberName,
        trust_tier: memberTier,
      })
      setHousehold({ ...household, members: [...household.members, created] })
      setMemberName("")
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (household === undefined) {
    return <div className="setup-wizard">loading setup…</div>
  }

  if (household === null) {
    return (
      <div className="setup-wizard">
        <h2>Set up your household</h2>
        <label>
          Household name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Home latitude
          <input value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          Home longitude
          <input value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
        <label>
          Geofence radius (m)
          <input value={radiusM} onChange={(e) => setRadiusM(e.target.value)} />
        </label>
        <button onClick={submitHousehold} disabled={!name || !lat || !lng}>
          Create household
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="setup-wizard">
      <h2>{household.name}</h2>
      <p>
        Home: {household.home_geofence.lat}, {household.home_geofence.lng} (±
        {household.home_geofence.radius_m}m)
      </p>

      <h3>Members</h3>
      <ul>
        {household.members.map((m) => (
          <li key={m.id}>
            {m.display_name} — {m.trust_tier}
          </li>
        ))}
      </ul>

      <label>
        Add member
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} />
      </label>
      <select value={memberTier} onChange={(e) => setMemberTier(e.target.value as TrustTier)}>
        <option value="intimate">intimate</option>
        <option value="named">named</option>
        <option value="ambient">ambient</option>
      </select>
      <button onClick={submitMember} disabled={!memberName}>
        Add member
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
