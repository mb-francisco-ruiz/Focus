import { useEffect, useRef, useState } from "react";
import type { UserProfile } from "@focus/shared";
import { avatarUrl, clearAiKey, setAiKey, setAiMode, updateSpheres, uploadAvatar } from "./api";
import { CAPTURE_SHORTCUT } from "./hotkey";
import Integrations from "./Integrations";
import { mcpStatus, probeLocalAi, setupMcp, stopLocalAi, type McpSetup, type McpStatus } from "./localAi";
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

export default function Settings({
  online,
  profile,
  onProfileChange,
  onLogout,
}: {
  online: boolean;
  profile: UserProfile | null;
  onProfileChange: (p: UserProfile) => void;
  onLogout: () => void;
}) {
  const [glass, setGlass] = useState(loadGlassLevel());
  const [categoryDraft, setCategoryDraft] = useState("");
  const [reassigned, setReassigned] = useState<number | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const spheres = profile?.spheres ?? ["work", "personal"];

  const saveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyDraft.trim();
    if (!key || keyBusy) return;
    setKeyBusy(true);
    try {
      onProfileChange(await setAiKey(key));
      setKeyDraft("");
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    setKeyBusy(true);
    try {
      onProfileChange(await clearAiKey());
    } finally {
      setKeyBusy(false);
    }
  };

  const aiMode = profile?.aiMode ?? "server";
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const checkLocal = async () => {
    setChecking(true);
    try {
      setProbe(await probeLocalAi());
    } finally {
      setChecking(false);
    }
  };

  const switchMode = async (mode: "server" | "local") => {
    if (mode === aiMode) return;
    onProfileChange(await setAiMode(mode));
    if (mode === "local") void checkLocal();
    else void stopLocalAi();
  };

  const [mcp, setMcp] = useState<McpSetup | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpErr, setMcpErr] = useState<string | null>(null);
  const [mcpState, setMcpState] = useState<McpStatus | null>(null);

  // Check whether the Focus MCP is already registered in Claude Code, on open.
  useEffect(() => {
    if (!isTauri) return;
    void mcpStatus().then(setMcpState).catch(() => {});
  }, []);

  const runMcpSetup = async () => {
    setMcpBusy(true);
    setMcpErr(null);
    try {
      setMcp(await setupMcp());
      void mcpStatus().then(setMcpState).catch(() => {}); // refresh the live badge
    } catch (e) {
      setMcpErr(String(e));
    } finally {
      setMcpBusy(false);
    }
  };

  const saveSpheres = async (next: string[]) => {
    const result = await updateSpheres(next);
    onProfileChange(result);
    setReassigned(result.reassigned > 0 ? result.reassigned : null);
  };

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = categoryDraft.trim().toLowerCase();
    if (!name || spheres.includes(name)) return;
    setCategoryDraft("");
    await saveSpheres([...spheres, name]);
  };

  const onAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const updated = await uploadAvatar(file);
    onProfileChange(updated);
  };

  return (
    <div className="settings">
      <header className="content-head">
        <h1>Settings</h1>
      </header>

      <section className="settings-card">
        <h2>Profile</h2>
        <div className="profile-row">
          {profile?.avatarKey ? (
            <img className="avatar big" src={avatarUrl(profile.avatarKey)} alt="" />
          ) : (
            <span className="avatar big placeholder">
              {(profile?.username ?? "?")[0]?.toUpperCase()}
            </span>
          )}
          <div>
            <p className="profile-name">{profile?.displayName ?? profile?.username ?? "…"}</p>
            <button className="chip" onClick={() => fileRef.current?.click()}>
              Change avatar
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void onAvatarPick(e)}
            />
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>Categories</h2>
        <p className="settings-hint">
          Your task groups. The AI classifies every capture into one of these; columns,
          filters and behaviour instructions follow them.
        </p>
        <div className="category-list">
          {spheres.map((s) => (
            <span key={s} className="chip category-chip">
              {s}
              <button
                className="link"
                title={spheres.length <= 1 ? "At least one category is required" : "Remove — its tasks move to the first category"}
                disabled={spheres.length <= 1}
                onClick={() => void saveSpheres(spheres.filter((x) => x !== s))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => void addCategory(e)}>
          <input
            className="category-add"
            placeholder="Add a category… e.g. side-projects"
            value={categoryDraft}
            onChange={(e) => setCategoryDraft(e.target.value)}
          />
        </form>
        {reassigned !== null && (
          <p className="settings-hint">Moved {reassigned} task(s) to “{spheres[0]}”.</p>
        )}
      </section>

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
        {isTauri && (
          <>
            <Row label="Run AI">
              <span className="ai-mode-toggle">
                <button
                  className={aiMode === "server" ? "on" : ""}
                  onClick={() => void switchMode("server")}
                >
                  Server (API key)
                </button>
                <button
                  className={aiMode === "local" ? "on" : ""}
                  onClick={() => void switchMode("local")}
                >
                  This Mac (Claude Code)
                </button>
              </span>
            </Row>
            {aiMode === "local" && (
              <>
                <Row label="Claude Code">
                  <span className="ai-key-set">
                    <span className={probe?.ok ? "dot online" : "dot offline"} />
                    {checking ? "Checking…" : (probe?.detail ?? "Not checked yet")}
                    <button className="link" disabled={checking} onClick={() => void checkLocal()}>
                      Test
                    </button>
                  </span>
                </Row>
                {probe && !probe.ok && (
                  <p className="settings-hint">
                    Install Claude Code and sign in, then hit Test:
                    {" "}<code>npm i -g @anthropic-ai/claude-code</code> then <code>claude login</code>.
                    Node 18+ must be on your PATH. Until then, Ask Focus &amp; enrichment fall back to the server.
                  </p>
                )}
                <p className="settings-hint">
                  Ask Focus &amp; enrich-on-capture run through your Claude plan on this Mac. Uses your
                  Claude subscription — note Anthropic may bill headless/SDK use at API rates if they
                  un-pause that change. Background jobs &amp; other devices still use the server.
                </p>
              </>
            )}
          </>
        )}
        <Row label="Provider">Gemini (capability-routed, swappable)</Row>
        <Row label="On capture">Classify sphere, infer due date, score priority</Row>
        <Row label="On new context">Re-analyze task: priority, deadline, next step</Row>
        <Row label="Overrides">Fields you set manually are pinned — AI never rewrites them</Row>
        <Row label="API key">
          {profile?.hasAiKey ? (
            <span className="ai-key-set">
              <span className="dot online" /> Your Gemini key is set
              <button className="link" disabled={keyBusy} onClick={() => void removeKey()}>
                Remove
              </button>
            </span>
          ) : (
            <form className="ai-key-form" onSubmit={(e) => void saveKey(e)}>
              <input
                type="password"
                placeholder="Paste your Gemini API key…"
                value={keyDraft}
                autoComplete="off"
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button className="chip" type="submit" disabled={keyBusy || !keyDraft.trim()}>
                Save
              </button>
            </form>
          )}
        </Row>
        <p className="settings-hint">
          Powers all AI features (capture, digests, Ask Focus) with your own quota. Get one free
          at aistudio.google.com/apikey. Stored encrypted; never shown again.
        </p>
      </section>

      {isTauri && (
        <section className="settings-card">
          <h2>Claude apps</h2>
          <p className="settings-hint">
            Manage your Focus tasks from Claude Code and Claude Desktop. One click builds the
            Focus MCP server and connects it to both — then just ask Claude to “list my Focus
            tasks” or “add a task”.
          </p>
          <Row label="Claude Code">
            <span className="ai-key-set">
              <span className={mcpState?.registered ? "dot online" : "dot offline"} />
              {mcpState == null
                ? "Checking…"
                : mcpState.connected
                  ? "Connected"
                  : mcpState.registered
                    ? "Registered — start a new Claude session"
                    : "Not set up yet"}
            </span>
          </Row>
          <Row label="MCP server">
            <span className="ai-key-set">
              <button className="chip" disabled={mcpBusy} onClick={() => void runMcpSetup()}>
                {mcpBusy ? "Setting up…" : mcpState?.registered ? "Re-run setup" : "Set up in Claude"}
              </button>
            </span>
          </Row>
          {mcpErr && <p className="error">{mcpErr}</p>}
          {mcp && (
            <>
              <Row label="Build">
                <span className="ai-key-set">
                  <span className="dot online" /> {mcp.built ? "Built" : "Already built"}
                </span>
              </Row>
              <Row label="Claude Code">
                <span className="ai-key-set">
                  <span className={mcp.claudeCode === "added" ? "dot online" : "dot offline"} />
                  {mcp.claudeCode}
                </span>
              </Row>
              <Row label="Claude Desktop">
                <span className="ai-key-set">
                  <span className={mcp.claudeDesktop.startsWith("configured") ? "dot online" : "dot offline"} />
                  {mcp.claudeDesktop}
                </span>
              </Row>
              <p className="settings-hint">
                Connected as you, to this server. Re-run if Claude stops seeing your tasks (the
                access token refreshes). Restart Claude Desktop to load it.
              </p>
            </>
          )}
        </section>
      )}

      <Integrations />

      <section className="settings-card">
        <h2>Memory</h2>
        <Row label="Event log">Active — every capture, edit and completion is recorded</Row>
        <Row label="Learned profile">
          Behaviour, entities & memories — manage them in the Intelligence tab
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
