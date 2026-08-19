import { useRef, useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"
import { BadgeIcon, BellIcon, CarIcon, CloseIcon, MedicalCrossIcon, PhoneIcon, SuspiciousIcon } from "./icons"

type EmergencyContact = { id: string; category: string | null; name: string; phone: string }
type ContactHousehold = { emergency_contacts: EmergencyContact[] }

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
  const [panelOpen, setPanelOpen] = useState(false)
  const [mainTaps, setMainTaps] = useState(0)
  const [sending, setSending] = useState(false)
  const mainTimer = useRef<ReturnType<typeof setTimeout>>()

  // `dial`: when firing from inside the full-screen panel (a number was tapped directly), also
  // opens the phone dialer to that number — the panel itself was already reached deliberately
  // (a tap on the main button), so every number inside it is a single, immediate action: call
  // AND alert the household, at the same time, no further confirmation step.
  //
  // `kind`: 911 and the general contacts (Dad, Lawyer) are full "sos" severity — siren,
  // full-screen, stays active until disabled. A category-specific helper number (AAA,
  // insurance, non-emergency police) is "help" — still notifies everyone, but as a light
  // heads-up rather than a siren, and it auto-resolves since there's nothing to disable.
  async function fire(
    category: Category,
    dial?: string,
    kind: "sos" | "help" = "sos",
    contactName?: string,
  ) {
    setSending(true)
    setPanelOpen(false)
    try {
      const [pos, exclude_endpoint] = await Promise.all([currentPosition(), ownPushEndpoint()])
      const alertPromise = apiPost<{ id: number; kind: string }>("/sos/trigger", {
        origin_client_id: getClientId(),
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
        category,
        kind,
        contact_name: contactName,
        exclude_endpoint,
      })
      if (dial) window.location.href = `tel:${dial}`
      const alert = await alertPromise
      if (alert.kind === "sos") onTriggered(alert.id)
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    } catch {
      // Best-effort — the button itself has no error UI; a failed trigger is silent rather
      // than adding a failure mode to an already-stressful moment.
    } finally {
      setSending(false)
    }
  }

  function tapMain() {
    // Only treat this as "close the panel" when it's a fresh tap outside any active triple-tap
    // sequence (mainTaps === 0) — otherwise taps 2 and 3 of a fast triple-tap (which opened the
    // panel on tap 1) would each get swallowed as a close instead of counting toward the fire.
    if (panelOpen && mainTaps === 0) {
      setPanelOpen(false)
      return
    }
    clearTimeout(mainTimer.current)
    const next = mainTaps + 1

    if (next >= TAPS_TO_TRIGGER) {
      setMainTaps(0)
      fire("general")
      return
    }

    setMainTaps(next)
    if (navigator.vibrate) navigator.vibrate(30)
    mainTimer.current = setTimeout(() => setMainTaps(0), TAP_WINDOW_MS)

    // A single tap (not yet a triple-tap) opens the browsable panel instead of just counting —
    // if the next two taps land fast enough it still fires the general alert directly.
    if (next === 1) setPanelOpen(true)
  }

  const allContacts = household?.emergency_contacts ?? []
  const generalContacts = allContacts.filter((c) => c.category === null)

  return (
    <>
      {panelOpen && (
        <div className="sos-panel" role="dialog" aria-label="SOS">
          <button type="button" className="sos-panel-close" onClick={() => setPanelOpen(false)} aria-label="Close">
            <CloseIcon />
          </button>

          <div className="sos-panel-general">
            <a href="tel:911" className="sos-panel-dial sos-panel-dial-911" onClick={() => fire("general", "911")}>
              <PhoneIcon />
              911
            </a>
            {generalContacts.map((c) => (
              <a
                key={c.id}
                href={`tel:${c.phone}`}
                className="sos-panel-dial"
                onClick={() => fire("general", c.phone)}
              >
                <PhoneIcon />
                {c.name}
              </a>
            ))}
          </div>

          <div className="sos-panel-categories">
            {CATEGORIES.map((c) => {
              const Icon = c.icon
              const categoryContacts = allContacts.filter((ct) => ct.category === c.key)
              return (
                <div key={c.key} className="sos-panel-category">
                  <button
                    type="button"
                    className="sos-panel-category-header"
                    onClick={() => fire(c.key)}
                    aria-label={`${c.label} SOS`}
                  >
                    <Icon />
                    {c.label}
                  </button>
                  {categoryContacts.length > 0 && (
                    <div className="sos-panel-category-dials">
                      {categoryContacts.map((ct) => (
                        <a
                          key={ct.id}
                          href={`tel:${ct.phone}`}
                          className="sos-panel-dial"
                          onClick={() => fire(c.key, ct.phone, "help", ct.name)}
                        >
                          <PhoneIcon />
                          {ct.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="sos-dock">
        <button
          type="button"
          className={`sos-main-button ${mainTaps > 0 ? "sos-tapping" : ""} ${sending ? "sos-sending" : ""}`}
          onClick={tapMain}
          aria-label={`SOS — tap ${TAPS_TO_TRIGGER} times fast to trigger, or once to open the SOS screen`}
        >
          <BellIcon />
          {mainTaps > 0 && <span className="sos-tap-count">{mainTaps}/{TAPS_TO_TRIGGER}</span>}
        </button>
      </div>
    </>
  )
}
