import { useEffect, useRef, useState } from "react"

import { getClientId } from "../lib/clientId"
import { BadgeIcon, BellIcon, CarIcon, MedicalCrossIcon, SuspiciousIcon } from "./icons"

type SosAlert = {
  id: number
  lat: number | null
  lng: number | null
  address: string | null
  category: string
  kind: "sos" | "help"
  contact_name: string | null
  origin_client_id: string
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "SOS",
  medical: "Medical emergency",
  security: "Authority threat",
  suspicious: "Being followed",
  car: "Car trouble",
}

const CATEGORY_ICONS: Record<string, () => JSX.Element> = {
  general: BellIcon,
  medical: MedicalCrossIcon,
  security: BadgeIcon,
  suspicious: SuspiciousIcon,
  car: CarIcon,
}

const HELP_TOAST_MS = 8000

// A siren built from oscillators instead of a bundled audio file — no asset to ship, and it
// keeps looping until silenced, which is the whole point: this needs to actually be heard.
function startSiren(): () => void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = "sawtooth"
  gain.gain.value = 0.15
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()

  let up = true
  const interval = setInterval(() => {
    osc.frequency.setTargetAtTime(up ? 880 : 440, ctx.currentTime, 0.05)
    up = !up
  }, 400)

  return () => {
    clearInterval(interval)
    osc.stop()
    ctx.close()
  }
}

// This is the *receiving* side — every household device except the one that triggered it (see
// SosButton/SosActiveBanner for that device's own view). Deliberately has no way to cancel a
// full "sos" alert itself: "silence" only stops this device's own sound/vibration, it does not
// tell the server anything. Only the device that triggered it can actually resolve it (with the
// admin password as a confirmation code), so a bystander — or whoever the emergency is about —
// can't make it go away by grabbing whichever phone happens to be nearest. A "help" alert (a
// category helper number like AAA was dialed) is a different, lighter tier: a self-dismissing
// toast, no siren, no vibration, no active state to disable.
export function SosAlarm({ lastEvent }: { lastEvent: unknown }) {
  const [alert, setAlert] = useState<SosAlert | null>(null)
  const [silenced, setSilenced] = useState(false)
  const [helpToast, setHelpToast] = useState<SosAlert | null>(null)
  const stopSiren = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!lastEvent || typeof lastEvent !== "object") return
    const { type, payload } = lastEvent as { type?: string; payload?: unknown }

    if (type === "sos.triggered") {
      const a = payload as SosAlert
      if (a.origin_client_id === getClientId()) return // the origin device gets its own UI instead
      if (a.kind === "help") {
        setHelpToast(a)
      } else {
        setAlert(a)
        setSilenced(false)
      }
    } else if (type === "sos.acknowledged") {
      const { id } = payload as { id: number }
      setAlert((prev) => (prev?.id === id ? null : prev))
    }
  }, [lastEvent])

  useEffect(() => {
    if (!helpToast) return
    const timer = setTimeout(() => setHelpToast(null), HELP_TOAST_MS)
    return () => clearTimeout(timer)
  }, [helpToast])

  useEffect(() => {
    if (alert && !silenced) {
      stopSiren.current = startSiren()
      const pattern = [500, 200, 500, 200, 500, 200, 500]
      navigator.vibrate?.(pattern)
      const vibrateLoop = setInterval(() => navigator.vibrate?.(pattern), 2600)
      return () => {
        stopSiren.current?.()
        stopSiren.current = null
        clearInterval(vibrateLoop)
        navigator.vibrate?.(0)
      }
    }
  }, [alert, silenced])

  if (!alert && helpToast) {
    return (
      <div className="sos-help-toast" role="status">
        <span className="sos-help-toast-text">
          {helpToast.contact_name ?? "A contact"} called — {CATEGORY_LABELS[helpToast.category] ?? "Help"}
        </span>
        <button type="button" onClick={() => setHelpToast(null)} aria-label="Dismiss">
          ×
        </button>
      </div>
    )
  }

  if (!alert) return null

  const Icon = CATEGORY_ICONS[alert.category]

  return (
    <div className={`sos-alarm-overlay ${silenced ? "sos-alarm-silenced" : ""}`} role="alert">
      <div className="sos-alarm-center">
        {Icon && (
          <div className="sos-alarm-icon">
            <Icon />
          </div>
        )}
        <div className="sos-alarm-label">{CATEGORY_LABELS[alert.category] ?? "SOS"}</div>
        <div className="sos-alarm-address">
          {alert.address ??
            (alert.lat != null ? `${alert.lat.toFixed(5)}, ${alert.lng?.toFixed(5)}` : "Location unavailable")}
        </div>
      </div>
      {!silenced ? (
        <button type="button" className="sos-alarm-ack" onClick={() => setSilenced(true)}>
          Silence
        </button>
      ) : (
        <p className="sos-alarm-silenced-note">Silenced — still active until cleared</p>
      )}
    </div>
  )
}
