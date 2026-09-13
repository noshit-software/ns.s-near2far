// Detects a new deploy and reloads automatically, so an installed PWA doesn't need a manual
// force-quit/reopen to pick up a fresh build.
//
// Works by comparing the currently-loaded JS bundle's hashed filename (Vite content-hashes it
// on every build) against whatever index.html actually references right now.
//
// Two triggers:
//   1. visibilitychange / focus — immediate on foreground
//   2. 3-minute interval — iOS PWA drops these events unreliably; the interval is the backstop
//
// reload() is avoided: on iOS PWA it can silently serve the old cached shell even with
// no-cache headers. Instead we navigate to /?_r=<timestamp> — a cache-busting URL that nginx's
// try_files still serves as index.html, guaranteeing a fresh fetch. main.tsx strips the param.

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
        window.location.replace(window.location.pathname + "?_r=" + Date.now())
      }
    } catch {
      // Offline or transient network blip — try again on the next tick.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
  window.addEventListener("focus", check)
  setInterval(check, 3 * 60 * 1000)
}
