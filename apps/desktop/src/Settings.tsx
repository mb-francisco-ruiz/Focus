import { useState } from "react";
import { CAPTURE_SHORTCUT } from "./hotkey";
import Integrations from "./Integrations";
import { applyGlassLevel, loadGlassLevel } from "./theme";
import { isTauri } from "./tauri-env";

const API_URL = import.meta.env.VITE_FOCUS_API_URL ?? "http://localhost:3001";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <span className="settings-value">{children}</span>
    </div>
  );
}

export default function Settings({ online, onLogout }: { online: boolean; onLogout: () => void }) {
  const [glass, setGlass] = useState(loadGlassLevel());

  return (
    <div className="settings">
      <header className="content-head">
        <h1>Settings</h1>
      </header>

      <section className="settings-card">
        <h2>General</h2>
        <Row label="Server">
          {API_URL} <span className={online ? "dot online" : "dot offline"} />
        </Row>
        <Row label="Quick capture">{CAPTURE_SHORTCUT.replace("CmdOrCtrl", "⌘")}</Row>
        <Row label="Client">{isTauri ? "Desktop (Tauri)" : "Browser (dev)"}</Row>
        <Row label="Transparency">
          {/* right = more transparent; internally glass-level is the inverse
              (it scales surface opacity) */}
          <input
            type="range"
            min={0.1}
            max={1.8}
            step={0.05}
            value={1.9 - glass}
            onChange={(e) => {
              const level = 1.9 - Number(e.target.value);
              setGlass(level);
              applyGlassLevel(level);
            }}
          />
        </Row>
      </section>

      <section className="settings-card">
        <h2>AI</h2>
        <Row label="Provider">Gemini (capability-routed, swappable)</Row>
        <Row label="On capture">Classify sphere, infer due date, score priority</Row>
        <Row label="On new context">Re-analyze task: priority, deadline, next step</Row>
        <Row label="Overrides">Fields you set manually are pinned — AI never rewrites them</Row>
      </section>

      <Integrations />

      <section className="settings-card">
        <h2>Memory</h2>
        <Row label="Event log">Active — every capture, edit and completion is recorded</Row>
        <Row label="Learned profile">
          <span className="soon">Phase 3</span> Distilled preferences & patterns, visible and deletable
        </Row>
      </section>

      <section className="settings-card">
        <h2>Account</h2>
        <button className="danger" onClick={onLogout}>
          Sign out
        </button>
      </section>
    </div>
  );
}
