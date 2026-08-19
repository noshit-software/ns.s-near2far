import { useState } from "react"

import { apiPost } from "../lib/api"
import { getClientId } from "../lib/clientId"
import { BadgeIcon, BellIcon, CarIcon, CloseIcon, MedicalCrossIcon, PhoneIcon, SuspiciousIcon } from "./icons"

type EmergencyContact = { id: string; category: string | null; name: string; phone: string }
type ContactHousehold = { emergency_contacts: EmergencyContact[] }

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

  // A single tap opens the panel — 911 then sits in the bell's exact spot, one more tap away
  // from actually firing, so the fast path is now "tap, tap" rather than a triple-tap gesture
  // on an element that no longer exists once the panel is open (911 replaces it).
  function tapMain() {
    if (navigator.vibrate) navigator.vibrate(30)
    setPanelOpen(true)
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
                    <span className="sos-panel-category-bgicon">
                      <Icon />
                    </span>
                  </button>
                  {/* Floating on the tile itself (translucent, so the big icon shows through)
                      instead of a bottom bar — first 2 stack up the left edge, any 3rd spills
                      to the right, rather than reserving fixed space whether or not it's used. */}
                  <div className="sos-panel-category-dials sos-panel-category-dials-left">
                    {categoryContacts.slice(0, 2).map((ct) => (
                      <a
                        key={ct.id}
                        href={`tel:${ct.phone}`}
                        className="sos-panel-dial sos-panel-dial-small"
                        onClick={() => fire(c.key, ct.phone, "help", ct.name)}
                      >
                        <span className="sos-panel-dial-icon">
                          <PhoneIcon />
                        </span>
                        <span className="sos-panel-dial-label">{ct.name}</span>
                      </a>
                    ))}
                  </div>
                  {categoryContacts.length > 2 && (
                    <div className="sos-panel-category-dials sos-panel-category-dials-right">
                      {categoryContacts.slice(2).map((ct) => (
                        <a
                          key={ct.id}
                          href={`tel:${ct.phone}`}
                          className="sos-panel-dial sos-panel-dial-small"
                          onClick={() => fire(c.key, ct.phone, "help", ct.name)}
                        >
                          <span className="sos-panel-dial-icon">
                            <PhoneIcon />
                          </span>
                          <span className="sos-panel-dial-label">{ct.name}</span>
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
            href="tel:911"
            className="sos-panel-dial sos-panel-dial-911"
            onClick={() => fire("general", "911")}
          >
            <span className="sos-panel-dial-icon">
              <PhoneIcon />
            </span>
            <span className="sos-panel-dial-label">911</span>
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
            aria-label="SOS — tap to open the SOS screen"
          >
            <BellIcon />
          </button>
        )}
      </div>
    </>
  )
}
