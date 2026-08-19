import { useRef, useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"

const TAP_WINDOW_MS = 600
const TAPS_TO_TRIGGER = 3

type Category = "general" | "medical" | "security"

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: "medical", label: "Medical", icon: "+" },
  { key: "security", label: "Security", icon: "!" },
]

async function ownPushEndpoint(): Promise<string | undefined> {
  if (!("serviceWorker" in navigator)) return undefined
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub?.endpoint
  } catch {
    return undefined
  }
}

function currentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 5000, maximumAge: 30000 },
    )
  })
}

export function SosButton() {
  const [expanded, setExpanded] = useState(false)
  const [taps, setTaps] = useState<Record<string, number>>({})
  const [sending, setSending] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  async function fire(category: Category) {
    setSending(true)
    setExpanded(false)
    setTaps({})
    try {
      const [pos, exclude_endpoint] = await Promise.all([currentPosition(), ownPushEndpoint()])
      await apiPost("/sos/trigger", {
        origin_client_id: getClientId(),
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
        category,
        exclude_endpoint,
      })
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    } catch {
      // Best-effort — the button itself has no error UI; a failed trigger is silent rather
      // than adding a failure mode to an already-stressful moment.
    } finally {
      setSending(false)
    }
  }

  function tap(key: string, category: Category) {
    clearTimeout(timers.current[key])
    const next = (taps[key] ?? 0) + 1

    if (next >= TAPS_TO_TRIGGER) {
      fire(category)
      return
    }

    setTaps((prev) => ({ ...prev, [key]: next }))
    if (navigator.vibrate) navigator.vibrate(30)
    timers.current[key] = setTimeout(() => {
      setTaps((prev) => ({ ...prev, [key]: 0 }))
    }, TAP_WINDOW_MS)
  }

  function tapMain() {
    if (!expanded && (taps["general"] ?? 0) === 0) setExpanded(true)
    tap("general", "general")
  }

  const mainTaps = taps["general"] ?? 0

  return (
    <div className="sos-dock">
      {expanded && (
        <div className="sos-satellites">
          {CATEGORIES.map((c) => {
            const n = taps[c.key] ?? 0
            return (
              <button
                key={c.key}
                type="button"
                className={`sos-satellite ${n > 0 ? "sos-tapping" : ""}`}
                onClick={() => tap(c.key, c.key)}
                aria-label={`${c.label} SOS — tap ${TAPS_TO_TRIGGER} times fast to trigger`}
              >
                <span className="sos-satellite-icon">{c.icon}</span>
                {c.label}
                {n > 0 && <span className="sos-tap-count">{n}/{TAPS_TO_TRIGGER}</span>}
              </button>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className={`sos-main-button ${mainTaps > 0 ? "sos-tapping" : ""} ${sending ? "sos-sending" : ""}`}
        onClick={tapMain}
        aria-label={`SOS — tap ${TAPS_TO_TRIGGER} times fast to trigger`}
      >
        SOS
        {mainTaps > 0 && <span className="sos-tap-count">{mainTaps}/{TAPS_TO_TRIGGER}</span>}
      </button>
    </div>
  )
}
