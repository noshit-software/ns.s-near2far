import { useState } from "react"

import { apiDelete, apiPost } from "../lib/api"
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
