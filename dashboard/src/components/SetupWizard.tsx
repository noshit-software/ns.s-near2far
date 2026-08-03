import { useEffect, useState } from "react"

import { apiGet, apiPost, getAdminPassword, setAdminPassword } from "../lib/api"
import { LocationPicker } from "./LocationPicker"

type TrustTier = "intimate" | "named" | "ambient"

const TRUST_TIER_INFO: Record<TrustTier, string> = {
  intimate: "Exact location, always visible — for people who live with you.",
  named: "General area only, no exact position — for close family elsewhere.",
  ambient: "Broadest, most private — the default for everyone else.",
}

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
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminPassword()))
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [adminPassword, setAdminPasswordInput] = useState("")
  const [homeLocation, setHomeLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [radiusM, setRadiusM] = useState("75")

  const [loginPassword, setLoginPassword] = useState("")

  const [memberName, setMemberName] = useState("")
  const [memberTier, setMemberTier] = useState<TrustTier>("ambient")

  useEffect(() => {
    apiGet<Household | null>("/setup/household")
      .then(setHousehold)
      .catch((e) => setError(e.message))
  }, [])

  async function submitHousehold() {
    if (!homeLocation) return
    setError(null)
    try {
      const created = await apiPost<Household>("/setup/household", {
        name,
        admin_password: adminPassword,
        home_geofence: { ...homeLocation, radius_m: Number(radiusM) },
      })
      setAdminPassword(adminPassword)
      setUnlocked(true)
      setHousehold({ ...created, members: [] })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function submitLogin() {
    setError(null)
    try {
      const { ok } = await apiPost<{ ok: boolean }>("/setup/verify", { password: loginPassword })
      if (!ok) throw new Error("Incorrect password")
      setAdminPassword(loginPassword)
      setUnlocked(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function updateGeofence(pos: { lat: number; lng: number }) {
    if (!household) return
    setError(null)
    try {
      const updated = await apiPost<Household>("/setup/household/geofence", {
        ...pos,
        radius_m: household.home_geofence.radius_m,
      })
      setHousehold({ ...household, home_geofence: updated.home_geofence })
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
          Admin password
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPasswordInput(e.target.value)}
          />
        </label>
        <LocationPicker
          value={homeLocation}
          radiusM={Number(radiusM) || 0}
          onChange={setHomeLocation}
        />
        <label>
          Geofence radius (m)
          <input value={radiusM} onChange={(e) => setRadiusM(e.target.value)} />
        </label>
        <button
          onClick={submitHousehold}
          disabled={!name || !adminPassword || !homeLocation}
        >
          Create household
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  if (!unlocked) {
    return (
      <div className="setup-wizard">
        <h2>{household.name}</h2>
        <label>
          Admin password
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
          />
        </label>
        <button onClick={submitLogin} disabled={!loginPassword}>
          Unlock
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="setup-wizard">
      <h2>{household.name}</h2>

      <h3>Home</h3>
      <LocationPicker
        value={household.home_geofence}
        radiusM={household.home_geofence.radius_m}
        onChange={updateGeofence}
        height={200}
        lockedByDefault
      />

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
      <div className="member-form-row">
        <select value={memberTier} onChange={(e) => setMemberTier(e.target.value as TrustTier)}>
          <option value="intimate">intimate</option>
          <option value="named">named</option>
          <option value="ambient">ambient</option>
        </select>
        <button onClick={submitMember} disabled={!memberName}>
          Add member
        </button>
      </div>
      <p className="hint">{TRUST_TIER_INFO[memberTier]}</p>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
