import { useState } from "react"

import { apiPost, getAdminPassword } from "../lib/api"

// Shown only on the device that triggered the SOS (SetupWizard tracks that via the id returned
// from the trigger call). Disabling requires re-typing the admin password as a confirmation
// code — not because it's a new security boundary (this device already holds that password),
// but so the act of disabling takes a deliberate extra step. If someone the alert is about
// grabs this exact phone, "make it stop" shouldn't be a single tap.
export function SosActiveBanner({
  alertId,
  onCleared,
}: {
  alertId: number
  onCleared: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function disable() {
    setError(null)
    if (code !== getAdminPassword()) {
      setError("Wrong code")
      return
    }
    try {
      await apiPost(`/sos/${alertId}/acknowledge`, {})
    } catch (e) {
      setError((e as Error).message)
      return
    }
    onCleared()
  }

  return (
    <div className="sos-active-banner">
      {!confirming ? (
        <>
          <span>SOS active — everyone else's device is alarming</span>
          <button type="button" onClick={() => setConfirming(true)}>
            Disable
          </button>
        </>
      ) : (
        <div className="sos-active-banner-confirm">
          <input
            type="password"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === "Enter" && disable()}
            placeholder="Enter code to disable"
            autoFocus
          />
          <button type="button" onClick={disable}>
            Confirm
          </button>
          {error && <span className="sos-active-banner-error">{error}</span>}
        </div>
      )}
    </div>
  )
}
