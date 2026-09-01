import { useRef, useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"
import { BadgeIcon, BellIcon, CarIcon, CloseIcon, MedicalCrossIcon, PhoneIcon, SuspiciousIcon } from "./icons"

type EmergencyContact = { id: string; category: string | null; name: string; phone: string; notes: string | null }
type ContactHousehold = {
  emergency_number: string
  emergency_label: string
  emergency_contacts: EmergencyContact[]
}

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
  const [sending, setSending] = useState(false)

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

  // Getting INTO the panel requires 3 taps on the bell within ~1.2s of each other — deliberate
  // friction so the bell can't be triggered by an accidental brush/pocket-press. Once inside,
  // every number is still a single tap (no further confirmation) — reaching the panel at all
  // already took the deliberate action; a real emergency shouldn't need multiple taps per call.
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tapProgress, setTapProgress] = useState(0)

  function tapMain() {
    tapCountRef.current += 1
    setTapProgress(tapCountRef.current)
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0
      setTapProgress(0)
      if (navigator.vibrate) navigator.vibrate(30)
      setPanelOpen(true)
      return
    }

    if (navigator.vibrate) navigator.vibrate(15)
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0
      setTapProgress(0)
    }, 1200)
  }

  const allContacts = household?.emergency_contacts ?? []
  const generalContacts = allContacts.filter((c) => c.category === null)
  const emergencyNumber = household?.emergency_number ?? "911"
  const emergencyLabel = household?.emergency_label ?? "911"

  return (
    <>
      {panelOpen && (
        <div className="sos-panel" role="dialog" aria-label="SOS">
          <button type="button" className="sos-panel-close" onClick={() => setPanelOpen(false)} aria-label="Close">
            <CloseIcon />
          </button>

          <div className="sos-panel-categories">
            {CATEGORIES.map((c) => {
              const Icon = c.icon
              const categoryContacts = allContacts.filter((ct) => ct.category === c.key)
              const notedContacts = categoryContacts.filter((ct) => ct.notes)
              return (
                <div key={c.key} className="sos-panel-category">
                  <button
                    type="button"
                    className="sos-panel-category-header"
                    onClick={() => fire(c.key)}
                    aria-label={`${c.label} SOS`}
                  >
                    <span className="sos-panel-category-bgicon">
                      <Icon />
                    </span>
                    <span className="sos-panel-category-label">{c.label.toUpperCase()}</span>
                  </button>
                  {/* Floating on the tile itself (translucent, so the big icon shows through)
                      instead of a bottom bar. Two labeled sections, each collapsed away entirely
                      when it has nothing to show, rather than a per-number icon repeated on
                      every pill — the section header carries the icon once instead. */}
                  <div className="sos-panel-tile-sections">
                    {categoryContacts.length > 0 && (
                      <div className="sos-panel-section sos-panel-quick-dial">
                        <div className="sos-panel-quick-dial-list">
                          {categoryContacts.map((ct) => (
                            <a
                              key={ct.id}
                              href={`tel:${ct.phone}`}
                              className="sos-panel-quick-dial-item"
                              onClick={() => fire(c.key, ct.phone, "help", ct.name)}
                            >
                              <span className="sos-panel-quick-dial-item-icon">
                                <PhoneIcon />
                              </span>
                              {ct.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {notedContacts.length > 0 && (
                      <div className="sos-panel-section sos-panel-notes-section">
                        <div className="sos-panel-notes-text">
                          {notedContacts.map((ct) => (
                            <div key={ct.id}>
                              <strong>{ct.name}:</strong> {ct.notes}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

        </div>
      )}

      {/* Rendered as a sibling of .sos-panel, not a child — .sos-panel's backdrop-filter makes
          it the containing block for any position:fixed descendant (a CSS spec quirk), which
          turned this row's `bottom: -30px` into overflow *inside* the blurred panel instead of
          the viewport, forcing an unwanted scrollbar. Kept fully separate so it stays anchored
          to the real viewport regardless of what .sos-panel does with its own stacking. */}
      {panelOpen && (
        <div className="sos-panel-general">
          {generalContacts[0] && (
            <a
              key={generalContacts[0].id}
              href={`tel:${generalContacts[0].phone}`}
              className="sos-panel-dial sos-panel-general-left"
              onClick={() => fire("general", generalContacts[0].phone)}
            >
              <span className="sos-panel-dial-icon">
                <PhoneIcon />
              </span>
              <span className="sos-panel-dial-label">{generalContacts[0].name}</span>
            </a>
          )}
          <a
            href={`tel:${emergencyNumber}`}
            className="sos-panel-dial sos-panel-dial-911"
            onClick={() => fire("general", emergencyNumber)}
            aria-label={`Call ${emergencyLabel}`}
          >
            <svg className="sos-panel-dial-911-arc" viewBox="0 0 104 104" aria-hidden="true">
              <path id="sos911arc" d="M 18 47 A 36 36 0 0 1 86 47" fill="none" />
              <text textAnchor="middle">
                <textPath href="#sos911arc" startOffset="50%">
                  {emergencyLabel}
                </textPath>
              </text>
            </svg>
            <span className="sos-panel-dial-icon">
              <PhoneIcon />
            </span>
          </a>
          {generalContacts[1] && (
            <a
              key={generalContacts[1].id}
              href={`tel:${generalContacts[1].phone}`}
              className="sos-panel-dial sos-panel-general-right"
              onClick={() => fire("general", generalContacts[1].phone)}
            >
              <span className="sos-panel-dial-icon">
                <PhoneIcon />
              </span>
              <span className="sos-panel-dial-label">{generalContacts[1].name}</span>
            </a>
          )}
        </div>
      )}

      <div className="sos-dock">
        {/* Once the panel is open there's nothing left for the bell to do — replaced in the
            exact same spot by 911, since you're already "in SOS" at that point. */}
        {!panelOpen && (
          <button
            type="button"
            className={`sos-main-button ${sending ? "sos-sending" : ""}`}
            onClick={tapMain}
            aria-label="SOS — tap 3 times to open the SOS screen"
          >
            {tapProgress > 0 && <span className="sos-tap-count">{3 - tapProgress} more</span>}
            <BellIcon />
          </button>
        )}
      </div>
    </>
  )
}
