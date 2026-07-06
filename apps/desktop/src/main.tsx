import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MiniMode from "./MiniMode";
import QuickCapture from "./QuickCapture";
import { isTauri } from "./tauri-env";
import "./App.css";

// One frontend, two windows: `main` is the app, `quick` is the hotkey popup.
// In a plain browser (vite dev) there is no window label — always main.
async function windowLabel(): Promise<string> {
  if (!isTauri) return "main";
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

const label = await windowLabel();

// Native window vibrancy (macOS) / mica (Windows) shows through semi-transparent
// surfaces; plain-browser dev keeps the solid dark fallback.
if (isTauri) {
  document.documentElement.classList.add("vibrancy");
  const { restoreGlassLevel } = await import("./theme");
  restoreGlassLevel();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {label === "quick" ? <QuickCapture /> : label === "mini" ? <MiniMode /> : <App />}
  </React.StrictMode>,
);
