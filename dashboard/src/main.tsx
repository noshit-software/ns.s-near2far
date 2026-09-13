import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "./App"
import "./index.css"
import { setupAutoReload } from "./lib/autoReload"

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
}

if (location.search.includes("_r=")) {
  history.replaceState(null, "", location.pathname + location.hash)
}
setupAutoReload()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
