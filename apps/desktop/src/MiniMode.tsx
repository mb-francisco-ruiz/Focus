import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import type { Task } from "@focus/shared";
import { createTask, isLoggedIn, listSuggestions, listTasks, updateTask, uploadImage } from "./api";
import logo from "./assets/logo.svg";
import { queueCapture } from "./cache";
import { PRIORITY_COLORS } from "./colors";
import { expandFromMini, resizeMini, type ExpandPayload } from "./mini";
import { connectSync, onSyncMessage } from "./sync";

const SIZES = {
  orb: [76, 76],
  panel: [340, 440],
  bubble: [340, 128],
} as const;

interface Bubble {
  title: string;
  body: string;
  target: ExpandPayload;
}

/**
 * The floating `mini` window: an always-on-top orb that opens into a compact
 * capture/search panel, and surfaces notifications as speech bubbles while
 * the main window is hidden.
 */
export default function MiniMode() {
  const [mode, setMode] = useState<"orb" | "panel" | "bubble">("orb");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useRef({ down: false, moved: false, x: 0, y: 0 });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const applyMode = useCallback((next: "orb" | "panel" | "bubble") => {
    setMode(next);
    const [w, h] = SIZES[next];
    void resizeMini(w, h);
  }, []);

  const refresh = useCallback(() => {
    if (!isLoggedIn()) return;
    listTasks().then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    connectSync();
    return onSyncMessage((msg) => {
      if (msg.type === "task.upserted") {
        setTasks((prev) => [...prev.filter((t) => t.id !== msg.task.id), msg.task]);
      } else if (msg.type === "notification") {
        void showBubble({
          title: msg.title,
          body: msg.body,
          target: msg.taskId ? { taskId: msg.taskId } : {},
        });
      } else if (msg.type === "suggestion.changed") {
        void listSuggestions()
          .then((s) => {
            const newest = s[0];
            if (newest) {
              void showBubble({
                title: "New suggestion",
                body: newest.title,
                target: { view: "suggestions" },
              });
            }
          })
          .catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBubble = async (b: Bubble) => {
    // Bubbles only when the orb is floating — the main window handles the rest.
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (!(await getCurrentWindow().isVisible())) return;
    if (modeRef.current === "panel") return; // panel already shows live data
    setBubble(b);
    applyMode("bubble");
  };

  // Orb: click opens the panel, click-and-move drags the window.
  const orbMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { down: true, moved: false, x: e.screenX, y: e.screenY };
  };
  const orbMouseMove = async (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d.down || d.moved) return;
    if (Math.abs(e.screenX - d.x) + Math.abs(e.screenY - d.y) > 6) {
      d.moved = true;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    }
  };
  const orbMouseUp = () => {
    const d = drag.current;
    if (d.down && !d.moved) {
      refresh();
      applyMode("panel");
    }
    drag.current.down = false;
  };

  const capture = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = input.trim();
    if (!rawInput) return;
    setInput("");
    const clientId = ulid();
    try {
      const created = await createTask(rawInput, clientId);
      setTasks((prev) => [created, ...prev]);
    } catch {
      await queueCapture({ clientId, rawInput, capturedAt: new Date().toISOString() });
    }
  };

  const onRowDrop = async (task: Task, e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.type.startsWith("image/")) await uploadImage(task.id, file).catch(() => {});
    }
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? tasks
        .filter((t) => `${t.title} ${t.rawInput}`.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
    : tasks
        .filter((t) => t.status !== "done" && t.status !== "archived")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6);

  if (mode === "orb") {
    return (
      <div
        className="mini-orb"
        title="Focus — click to open, drag to move"
        onMouseDown={orbMouseDown}
        onMouseMove={(e) => void orbMouseMove(e)}
        onMouseUp={orbMouseUp}
      >
        <img src={logo} alt="Focus" draggable={false} />
      </div>
    );
  }

  if (mode === "bubble" && bubble) {
    return (
      <div className="mini-bubble-row">
        <div
          className="mini-orb small"
          onMouseDown={orbMouseDown}
          onMouseMove={(e) => void orbMouseMove(e)}
          onMouseUp={orbMouseUp}
        >
          <img src={logo} alt="Focus" draggable={false} />
        </div>
        <div
          className="mini-bubble"
          onClick={() => void expandFromMini(bubble.target).then(() => applyMode("orb"))}
        >
          <button
            className="bubble-close"
            onClick={(e) => {
              e.stopPropagation();
              setBubble(null);
              applyMode("orb");
            }}
          >
            ✕
          </button>
          <strong>{bubble.title}</strong>
          <p>{bubble.body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mini-panel">
      <header className="mini-head">
        <button className="mini-logo" title="Back to bubble" onClick={() => applyMode("orb")}>
          <img src={logo} alt="" draggable={false} />
        </button>
        <input
          className="mini-search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="link"
          title="Expand Focus"
          onClick={() => void expandFromMini().then(() => applyMode("orb"))}
        >
          ⤢
        </button>
      </header>

      <form onSubmit={capture}>
        <input
          className="mini-capture"
          placeholder="Add a to-do…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") applyMode("orb");
          }}
        />
      </form>

      <ul className="mini-tasks">
        {visible.map((task) => (
          <li
            key={task.id}
            className={`${task.status === "done" ? "done" : ""} ${dropTarget === task.id ? "drop" : ""}`}
            title="Click to open in Focus — drop an image to attach"
            onClick={() =>
              void expandFromMini({ taskId: task.id }).then(() => applyMode("orb"))
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(task.id);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => void onRowDrop(task, e)}
          >
            <button
              className={`check ${task.status === "done" ? "checked" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                const status = task.status === "done" ? "inbox" : "done";
                setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
                void updateTask(task.id, { status }).catch(() => {});
              }}
            >
              {task.status === "done" ? "✓" : ""}
            </button>
            <span className="mini-dot" style={{ background: PRIORITY_COLORS[task.priority] }} />
            <span className="title">{task.title}</span>
          </li>
        ))}
        {visible.length === 0 && <p className="empty">{q ? "No matches." : "All clear."}</p>}
      </ul>
    </div>
  );
}
