import { useEffect, useRef, useState } from "react"

export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<unknown>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    let socket: WebSocket
    let cancelled = false

    function connect() {
      socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws/events`)
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
