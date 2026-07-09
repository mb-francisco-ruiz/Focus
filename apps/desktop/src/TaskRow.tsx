import { useEffect, useRef, useState } from "react";
import type { Task } from "@focus/shared";
import { PRIORITY_LABELS } from "./colors";

export default function TaskRow({
  task,
  expanded,
  hideSphere = false,
  onToggleExpand,
  onToggleDone,
  onRename,
  onContextMenu,
  children,
}: {
  task: Task;
  expanded: boolean;
  /** Inside a work/personal column the sphere is redundant. */
  hideSphere?: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onRename: (title: string) => void;
  onContextMenu?: (x: number, y: number) => void;
  /** Inline detail, rendered expanded below the row. */
  children?: React.ReactNode;
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
    <li className={`${expanded ? "expanded" : ""} ${done ? "done" : ""}`}>
      <div
        className="task-row"
        onClick={onToggleExpand}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY);
        }}
      >
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
        {task.status === "active" && <span className="progress-tag">in progress</span>}
        {task.blocked && <span className="blocked-tag">blocked</span>}
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
            task.subtaskCount > 0 ? `${task.subtaskDone}/${task.subtaskCount}` : null,
            task.dueAt
              ? `due ${new Date(task.dueAt).toLocaleDateString()}${
                  task.dueHasTime
                    ? ` ${new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""
                }`
              : null,
            !task.enrichedAt && !done ? "classifying…" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {expanded && children}
    </li>
  );
}
