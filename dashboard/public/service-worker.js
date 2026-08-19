self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? "near2far", {
      body: data.body ?? "",
      tag: data.tag,
      requireInteraction: Boolean(data.requireInteraction),
      // SOS in particular needs to actually be felt, not just seen, if the phone is in a
      // pocket or face-down — a long buzz pattern rather than the default single blip.
      vibrate: data.tag === "sos" ? [400, 200, 400, 200, 400, 200, 400] : undefined,
    }),
  )
})
