import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextItem, Sphere, Task, UpdateTaskRequest } from "@focus/shared";
import { addNote, attachmentUrl, getContext, uploadImage } from "./api";
import { PRIORITIES, PRIORITY_LABELS } from "./colors";
import { onSyncMessage } from "./sync";

const SPHERES: Sphere[] = ["work", "personal"];

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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleRef = useRef<HTMLInputElement>(null);

  const refreshContext = useCallback(() => {
    getContext(task.id).then(setItems).catch(() => setItems([]));
  }, [task.id]);

  useEffect(() => {
    refreshContext();
    return onSyncMessage((msg) => {
      if (msg.type === "context.added" && msg.taskId === task.id) refreshContext();
    });
  }, [task.id, refreshContext]);

  useEffect(() => {
    if (editingTitle) titleRef.current?.select();
  }, [editingTitle]);

  const commitTitle = () => {
    setEditingTitle(false);
    const title = titleDraft.trim();
    if (title && title !== task.title) onPatch({ title });
    else setTitleDraft(task.title);
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
        {editingTitle ? (
          <input
            ref={titleRef}
            className="title-edit"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <h2
            title="Double-click to edit"
            onDoubleClick={() => {
              setTitleDraft(task.title);
              setEditingTitle(true);
            }}
          >
            {task.title}
            {task.titleOverridden && <span className="pinned" title="Edited by you">📌</span>}
          </h2>
        )}
        <button className="link" onClick={onClose}>
          ✕
        </button>
      </div>

      {task.rawInput !== task.title && <p className="raw">“{task.rawInput}”</p>}

      {task.aiSuggestion && (
        <div className="suggestion">
          <span className="suggestion-label">✦ AI · next step</span>
          <p>{task.aiSuggestion}</p>
        </div>
      )}

      <div className="controls">
        <div className="control-row">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={`chip prio-chip ${p} ${task.priority === p ? "active" : ""}`}
              onClick={() => onPatch({ priority: p })}
            >
              {PRIORITY_LABELS[p]}
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
          {task.status !== "done" ? (
            <>
              <button className="chip" onClick={() => onPatch({ status: "waiting" })}>
                waiting
              </button>
              <button className="chip" onClick={() => onPatch({ status: "archived" })}>
                archive
              </button>
            </>
          ) : (
            <button className="chip" onClick={() => onPatch({ status: "inbox" })}>
              reopen
            </button>
          )}
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
          placeholder="Add a note… the AI re-analyzes with it"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </aside>
  );
}
