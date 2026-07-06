import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import QuickCapture from "./QuickCapture";
import "./App.css";

// One frontend, two windows: `main` is the app, `quick` is the hotkey popup.
const isQuickWindow = getCurrentWindow().label === "quick";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuickWindow ? <QuickCapture /> : <App />}</React.StrictMode>,
);
