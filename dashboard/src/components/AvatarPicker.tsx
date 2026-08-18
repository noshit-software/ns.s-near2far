import { useState } from "react"

import { apiPost, apiUpload } from "../lib/api"
import { generatedAvatarDataUri, randomSeed } from "../lib/avatar"
import { AvatarCropper } from "./AvatarCropper"
import { CloseIcon } from "./icons"

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
  const [cropUrl, setCropUrl] = useState<string | null>(null)

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

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setError(null)
    setCropUrl(URL.createObjectURL(file))
  }

  function adjustExistingPhoto() {
    if (!member.avatar_filename) return
    setError(null)
    setCropUrl(`/uploads/avatars/${member.avatar_filename}`)
  }

  function cancelCrop() {
    if (cropUrl) URL.revokeObjectURL(cropUrl)
    setCropUrl(null)
  }

  async function confirmCrop(blob: Blob) {
    setError(null)
    try {
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" })
      const updated = await apiUpload<Member>(`/setup/members/${member.id}/avatar`, file)
      onUpdated(updated)
      cancelCrop()
      setOpen(false)
    } catch (err) {
      setError((err as Error).message)
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
              <span>{cropUrl ? "Adjust photo" : "Choose avatar"}</span>
              <button
                type="button"
                className="avatar-picker-close"
                onClick={cropUrl ? cancelCrop : () => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            {cropUrl ? (
              <AvatarCropper imageUrl={cropUrl} onCancel={cancelCrop} onConfirm={confirmCrop} />
            ) : (
              <>
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
                  {member.avatar_filename ? (
                    <button type="button" onClick={adjustExistingPhoto}>
                      Adjust crop
                    </button>
                  ) : (
                    <button type="button" onClick={shuffle}>
                      Shuffle
                    </button>
                  )}
                  <label className="avatar-picker-upload">
                    Upload photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={onFileSelected}
                    />
                  </label>
                </div>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}
