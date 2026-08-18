import { useEffect, useState } from "react"

import { apiGet, apiPost } from "../lib/api"

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer
}

export function NotificationSetup() {
  const [status, setStatus] = useState<"unknown" | "off" | "on" | "unsupported">("unknown")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported")
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("off"))
  }, [])

  async function enable() {
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setError("Notification permission denied")
        return
      }

      const { public_key } = await apiGet<{ public_key: string }>("/push/vapid-public-key")
      if (!public_key) {
        setError("Push isn't configured on the server yet")
        return
      }

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })

      await apiPost("/push/subscribe", subscription.toJSON())
      setStatus("on")
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (status === "unsupported" || status === "on") return null

  return (
    <div className="notification-setup">
      <button type="button" onClick={enable}>
        Enable trip alerts
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
