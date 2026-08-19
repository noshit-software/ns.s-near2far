const CLIENT_ID_KEY = "near2far_client_id"

// Lets a device recognize its own SOS trigger coming back over the WebSocket broadcast, so it
// doesn't alarm on itself — the whole point is alerting everyone else's device.
export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}
