import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlackDigestInfo } from "@focus/shared";
import {
  getSlackDigest,
  listSlackChannels,
  refreshSlackDigest,
  saveSlackDigestSettings,
} from "./api";
import { isTauri } from "./tauri-env";

const PENDING_KEY = "focus.slackDigestPendingSince";
const PENDING_TIMEOUT = 3 * 60 * 1000;

async function openThread(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

const bold = (s: string) =>
  s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

/** Structured digest: lead summary + per-channel points, each with an eye link. */
function DigestBody({ digest }: { digest: SlackDigestInfo }) {
  return (
    <div className="md">
      {digest.summary && <p>{bold(digest.summary)}</p>}
      {digest.sections.map((section, si) => (
        <div key={si}>
          <h4>#{section.channel}</h4>
          {section.points.map((p, pi) => (
            <div className="digest-point" key={pi}>
              <span>{bold(p.text)}</span>
              {p.url && (
                <button
                  className="thread-link"
                  title="Open the Slack thread"
                  onClick={() => void openThread(p.url!)}
                >
                  ⊙
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Slack page: daily public-channel summary. Generated once per day on app
 * startup; the button regenerates on demand. Its own nav section, shown only
 * when a Slack workspace is connected.
 */
export default function SlackDigest() {
  const [digest, setDigest] = useState<SlackDigestInfo | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Pending state lives in localStorage so it survives leaving the page — the
  // server keeps generating regardless of whether this view is mounted.
  const [pendingSince, setPendingSince] = useState<number>(() => {
    const v = Number(localStorage.getItem(PENDING_KEY) ?? 0);
    return Number.isFinite(v) && Date.now() - v < PENDING_TIMEOUT ? v : 0;
  });
  const refreshing = pendingSince > 0;

  const setPending = (ts: number) => {
    setPendingSince(ts);
    if (ts) localStorage.setItem(PENDING_KEY, String(ts));
    else localStorage.removeItem(PENDING_KEY);
  };

  const load = useCallback(() => {
    getSlackDigest()
      .then(({ digest, excludedChannels, lastError }) => {
        setDigest(digest);
        setExcluded(new Set(excludedChannels));
        setLastError(lastError);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    listSlackChannels()
      .then(setChannels)
      .catch((err) => {
        if (String(err).includes("409")) setNeedsReconnect(true);
      });
  }, [load]);

  // While a generation is pending (even one started before we navigated here),
  // poll until a digest newer than the request appears, or the window lapses.
  useEffect(() => {
    if (!pendingSince) return;
    if (Date.now() - pendingSince >= PENDING_TIMEOUT) {
      setPending(0);
      return;
    }
    const timer = window.setInterval(async () => {
      if (Date.now() - pendingSince >= PENDING_TIMEOUT) {
        setPending(0);
        return;
      }
      const res = await getSlackDigest().catch(() => null);
      if (!res) return;
      setLastError(res.lastError);
      if (res.digest && new Date(res.digest.createdAt).getTime() >= pendingSince) {
        setDigest(res.digest);
        setPending(0);
      } else if (res.lastError && res.lastError !== "names_scope") {
        setPending(0); // generation failed — stop waiting, banner explains
      }
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSince]);

  const refresh = async () => {
    setPending(Date.now());
    await refreshSlackDigest(true).catch(() => setPending(0));
  };

  const persist = (next: Set<string>) => {
    setExcluded(new Set(next));
    void saveSlackDigestSettings([...next]).catch(() => {});
  };

  const toggle = (name: string) => {
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    persist(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;
  }, [channels, query]);

  const includedCount = channels.length - excluded.size;

  return (
    <>
      <header className="content-head">
        <h1>Slack</h1>
        <div className="cal-nav">
          <button className="chip" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? "Summarizing…" : "Refresh now"}
          </button>
        </div>
      </header>

      <p className="memory-intro">
        Every day on first launch, Focus reads the last 24h of your public channels and writes
        the summary below. Choose which channels to include.
      </p>

      {(needsReconnect || lastError === "missing_scope") && (
        <p className="error">
          The daily summary needs new Slack permissions — reconnect your workspace in
          Settings → Integrations.
        </p>
      )}
      {lastError === "names_scope" && (
        <p className="settings-hint">
          Showing raw user ids — reconnect your workspace in Settings → Integrations to
          resolve real names.
        </p>
      )}
      {lastError === "quota" && (
        <p className="error">
          The last summary hit the AI quota. It retries tomorrow automatically — or enable
          billing on the Gemini key.
        </p>
      )}
      {lastError === "timeout" && (
        <p className="error">The last summary timed out — try Refresh now again.</p>
      )}

      <div className="slack-cols">
        <section className="settings-card channels-card">
          <h2>
            Channels{" "}
            <span className="count">
              {includedCount}/{channels.length} included
            </span>
          </h2>
          <input
            className="mini-search"
            placeholder="Search channels…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="channel-scroll">
            {filtered.map((c) => {
              const included = !excluded.has(c.name);
              return (
                <label key={c.id} className={`channel-toggle ${included ? "on" : ""}`}>
                  <input type="checkbox" checked={included} onChange={() => toggle(c.name)} />
                  #{c.name}
                </label>
              );
            })}
            {channels.length === 0 && !needsReconnect && (
              <p className="empty">Loading channels…</p>
            )}
            {filtered.length === 0 && channels.length > 0 && (
              <p className="empty">No channels match.</p>
            )}
          </div>
        </section>

        <section className="settings-card digest-card">
          <h2>
            Today's summary{" "}
            {digest && (
              <span className="count">{new Date(digest.createdAt).toLocaleString()}</span>
            )}
          </h2>
          {digest ? (
            <div className="digest-content">
              <DigestBody digest={digest} />
            </div>
          ) : (
            <p className="empty">No summary yet — it generates on first launch each day.</p>
          )}
        </section>
      </div>
    </>
  );
}
