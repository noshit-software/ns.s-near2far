import { useState } from "react"

import { apiDelete, apiPost, getAdminPassword } from "../lib/api"
import { COLOR_PRESETS, resolveMemberColor } from "../lib/avatar"
import { AvatarPicker } from "./AvatarPicker"
import { CloseIcon } from "./icons"

type Member = {
  id: string
  display_name: string
  device_id: string | null
  avatar_filename: string | null
  avatar_seed: string
  color: string | null
}

export function MemberEditModal({
  member,
  onUpdated,
  onDeleted,
  onClose,
}: {
  member: Member
  onUpdated: (updated: Member) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(member.display_name)
  const [deviceId, setDeviceId] = useState(member.device_id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === member.display_name) return
    setError(null)
    try {
      const updated = await apiPost<Member>(`/setup/members/${member.id}`, {
        display_name: trimmed,
      })
      onUpdated(updated)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function pickColor(color: string) {
    setError(null)
    try {
      const updated = await apiPost<Member>(`/setup/members/${member.id}`, { color })
      onUpdated(updated)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function saveDevice() {
    setError(null)
    try {
      const updated = await apiPost<Member>(`/setup/members/${member.id}/device`, {
        device_id: deviceId.trim() || null,
      })
      onUpdated(updated)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // OwnTracks' HTTP endpoint auth is username=device_id, password=admin password (see
  // _verify_owntracks_auth in backend/app/api/positions.py) — this deep link pre-fills all of
  // that in the app itself (server URL, auth mode, credentials) instead of the member typing
  // four fields into OwnTracks by hand. Meant to be tapped directly on the phone being set up —
  // open this dashboard in that phone's browser, not scanned from another device.
  function ownTracksConfigUrl(): string | null {
    const trimmed = deviceId.trim()
    const password = getAdminPassword()
    if (!trimmed || !password) return null
    const config = {
      _type: "configuration",
      mode: 3,
      auth: true,
      username: trimmed,
      password,
      url: `${window.location.origin}/api/owntracks/forward`,
      tls: window.location.protocol === "https:",
    }
    return `owntracks:///config?inline=${btoa(JSON.stringify(config))}`
  }

  async function remove() {
    setError(null)
    setDeleting(true)
    try {
      await apiDelete(`/setup/members/${member.id}`)
      onDeleted(member.id)
    } catch (e) {
      setError((e as Error).message)
      setDeleting(false)
    }
  }

  return (
    <div className="member-edit-modal-root">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className="member-edit-backdrop" onClick={onClose} />
      <div className="member-edit-modal">
        <div className="member-edit-header">
          <h3>Edit member</h3>
          <button type="button" className="member-edit-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="member-edit-avatar-row">
          <AvatarPicker member={member} onUpdated={onUpdated} />
        </div>

        <label>
          Name
          <div className="member-edit-inline-field">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" onClick={saveName} disabled={!name.trim() || name.trim() === member.display_name}>
              Save
            </button>
          </div>
        </label>

        <label>
          Map color
          <div className="member-edit-color-row">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`member-edit-color-swatch ${resolveMemberColor(member) === c ? "active" : ""}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => pickColor(c)}
              />
            ))}
            <label
              className={`member-edit-color-swatch member-edit-color-custom ${
                !COLOR_PRESETS.includes(resolveMemberColor(member)) ? "active" : ""
              }`}
              style={{ background: resolveMemberColor(member) }}
              aria-label="Custom color"
            >
              <input
                type="color"
                value={resolveMemberColor(member)}
                onChange={(e) => pickColor(e.target.value)}
              />
            </label>
          </div>
        </label>

        <label>
          Device ID
          <div className="member-edit-inline-field">
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Device ID"
            />
            <button type="button" onClick={saveDevice}>
              Save
            </button>
          </div>
          {ownTracksConfigUrl() && (
            <>
              <a className="member-edit-owntracks-link" href={ownTracksConfigUrl() ?? undefined}>
                Configure OwnTracks app with this Device ID
              </a>
              <p className="member-edit-owntracks-hint">
                Only works tapped on the phone that has OwnTracks installed — open this page in
                that phone's own browser first.
              </p>
            </>
          )}
        </label>

        {error && <p className="error">{error}</p>}

        <div className="member-edit-danger-zone">
          {!confirmingDelete ? (
            <button type="button" className="member-edit-danger-button" onClick={() => setConfirmingDelete(true)}>
              Remove member
            </button>
          ) : (
            <div className="member-edit-confirm-row">
              <span>Remove {member.display_name}? This can't be undone.</span>
              <div className="member-edit-confirm-actions">
                <button type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="member-edit-danger-button"
                  onClick={remove}
                  disabled={deleting}
                >
                  Confirm remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
