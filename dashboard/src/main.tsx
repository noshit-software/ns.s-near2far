import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "./App"
import "./index.css"
import { setupAutoReload } from "./lib/autoReload"

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
}

setupAutoReload()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
