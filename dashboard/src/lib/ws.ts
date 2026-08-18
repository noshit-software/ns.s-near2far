import { useEffect, useRef, useState } from "react"

import { getAdminPassword } from "./api"

export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<unknown>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    let socket: WebSocket
    let cancelled = false

    function connect() {
      const token = getAdminPassword() ?? ""
      const url = `${location.origin.replace(/^http/, "ws")}/ws/events?token=${encodeURIComponent(token)}`
      socket = new WebSocket(url)
      socket.onmessage = (event) => setLastEvent(JSON.parse(event.data))
      socket.onopen = () => {
        retryDelay.current = 1000
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
