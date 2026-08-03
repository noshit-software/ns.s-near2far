import { useEffect, useState } from "react"

import { SetupWizard } from "./components/SetupWizard"
import { apiGet } from "./lib/api"
import { useEventStream } from "./lib/ws"

export function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null)
  const lastEvent = useEventStream()

  useEffect(() => {
    apiGet<{ status: string }>("/health")
      .then((data) => setHealthy(data.status === "ok"))
      .catch(() => setHealthy(false))
  }, [])

  return (
    <div>
      <h1>near2far</h1>
      <p className="status-line">
        <span className={`status-dot${healthy ? " ok" : ""}`} />
        backend: {healthy === null ? "checking..." : healthy ? "ok" : "down"}
      </p>
      <SetupWizard />
      <pre>{lastEvent ? JSON.stringify(lastEvent, null, 2) : "no events yet"}</pre>
    </div>
  )
}
