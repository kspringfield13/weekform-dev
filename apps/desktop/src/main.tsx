import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import { App } from "./App";
import { SpanSimulatorRoot } from "./admin/SpanSimulatorApp";
import { readStoredThemeSync, readThemePreference } from "./services/localStore";
import "./styles.css";

// Seed the theme synchronously from persisted localStorage so a dark-preference
// user doesn't get a light flash; the async store read below is authoritative.
document.documentElement.dataset.theme = readStoredThemeSync();
document.documentElement.dataset.runtime = "__TAURI_INTERNALS__" in window ? "tauri" : "web";

readThemePreference().then((theme) => {
  document.documentElement.dataset.theme = theme;
}).catch(() => {
  // keep default
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/admin/span-simulator" || window.location.pathname.startsWith("/simulator-sandbox/")
      ? <SpanSimulatorRoot />
      : <App />}
  </React.StrictMode>
);
