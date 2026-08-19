import { useEffect, useRef, useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"

type SosAlert = {
  id: number
  lat: number | null
  lng: number | null
  address: string | null
  category: string
  origin_client_id: string
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "SOS",
  medical: "Medical emergency",
  security: "Security threat",
}

// A siren built from oscillators instead of a bundled audio file — no asset to ship, and it
// keeps looping until acknowledged, which is the whole point: this needs to actually be heard.
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

export function SosAlarm({ lastEvent }: { lastEvent: unknown }) {
  const [alert, setAlert] = useState<SosAlert | null>(null)
  const stopSiren = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!lastEvent || typeof lastEvent !== "object") return
    const { type, payload } = lastEvent as { type?: string; payload?: unknown }

    if (type === "sos.triggered") {
      const a = payload as SosAlert
      if (a.origin_client_id === getClientId()) return // don't alarm the device that triggered it
      setAlert(a)
    } else if (type === "sos.acknowledged") {
      const { id } = payload as { id: number }
      setAlert((prev) => (prev?.id === id ? null : prev))
    }
  }, [lastEvent])

  useEffect(() => {
    if (alert) {
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
  }, [alert])

  if (!alert) return null

  async function acknowledge() {
    if (!alert) return
    try {
      await apiPost(`/sos/${alert.id}/acknowledge`, {})
    } catch {
      // The WS broadcast will still clear it locally once someone else acknowledges;
      // don't block dismissing this device's alarm on the request succeeding.
    }
    setAlert(null)
  }

  return (
    <div className="sos-alarm-overlay" role="alert">
      <div className="sos-alarm-label">{CATEGORY_LABELS[alert.category] ?? "SOS"}</div>
      <div className="sos-alarm-address">
        {alert.address ?? (alert.lat != null ? `${alert.lat.toFixed(5)}, ${alert.lng?.toFixed(5)}` : "Location unavailable")}
      </div>
      <button type="button" className="sos-alarm-ack" onClick={acknowledge}>
        I see it — stop alarm
      </button>
    </div>
  )
}
