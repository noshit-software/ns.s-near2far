import { useEffect, useState } from "react"

import { apiGet, apiPost, getAdminPassword, setAdminPassword } from "../lib/api"
import { generatedAvatarDataUri } from "../lib/avatar"
import { useEventStream } from "../lib/ws"
import { FamilyMap } from "./FamilyMap"
import { InfoIcon, MapIcon, SettingsIcon } from "./icons"
import { LocationPicker } from "./LocationPicker"
import { MemberEditModal } from "./MemberEditModal"
import { NotificationSetup } from "./NotificationSetup"
import { PasswordInput } from "./PasswordInput"
import { SosActiveBanner } from "./SosActiveBanner"
import { SosAlarm } from "./SosAlarm"
import { SosButton } from "./SosButton"

type Member = {
  id: string
  display_name: string
  device_id: string | null
  avatar_filename: string | null
  avatar_seed: string
  color: string | null
}

type Household = {
  id: string
  name: string
  home_geofence: { lat: number; lng: number; radius_m: number }
  members: Member[]
  emergency_contact_1_name: string | null
  emergency_contact_1_phone: string | null
  emergency_contact_2_name: string | null
  emergency_contact_2_phone: string | null
  emergency_contact_3_name: string | null
  emergency_contact_3_phone: string | null
  emergency_contact_4_name: string | null
  emergency_contact_4_phone: string | null
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
  const [showDeviceHint, setShowDeviceHint] = useState(false)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)

  const [contact1Name, setContact1Name] = useState("")
  const [contact1Phone, setContact1Phone] = useState("")
  const [contact2Name, setContact2Name] = useState("")
  const [contact2Phone, setContact2Phone] = useState("")
  const [contact3Name, setContact3Name] = useState("")
  const [contact3Phone, setContact3Phone] = useState("")
  const [contact4Name, setContact4Name] = useState("")
  const [contact4Phone, setContact4Phone] = useState("")

  const lastEvent = useEventStream()
  const [activeSosId, setActiveSosId] = useState<number | null>(null)

  useEffect(() => {
    if (!lastEvent || typeof lastEvent !== "object") return
    const { type, payload } = lastEvent as { type?: string; payload?: unknown }
    if (type === "sos.acknowledged") {
      const { id } = payload as { id: number }
      setActiveSosId((prev) => (prev === id ? null : prev))
    }
  }, [lastEvent])

  useEffect(() => {
    apiGet<Household | null>("/setup/household")
      .then(setHousehold)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!household) return
    setContact1Name(household.emergency_contact_1_name ?? "")
    setContact1Phone(household.emergency_contact_1_phone ?? "")
    setContact2Name(household.emergency_contact_2_name ?? "")
    setContact2Phone(household.emergency_contact_2_phone ?? "")
    setContact3Name(household.emergency_contact_3_name ?? "")
    setContact3Phone(household.emergency_contact_3_phone ?? "")
    setContact4Name(household.emergency_contact_4_name ?? "")
    setContact4Phone(household.emergency_contact_4_phone ?? "")
  }, [household?.id])

  async function saveEmergencyContacts() {
    if (!household) return
    setError(null)
    try {
      const updated = await apiPost<Household>("/setup/household/emergency-contacts", {
        emergency_contact_1_name: contact1Name || null,
        emergency_contact_1_phone: contact1Phone || null,
        emergency_contact_2_name: contact2Name || null,
        emergency_contact_2_phone: contact2Phone || null,
        emergency_contact_3_name: contact3Name || null,
        emergency_contact_3_phone: contact3Phone || null,
        emergency_contact_4_name: contact4Name || null,
        emergency_contact_4_phone: contact4Phone || null,
      })
      setHousehold({
        ...household,
        emergency_contact_1_name: updated.emergency_contact_1_name,
        emergency_contact_1_phone: updated.emergency_contact_1_phone,
        emergency_contact_2_name: updated.emergency_contact_2_name,
        emergency_contact_2_phone: updated.emergency_contact_2_phone,
        emergency_contact_3_name: updated.emergency_contact_3_name,
        emergency_contact_3_phone: updated.emergency_contact_3_phone,
        emergency_contact_4_name: updated.emergency_contact_4_name,
        emergency_contact_4_phone: updated.emergency_contact_4_phone,
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

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

  function updateMember(updated: Member) {
    if (!household) return
    setHousehold({
      ...household,
      members: household.members.map((m) => (m.id === updated.id ? updated : m)),
    })
  }

  function removeMember(memberId: string) {
    if (!household) return
    setHousehold({ ...household, members: household.members.filter((m) => m.id !== memberId) })
    setEditingMemberId(null)
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
    return (
      <div className="auth-screen">
        <div className="auth-card">loading setup…</div>
      </div>
    )
  }

  if (household === null) {
    return (
      <div className="auth-screen">
        <div className="auth-card setup-wizard">
          <h2>Set up your household</h2>
          <label>
            Household name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Admin password
            <PasswordInput value={adminPassword} onChange={setAdminPasswordInput} />
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
      </div>
    )
  }

  if (!unlocked) {
    return (
      <div className="auth-screen">
        <div className="auth-card setup-wizard">
          <h2>{household.name}</h2>
          <label>
            Admin password
            <PasswordInput value={loginPassword} onChange={setLoginPassword} />
          </label>
          <button onClick={submitLogin} disabled={!loginPassword}>
            Unlock
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <SosAlarm lastEvent={lastEvent} />
      {activeSosId != null && (
        <SosActiveBanner alertId={activeSosId} onCleared={() => setActiveSosId(null)} />
      )}
      <header className="app-topbar">
        <h1>{showSettings ? "Settings" : household.name}</h1>
      </header>

      <main className={`app-content ${!showSettings ? "app-content-map" : ""}`}>
        {!showSettings ? (
          <>
            <NotificationSetup />
            <FamilyMap household={household} lastEvent={lastEvent} />
          </>
        ) : (
          <div className="setup-wizard settings-panel">
            <h3>Home</h3>
            <LocationPicker
              value={household.home_geofence}
              radiusM={household.home_geofence.radius_m}
              onChange={updateGeofence}
              height={200}
              lockedByDefault
            />

            <div className="section-heading-row">
              <h3>Members</h3>
              <button
                type="button"
                className="info-toggle"
                aria-label="About linking a device"
                onClick={() => setShowDeviceHint(!showDeviceHint)}
              >
                <InfoIcon />
              </button>
            </div>
            {showDeviceHint && (
              <p className="hint">
                For real phone GPS via{" "}
                <a href="http://localhost:8082" target="_blank" rel="noreferrer">
                  Traccar
                </a>
                : create a device there and give it any identifier you want — it's just a label,
                not a real device number, e.g. <code>alex-phone</code> or{" "}
                <code>drakuls-galaxy-s25</code>. Paste that exact same text into the Device ID
                field below to link it to this member.
              </p>
            )}
            <ul>
              {household.members.map((m) => (
                <li key={m.id} className="member-row">
                  <button
                    type="button"
                    className="member-row-header member-row-edit-trigger"
                    onClick={() => setEditingMemberId(m.id)}
                  >
                    <img
                      className="member-row-avatar"
                      src={
                        m.avatar_filename
                          ? `/uploads/avatars/${m.avatar_filename}`
                          : generatedAvatarDataUri(m.avatar_seed)
                      }
                      alt=""
                    />
                    <span>{m.display_name}</span>
                    <span className="member-row-edit-hint">Edit</span>
                  </button>
                </li>
              ))}
            </ul>

            {editingMemberId &&
              (() => {
                const editing = household.members.find((m) => m.id === editingMemberId)
                return editing ? (
                  <MemberEditModal
                    member={editing}
                    onUpdated={updateMember}
                    onDeleted={removeMember}
                    onClose={() => setEditingMemberId(null)}
                  />
                ) : null
              })()}

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

            <h3>Emergency contacts</h3>
            <p className="hint">
              Shown as one-tap dial buttons on the SOS button, alongside 911 — for someone to call
              immediately in an emergency, not just be notified after the fact.
            </p>
            <div className="emergency-contact-row">
              <input
                value={contact1Name}
                onChange={(e) => setContact1Name(e.target.value)}
                placeholder="Name (e.g. Dad)"
              />
              <input
                value={contact1Phone}
                onChange={(e) => setContact1Phone(e.target.value)}
                placeholder="Phone number"
                type="tel"
              />
            </div>
            <div className="emergency-contact-row">
              <input
                value={contact2Name}
                onChange={(e) => setContact2Name(e.target.value)}
                placeholder="Name (e.g. Lawyer)"
              />
              <input
                value={contact2Phone}
                onChange={(e) => setContact2Phone(e.target.value)}
                placeholder="Phone number"
                type="tel"
              />
            </div>
            <div className="emergency-contact-row">
              <input
                value={contact3Name}
                onChange={(e) => setContact3Name(e.target.value)}
                placeholder="Name"
              />
              <input
                value={contact3Phone}
                onChange={(e) => setContact3Phone(e.target.value)}
                placeholder="Phone number"
                type="tel"
              />
            </div>
            <div className="emergency-contact-row">
              <input
                value={contact4Name}
                onChange={(e) => setContact4Name(e.target.value)}
                placeholder="Name"
              />
              <input
                value={contact4Phone}
                onChange={(e) => setContact4Phone(e.target.value)}
                placeholder="Phone number"
                type="tel"
              />
            </div>
            <button type="button" onClick={saveEmergencyContacts}>
              Save contacts
            </button>

            {error && <p className="error">{error}</p>}
          </div>
        )}
      </main>

      <nav className="tab-bar">
        <button
          type="button"
          className={`tab-button ${!showSettings ? "active" : ""}`}
          onClick={() => setShowSettings(false)}
        >
          <MapIcon />
          Map
        </button>
        <SosButton household={household} onTriggered={setActiveSosId} />
        <button
          type="button"
          className={`tab-button ${showSettings ? "active" : ""}`}
          onClick={() => setShowSettings(true)}
        >
          <SettingsIcon />
          Settings
        </button>
      </nav>
    </div>
  )
}
