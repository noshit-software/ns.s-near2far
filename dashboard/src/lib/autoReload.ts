// Detects a new deploy and reloads automatically, so an installed PWA doesn't need a manual
// force-quit/reopen (or delete/re-add) to pick up a fresh build — iOS doesn't reliably recheck
// an installed PWA's page on its own, even with index.html's no-cache header in place.
//
// Works by comparing the currently-loaded JS bundle's hashed filename (Vite content-hashes it
// on every build) against whatever index.html actually references right now. Checked whenever
// the app comes back to the foreground — the natural moment a stale page would otherwise linger.

function currentBundleSrc(): string | null {
  const script = document.querySelector('script[type="module"][src*="/assets/"]')
  return script?.getAttribute("src") ?? null
}

export function setupAutoReload(): void {
  const loaded = currentBundleSrc()
  if (!loaded) return

  async function check() {
    try {
      const res = await fetch("/", { cache: "no-store" })
      const html = await res.text()
      const match = html.match(/\/assets\/index-[^"]+\.js/)
      if (match && match[0] !== loaded) {
        window.location.reload()
      }
    } catch {
      // Offline or a transient network blip — just try again next time the app is foregrounded.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
  window.addEventListener("focus", check)
}
