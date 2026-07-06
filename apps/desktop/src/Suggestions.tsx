import { useCallback, useEffect, useState } from "react";
import type { Suggestion } from "@focus/shared";
import { acceptSuggestion, dismissSuggestion, listSuggestions } from "./api";
import { onSyncMessage } from "./sync";

/**
 * Review queue (PLAN.md §5.3): AI-suggested tasks from Gmail/Slack.
 * Nothing lands in the task list without an explicit accept here.
 */
export default function Suggestions({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);

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
      if (msg.type === "suggestion.changed") refresh();
    });
  }, [refresh]);

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
