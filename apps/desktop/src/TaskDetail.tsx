import { useCallback, useEffect, useState } from "react";
import type { ContextItem, PriorityBucket, Sphere, Task, UpdateTaskRequest } from "@focus/shared";
import { addNote, attachmentUrl, getContext, uploadImage } from "./api";
import { PRIORITY_COLORS } from "./colors";
import { onSyncMessage } from "./sync";

const PRIORITIES: PriorityBucket[] = ["P0", "P1", "P2", "P3"];
const SPHERES: Sphere[] = ["work", "personal", "family", "other"];

export default function TaskDetail({
  task,
  onPatch,
  onClose,
}: {
  task: Task;
  onPatch: (patch: UpdateTaskRequest) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);

  const refreshContext = useCallback(() => {
    getContext(task.id).then(setItems).catch(() => setItems([]));
  }, [task.id]);

  useEffect(() => {
    refreshContext();
    return onSyncMessage((msg) => {
      if (msg.type === "context.added" && msg.taskId === task.id) refreshContext();
    });
  }, [task.id, refreshContext]);

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
    <aside
      className={`detail ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="detail-head">
        <h2>{task.title}</h2>
        <button className="link" onClick={onClose}>
          ✕
        </button>
      </div>

      {task.rawInput !== task.title && <p className="raw">“{task.rawInput}”</p>}

      <div className="controls">
        <div className="control-row">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={`chip ${task.priority === p ? "active" : ""}`}
              style={task.priority === p ? { background: PRIORITY_COLORS[p], color: "#fff" } : {}}
              onClick={() => onPatch({ priority: p })}
            >
              {p}
            </button>
          ))}
          {task.priorityOverridden && <span className="pinned" title="Pinned — AI won't change it">📌</span>}
        </div>
        <div className="control-row">
          {SPHERES.map((s) => (
            <button
              key={s}
              className={`chip ${task.sphere === s ? "active" : ""}`}
              onClick={() => onPatch({ sphere: s })}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="control-row">
          <label>
            Due{" "}
            <input
              type="date"
              value={task.dueAt ? task.dueAt.slice(0, 10) : ""}
              onChange={(e) =>
                onPatch({
                  dueAt: e.target.value ? new Date(`${e.target.value}T18:00:00`).toISOString() : null,
                })
              }
            />
          </label>
          <button className="chip" onClick={() => onPatch({ status: "waiting" })}>
            waiting
          </button>
          <button className="chip" onClick={() => onPatch({ status: "archived" })}>
            archive
          </button>
        </div>
        {task.tags.length > 0 && <p className="tags">{task.tags.map((t) => `#${t}`).join(" ")}</p>}
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
          placeholder="Add a note… (or drop an image anywhere)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </aside>
  );
}
