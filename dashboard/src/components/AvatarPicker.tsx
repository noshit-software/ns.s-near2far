import { useState } from "react"

import { apiPost, apiUpload } from "../lib/api"
import { generatedAvatarDataUri, randomSeed } from "../lib/avatar"

type Member = {
  id: string
  display_name: string
  device_id: string | null
  avatar_filename: string | null
  avatar_seed: string
}

export function AvatarPicker({
  member,
  onUpdated,
}: {
  member: Member
  onUpdated: (updated: Member) => void
}) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const currentSrc = member.avatar_filename
    ? `/uploads/avatars/${member.avatar_filename}`
    : generatedAvatarDataUri(member.avatar_seed)

  function shuffle() {
    setCandidates(Array.from({ length: 6 }, () => randomSeed()))
  }

  function toggle() {
    if (!open) shuffle()
    setOpen(!open)
  }

  async function pickSeed(seed: string) {
    setError(null)
    try {
      const updated = await apiPost<Member>(`/setup/members/${member.id}/avatar-seed`, {
        avatar_seed: seed,
      })
      onUpdated(updated)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const updated = await apiUpload<Member>(`/setup/members/${member.id}/avatar`, file)
      onUpdated(updated)
      setOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      e.target.value = ""
    }
  }

  return (
    <div className="avatar-picker">
      <button type="button" className="avatar-picker-current" onClick={toggle}>
        <img src={currentSrc} alt="" />
      </button>

      {open && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div className="avatar-picker-backdrop" onClick={() => setOpen(false)} />
          {/* Keyboard/screen-reader users get a real, focusable close control instead. */}
          <div className="avatar-picker-panel">
            <div className="avatar-picker-panel-header">
              <span>Choose avatar</span>
              <button type="button" className="avatar-picker-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="avatar-picker-grid">
              {candidates.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  className="avatar-picker-option"
                  onClick={() => pickSeed(seed)}
                >
                  <img src={generatedAvatarDataUri(seed)} alt="" />
                </button>
              ))}
            </div>
            <div className="avatar-picker-actions">
              <button type="button" onClick={shuffle}>
                Shuffle
              </button>
              <label className="avatar-picker-upload">
                Upload photo
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} />
              </label>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}
