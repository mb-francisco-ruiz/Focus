import { useEffect, useState } from "react";
import type { Suggestion } from "@focus/shared";
import { acceptSuggestion, dismissSuggestion } from "./api";
import { onSyncMessage } from "./sync";

/**
 * In-app popups for freshly-detected email/message suggestions (PLAN.md §5.3).
 * A relevant new email arrives → the server pushes suggestion.new → a toast
 * offers "Create task" or "Dismiss" without leaving the current view.
 */
export default function SuggestionToast({ onCreated }: { onCreated?: () => void }) {
  const [queue, setQueue] = useState<Suggestion[]>([]);

  useEffect(
    () =>
      onSyncMessage((msg) => {
        if (msg.type === "suggestion.new") {
          // Avoid duplicates if the socket reconnects and replays.
          setQueue((prev) => (prev.some((s) => s.id === msg.suggestion.id) ? prev : [...prev, msg.suggestion]));
        }
      }),
    [],
  );

  const remove = (id: string) => setQueue((prev) => prev.filter((s) => s.id !== id));

  const accept = async (s: Suggestion) => {
    remove(s.id);
    await acceptSuggestion(s.id).catch(() => {});
    onCreated?.();
  };

  const dismiss = async (s: Suggestion) => {
    remove(s.id);
    await dismissSuggestion(s.id).catch(() => {});
  };

  if (queue.length === 0) return null;

  return (
    <div className="toast-stack">
      {queue.slice(-3).map((s) => (
        <div className="toast" key={s.id}>
          <div className="toast-head">
            <span className="source-tag">{s.source === "gmail" ? "✉ new email" : "slack"}</span>
            <button className="bubble-close" onClick={() => dismiss(s)}>
              ✕
            </button>
          </div>
          <h4>{s.title}</h4>
          <p className="reason">{s.reason}</p>
          <p className="excerpt">{s.excerpt}</p>
          <div className="toast-actions">
            <button className="accept" onClick={() => void accept(s)}>
              Create task
            </button>
            <button className="chip" onClick={() => void dismiss(s)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
