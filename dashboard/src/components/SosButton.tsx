import { useRef, useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"
import { BadgeIcon, BellIcon, CarIcon, MedicalCrossIcon, PhoneIcon, SuspiciousIcon } from "./icons"

type ContactHousehold = {
  emergency_contact_1_name: string | null
  emergency_contact_1_phone: string | null
  emergency_contact_2_name: string | null
  emergency_contact_2_phone: string | null
  emergency_contact_3_name: string | null
  emergency_contact_3_phone: string | null
  emergency_contact_4_name: string | null
  emergency_contact_4_phone: string | null
}

function quickDialContacts(household: ContactHousehold | null | undefined) {
  if (!household) return []
  const slots = [1, 2, 3, 4] as const
  return slots
    .map((n) => ({
      name: household[`emergency_contact_${n}_name`],
      phone: household[`emergency_contact_${n}_phone`],
    }))
    .filter((c): c is { name: string; phone: string } => Boolean(c.phone))
}

const TAP_WINDOW_MS = 600
const TAPS_TO_TRIGGER = 3

type Category = "general" | "medical" | "security" | "suspicious" | "car"

const CATEGORIES: { key: Category; label: string; icon: () => JSX.Element }[] = [
  { key: "medical", label: "Medical", icon: MedicalCrossIcon },
  { key: "security", label: "Authorities", icon: BadgeIcon },
  { key: "suspicious", label: "Followed", icon: SuspiciousIcon },
  { key: "car", label: "Car trouble", icon: CarIcon },
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

export function SosButton({
  household,
  onTriggered,
}: {
  household: ContactHousehold | null | undefined
  onTriggered: (alertId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const contacts = quickDialContacts(household)
  const [taps, setTaps] = useState<Record<string, number>>({})
  const [sending, setSending] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  async function fire(category: Category) {
    setSending(true)
    setExpanded(false)
    setTaps({})
    try {
      const [pos, exclude_endpoint] = await Promise.all([currentPosition(), ownPushEndpoint()])
      const alert = await apiPost<{ id: number }>("/sos/trigger", {
        origin_client_id: getClientId(),
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
        category,
        exclude_endpoint,
      })
      onTriggered(alert.id)
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
        <div className="sos-call-row">
          <a href="tel:911" className="sos-call-button sos-call-911" aria-label="Call 911">
            <PhoneIcon />
            911
          </a>
          {contacts.map((c) => (
            <a
              key={c.phone}
              href={`tel:${c.phone}`}
              className="sos-call-button"
              aria-label={`Call ${c.name}`}
            >
              <PhoneIcon />
              {c.name}
            </a>
          ))}
        </div>
      )}
      {expanded && (
        <div className="sos-satellites">
          {CATEGORIES.map((c) => {
            const n = taps[c.key] ?? 0
            const Icon = c.icon
            return (
              <button
                key={c.key}
                type="button"
                className={`sos-satellite ${n > 0 ? "sos-tapping" : ""}`}
                onClick={() => tap(c.key, c.key)}
                aria-label={`${c.label} SOS — tap ${TAPS_TO_TRIGGER} times fast to trigger`}
              >
                <span className="sos-satellite-icon">
                  <Icon />
                </span>
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
        <BellIcon />
        {mainTaps > 0 && <span className="sos-tap-count">{mainTaps}/{TAPS_TO_TRIGGER}</span>}
      </button>
    </div>
  )
}
