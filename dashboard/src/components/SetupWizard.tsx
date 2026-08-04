import { useEffect, useState } from "react"

import { apiGet, apiPost, getAdminPassword, setAdminPassword } from "../lib/api"
import { FamilyMap } from "./FamilyMap"
import { LocationPicker } from "./LocationPicker"

type Member = {
  id: string
  display_name: string
  device_id: string | null
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
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [adminPassword, setAdminPasswordInput] = useState("")
  const [homeLocation, setHomeLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [radiusM, setRadiusM] = useState("75")

  const [loginPassword, setLoginPassword] = useState("")

  const [memberName, setMemberName] = useState("")
  const [deviceInputs, setDeviceInputs] = useState<Record<string, string>>({})

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

  async function saveMemberDevice(memberId: string) {
    if (!household) return
    setError(null)
    try {
      const updated = await apiPost<Member>(`/setup/members/${memberId}/device`, {
        device_id: deviceInputs[memberId]?.trim() || null,
      })
      setHousehold({
        ...household,
        members: household.members.map((m) => (m.id === memberId ? updated : m)),
      })
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

  if (!showSettings) {
    return (
      <div>
        <div className="dashboard-header">
          <h2>{household.name}</h2>
          <button
            type="button"
            className="settings-toggle"
            onClick={() => setShowSettings(true)}
          >
            Settings
          </button>
        </div>
        <FamilyMap household={household} />
      </div>
    )
  }

  return (
    <div className="setup-wizard">
      <div className="dashboard-header">
        <h2>{household.name} — Settings</h2>
        <button
          type="button"
          className="settings-toggle"
          onClick={() => setShowSettings(false)}
        >
          Back to map
        </button>
      </div>

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
          <li key={m.id} className="member-row">
            <span>{m.display_name}</span>
            <div className="member-device-row">
              <input
                value={deviceInputs[m.id] ?? m.device_id ?? ""}
                onChange={(e) => setDeviceInputs({ ...deviceInputs, [m.id]: e.target.value })}
                placeholder="Device ID"
              />
              <button onClick={() => saveMemberDevice(m.id)}>Save</button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">
        For real phone GPS via{" "}
        <a href="http://localhost:8082" target="_blank" rel="noreferrer">
          Traccar
        </a>
        : create a device there and give it any identifier you want — it's just a label, not a real
        device number, e.g. <code>alex-phone</code> or <code>drakuls-galaxy-s25</code>. Paste that
        exact same text into the field below to link it to this member.
      </p>

      <div className="member-form-row">
        <input
          value={memberName}
          onChange={(e) => setMemberName(e.target.value)}
          placeholder="Member name"
        />
        <button onClick={submitMember} disabled={!memberName}>
          Add member
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
