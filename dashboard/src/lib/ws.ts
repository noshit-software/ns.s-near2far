import { useEffect, useRef, useState } from "react"

import { apiPost } from "./api"

export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<unknown>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    let socket: WebSocket
    let cancelled = false
    let hasConnectedBefore = false

    async function connect() {
      let ticket = ""
      try {
        const { ticket: t } = await apiPost<{ ticket: string }>("/setup/ws-ticket", {})
        ticket = t
      } catch {
        // Not authenticated or no household yet — connect without a ticket; the server
        // allows unauthenticated connections when no household exists.
      }
      if (cancelled) return
      const url = `${location.origin.replace(/^http/, "ws")}/ws/events?ticket=${encodeURIComponent(ticket)}`
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
