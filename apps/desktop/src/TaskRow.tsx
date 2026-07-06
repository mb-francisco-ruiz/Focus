import { useEffect, useRef, useState } from "react";
import type { Task } from "@focus/shared";
import { PRIORITY_LABELS } from "./colors";

export default function TaskRow({
  task,
  selected,
  hideSphere = false,
  onSelect,
  onToggleDone,
  onRename,
}: {
  task: Task;
  selected: boolean;
  /** Inside a work/personal column the sphere is redundant. */
  hideSphere?: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = task.status === "done";

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== task.title) onRename(title);
    else setDraft(task.title);
  };

  return (
    <li className={`${selected ? "selected" : ""} ${done ? "done" : ""}`} onClick={onSelect}>
      <button
        className={`check ${done ? "checked" : ""}`}
        title={done ? "Reopen" : "Done"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
      >
        {done ? "✓" : ""}
      </button>
      <span className={`priority ${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="title-edit"
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="title"
          title="Double-click to edit"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(task.title);
            setEditing(true);
          }}
        >
          {task.title}
        </span>
      )}
      <span className="meta">
        {[
          hideSphere ? null : task.sphere,
          task.dueAt ? `due ${new Date(task.dueAt).toLocaleDateString()}` : null,
          !task.enrichedAt && !done ? "classifying…" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </li>
  );
}
