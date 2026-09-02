import { useEffect, useRef, useState } from "react"

import { getAdminPassword } from "./api"

export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<unknown>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    let socket: WebSocket
    let cancelled = false
    let hasConnectedBefore = false

    function connect() {
      const token = getAdminPassword() ?? ""
      const url = `${location.origin.replace(/^http/, "ws")}/ws/events?token=${encodeURIComponent(token)}`
      socket = new WebSocket(url)
      socket.onmessage = (event) => setLastEvent(JSON.parse(event.data))
      socket.onopen = () => {
        retryDelay.current = 1000
        // A tab can sit open for hours with its WebSocket silently dying (phone screen lock,
        // laptop sleep, a network blip) and reconnecting later having missed every
        // position.updated event in between — the map would otherwise just freeze on
        // whatever was last received. Signal reconnects (not the initial connect, which
        // already gets a fresh fetch on mount) so listeners can refetch current state.
        if (hasConnectedBefore) setLastEvent({ type: "ws.reconnected", payload: null })
        hasConnectedBefore = true
      }
      socket.onclose = () => {
        if (cancelled) return
        setTimeout(connect, retryDelay.current)
        retryDelay.current = Math.min(retryDelay.current * 2, 30000)
      }
    }

    connect()
    return () => {
      cancelled = true
      socket?.close()
    }
  }, [])

  return lastEvent
}
