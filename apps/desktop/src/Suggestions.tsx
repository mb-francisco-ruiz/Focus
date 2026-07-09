import { useCallback, useEffect, useState } from "react";
import type { Suggestion } from "@focus/shared";
import { acceptSuggestion, dismissSuggestion, listSuggestions, scanInbox } from "./api";
import { onSyncMessage } from "./sync";

// The scan runs server-side on the queue regardless of this view; the pending
// flag lives in localStorage so leaving/returning to the tab doesn't reset it.
const SCAN_KEY = "focus.scanPendingSince";
const SCAN_TIMEOUT = 60_000;

/**
 * Review queue (PLAN.md §5.3): AI-suggested tasks from Gmail/Slack.
 * Nothing lands in the task list without an explicit accept here.
 */
export default function Suggestions({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [scanSince, setScanSince] = useState<number>(() => {
    const v = Number(localStorage.getItem(SCAN_KEY) ?? 0);
    return Number.isFinite(v) && Date.now() - v < SCAN_TIMEOUT ? v : 0;
  });
  const scanning = scanSince > 0;

  const setScan = (ts: number) => {
    setScanSince(ts);
    if (ts) localStorage.setItem(SCAN_KEY, String(ts));
    else localStorage.removeItem(SCAN_KEY);
  };

  const refresh = useCallback(() => {
    listSuggestions()
      .then((s) => {
        setItems(s);
        onCountChange(s.length);
      })
      .catch(() => setItems([]));
  }, [onCountChange]);

  useEffect(() => {
    refresh();
    return onSyncMessage((msg) => {
      if (msg.type === "suggestion.changed" || msg.type === "suggestion.new") {
        setScan(0); // results arrived
        refresh();
      }
    });
  }, [refresh]);

  // Clear the pending flag once the scan window lapses (a scan that finds
  // nothing new emits no WS message — the "Inbox scan finished" notification
  // still tells the user server-side).
  useEffect(() => {
    if (!scanSince) return;
    const left = SCAN_TIMEOUT - (Date.now() - scanSince);
    const t = window.setTimeout(() => setScan(0), Math.max(0, left));
    return () => window.clearTimeout(t);
  }, [scanSince]);

  const scan = async () => {
    setScan(Date.now());
    try {
      await scanInbox();
    } catch {
      setScan(0);
    }
  };

  const review = async (s: Suggestion, accept: boolean) => {
    setItems((prev) => {
      const next = prev.filter((x) => x.id !== s.id);
      onCountChange(next.length);
      return next;
    });
    try {
      if (accept) await acceptSuggestion(s.id);
      else await dismissSuggestion(s.id);
    } catch {
      refresh(); // optimistic removal was wrong — restore from server
    }
  };

  return (
    <>
      <header className="content-head">
        <h1>Suggestions</h1>
        <button className="chip" disabled={scanning} onClick={() => void scan()}>
          {scanning ? "Scanning…" : "Scan inbox"}
        </button>
      </header>
      <div className="suggestions">
        {items.map((s) => (
          <div key={s.id} className="suggestion-card">
            <div className="suggestion-body">
              <span className="source-tag">{s.source}</span>
              <h3>{s.title}</h3>
              <p className="reason">{s.reason}</p>
              <p className="excerpt">{s.excerpt}</p>
            </div>
            <div className="suggestion-actions">
              <button className="accept" onClick={() => void review(s, true)}>
                Add task
              </button>
              <button className="chip" onClick={() => void review(s, false)}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="empty">
            No suggestions waiting. New ones appear here when the AI spots actions in your
            connected inboxes.
          </p>
        )}
      </div>
    </>
  );
}
