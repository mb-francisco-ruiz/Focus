import { useCallback, useEffect, useState } from "react";
import type { ContextItem, Subtask, Task, UpdateTaskRequest } from "@focus/shared";
import { addNote, addSubtask, attachmentUrl, deleteSubtask, getContext, listSubtasks, updateSubtask, uploadImage } from "./api";
import { PRIORITIES, PRIORITY_LABELS } from "./colors";
import { onSyncMessage } from "./sync";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Combine a local date + optional time into a due patch (UTC ISO + hasTime). */
function duePatch(date: string, time: string): UpdateTaskRequest {
  if (!date) return { dueAt: null, dueHasTime: false };
  const dt = new Date(`${date}T${time || "18:00"}`); // parsed as local time
  return { dueAt: dt.toISOString(), dueHasTime: Boolean(time) };
}

/** Inline detail, expanded below a task row (multiple can be open at once). */
export default function TaskDetail({
  task,
  spheres,
  onPatch,
}: {
  task: Task;
  spheres: string[];
  onPatch: (patch: UpdateTaskRequest) => void;
}) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");

  const refreshContext = useCallback(() => {
    getContext(task.id).then(setItems).catch(() => setItems([]));
  }, [task.id]);

  useEffect(() => {
    refreshContext();
    listSubtasks(task.id).then(setSubtasks).catch(() => {});
    return onSyncMessage((msg) => {
      if (msg.type === "context.added" && msg.taskId === task.id) refreshContext();
    });
  }, [task.id, refreshContext]);

  const submitSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = subtaskDraft.trim();
    if (!title) return;
    setSubtaskDraft("");
    const created = await addSubtask(task.id, title);
    setSubtasks((prev) => [...prev, created]);
  };

  const toggleSubtask = (s: Subtask) => {
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
    void updateSubtask(s.id, { done: !s.done }).catch(() => {});
  };

  const removeSubtask = (s: Subtask) => {
    setSubtasks((prev) => prev.filter((x) => x.id !== s.id));
    void deleteSubtask(s.id);
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = note.trim();
    if (!body) return;
    setNote("");
    const item = await addNote(task.id, body);
    setItems((prev) => [...prev, item]);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (!file.type.startsWith("image/")) continue;
      const item = await uploadImage(task.id, file);
      setItems((prev) => [...prev, item]);
    }
  };

  return (
    <div
      className={`detail-inline ${dragging ? "dragging" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <button
        className="trash"
        title="Archive"
        onClick={() => onPatch({ status: "archived" })}
      >
        🗑
      </button>

      {task.rawInput !== task.title && <p className="raw">“{task.rawInput}”</p>}

      <div className="subtasks">
        {subtasks.map((s) => (
          <div key={s.id} className={`subtask ${s.done ? "done" : ""}`}>
            <button className={`check ${s.done ? "checked" : ""}`} onClick={() => toggleSubtask(s)}>
              {s.done ? "✓" : ""}
            </button>
            <span className="title">{s.title}</span>
            <button className="link" title="Remove" onClick={() => removeSubtask(s)}>
              ✕
            </button>
          </div>
        ))}
        <form onSubmit={submitSubtask}>
          <input
            className="subtask-add"
            placeholder="Add a subtask…"
            value={subtaskDraft}
            onChange={(e) => setSubtaskDraft(e.target.value)}
          />
        </form>
      </div>

      <div className="controls">
        <div className="control-row">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={`priority prio-chip ${p} ${task.priority === p ? "active" : ""}`}
              onClick={() => onPatch({ priority: p })}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
          <span className="control-sep" />
          {spheres.map((s) => (
            <button
              key={s}
              className={`chip ${task.sphere === s ? "active" : ""}`}
              onClick={() => onPatch({ sphere: s })}
            >
              {s}
            </button>
          ))}
          <span className="control-sep" />
          <label>
            Due{" "}
            <input
              type="date"
              value={task.dueAt ? localDate(task.dueAt) : ""}
              onChange={(e) =>
                onPatch(duePatch(e.target.value, task.dueAt && task.dueHasTime ? localTime(task.dueAt) : ""))
              }
            />
            {task.dueAt && (
              <input
                className="due-time"
                type="time"
                value={task.dueHasTime ? localTime(task.dueAt) : ""}
                onChange={(e) => onPatch(duePatch(localDate(task.dueAt!), e.target.value))}
              />
            )}
          </label>
          {task.dueAt && (
            <button
              className={`chip gcal-toggle ${task.calendarSync ? "on" : ""}`}
              title={task.calendarSync ? "Syncing to Google Calendar" : "Add to Google Calendar"}
              onClick={() => onPatch({ calendarSync: !task.calendarSync })}
            >
              {task.calendarSync ? "✓ Google Calendar" : "+ Google Calendar"}
            </button>
          )}
          {task.status === "done" && (
            <button className="chip" onClick={() => onPatch({ status: "inbox" })}>
              reopen
            </button>
          )}
        </div>
      </div>

      <div className="context">
        {items.map((item) => (
          <div key={item.id} className={`context-item ${item.kind}`}>
            {item.kind === "image" && item.attachmentKey ? (
              <img src={attachmentUrl(item.attachmentKey)} alt={item.body ?? "attachment"} />
            ) : (
              <p>{item.body}</p>
            )}
            <time>{new Date(item.createdAt).toLocaleString()}</time>
          </div>
        ))}
        {items.length === 0 && <p className="empty">No context yet — add a note or drop an image.</p>}
      </div>

      <form className="note" onSubmit={submitNote}>
        <input
          placeholder="Add a note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </div>
  );
}
