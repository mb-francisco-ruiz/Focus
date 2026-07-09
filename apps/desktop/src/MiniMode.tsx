import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import type { Task } from "@focus/shared";
import { AUTH_CHANGED_EVENT, createTask, getProfile, isLoggedIn, listSuggestions, listTasks, updateTask, uploadImage } from "./api";
import logo from "./assets/logo.svg";
import { queueCapture } from "./cache";
import { PRIORITY_COLORS } from "./colors";
import {
  controlStatus,
  focusSystemPrompt,
  localAiReady,
  localAssistant,
  localEnrichTask,
  stopControl,
  type ControlStatus,
} from "./localAi";
import { expandFromMini, resizeMini, type ExpandPayload } from "./mini";
import { isTauri } from "./tauri-env";
import { connectSync, disconnectSync, onSyncMessage } from "./sync";

const SIZES = {
  orb: [61, 61], // 20% smaller than the original 76
  panel: [340, 440],
  bubble: [340, 128],
  chat: [340, 104],
  control: [360, 300],
} as const;

type MiniView = "orb" | "panel" | "bubble" | "chat" | "control";

const BUCKET_RANK = { P1: 0, P2: 1, P3: 2 } as const;

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
  const [mode, setMode] = useState<MiniView>("orb");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [query, setQuery] = useState("");
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ctl, setCtl] = useState<ControlStatus | null>(null);
  const [ctlNote, setCtlNote] = useState("");
  const ctlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef({ down: false, moved: false, x: 0, y: 0 });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const applyMode = useCallback((next: MiniView) => {
    setMode(next);
    const [w, h] = SIZES[next];
    void resizeMini(w, h);
  }, []);

  const aiModeRef = useRef<"server" | "local">("server");
  const spheresRef = useRef<string[]>(["work", "personal"]);

  const refresh = useCallback(() => {
    if (!isLoggedIn()) return;
    listTasks().then(setTasks).catch(() => {});
    getProfile()
      .then((p) => {
        aiModeRef.current = p.aiMode;
        spheresRef.current = p.spheres?.length ? p.spheres : ["work", "personal"];
      })
      .catch(() => {});
  }, []);

  const pollCtl = useCallback(() => {
    controlStatus()
      .then((s) => {
        setCtl(s);
        if (s.running) ctlTimer.current = setTimeout(pollCtl, 1200);
      })
      .catch(() => {});
  }, []);

  const cancelCtl = useCallback(() => {
    void stopControl().catch(() => {});
    if (ctlTimer.current) clearTimeout(ctlTimer.current);
    setCtl(null);
    setCtlNote("");
    applyMode("orb");
  }, [applyMode]);

  // Account switched in the main window: drop everything from the old user,
  // reconnect the socket with the new token, refetch.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen(AUTH_CHANGED_EVENT, () => {
        setTasks([]);
        setBubble(null);
        disconnectSync();
        if (isLoggedIn()) {
          connectSync();
          refresh();
        }
      }).then((fn) => {
        unlisten = fn;
      }),
    );
    return () => unlisten?.();
  }, [refresh]);

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
      // Local mode: enrich right here from the orb (cross-window claim dedupes
      // against the main window's socket handler).
      localEnrichTask(created, aiModeRef.current);
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
  const byPriority = (a: Task, b: Task) =>
    BUCKET_RANK[a.priority] - BUCKET_RANK[b.priority] ||
    Number(a.blocked) - Number(b.blocked) ||
    b.priorityScore - a.priorityScore ||
    b.createdAt.localeCompare(a.createdAt);
  const visible = q
    ? tasks
        .filter((t) => `${t.title} ${t.rawInput}`.toLowerCase().includes(q))
        .sort(byPriority)
        .slice(0, 8)
    : tasks
        .filter((t) => t.status !== "done" && t.status !== "archived")
        .sort(byPriority)
        .slice(0, 6);

  if (mode === "orb") {
    return (
      <div
        className="mini-orb"
        title="Focus — click to open, right-click to chat, drag to move"
        onMouseDown={orbMouseDown}
        onMouseMove={(e) => void orbMouseMove(e)}
        onMouseUp={orbMouseUp}
        onContextMenu={(e) => {
          e.preventDefault();
          setChatInput("");
          applyMode("chat");
        }}
      >
        <img src={logo} alt="Focus" draggable={false} />
      </div>
    );
  }

  if (mode === "chat") {
    const submitChat = async (e: React.FormEvent) => {
      e.preventDefault();
      const text = chatInput.trim();
      if (!text) return;
      setChatInput("");
      // Not local mode → hand the message to the full assistant window.
      if (aiModeRef.current !== "local" || !(await localAiReady())) {
        void expandFromMini({ chat: text }).then(() => applyMode("orb"));
        return;
      }
      // Local mode: run the assistant here. If it launches a computer-control
      // run, stay in a mini control view; otherwise show its reply as a bubble.
      setCtl(null);
      setCtlNote("Thinking…");
      applyMode("control");
      try {
        const reply = await localAssistant(focusSystemPrompt(spheresRef.current), [
          { role: "user", content: text },
        ]);
        const st = await controlStatus();
        if (st.running || st.steps.length > 0) {
          setCtl(st);
          pollCtl();
        } else {
          setBubble({ title: "Focus", body: reply, target: {} });
          applyMode("bubble");
        }
      } catch {
        setCtlNote("Couldn't reach local AI.");
      }
    };
    return (
      <div className="mini-chat">
        <button className="mini-logo" title="Cancel" onClick={() => applyMode("orb")}>
          <img src={logo} alt="" draggable={false} />
        </button>
        <form onSubmit={(e) => void submitChat(e)}>
          <input
            className="mini-chat-input"
            placeholder="Ask Focus…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") applyMode("orb");
            }}
          />
        </form>
        <span className="mini-chat-hint">↵ ask or control</span>
      </div>
    );
  }

  if (mode === "control") {
    const last = ctl?.steps?.[ctl.steps.length - 1];
    const args = last?.args
      ? Object.entries(last.args)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 24 ? `${v.slice(0, 24)}…` : v}`)
          .join(" ")
      : "";
    const note = ctl?.result ?? (last ? `${last.action} ${args}` : ctlNote || "Working…");
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
        <div className="mini-control">
          <button className="bubble-close" onClick={cancelCtl}>
            ✕
          </button>
          {ctl?.shots?.[0] && <img className="mini-ctl-shot" src={ctl.shots[0]} alt="" />}
          <p className="mini-ctl-note">{note}</p>
          {ctl && !ctl.running && (
            <span className="mini-ctl-done">{ctl.error ? "Stopped" : "Done"}</span>
          )}
        </div>
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

  // Panel dragging: any mousedown on non-interactive surface moves the window.
  const panelMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, button, li, a")) return;
    drag.current = { down: true, moved: false, x: e.screenX, y: e.screenY };
  };

  return (
    <div
      className="mini-panel"
      onMouseDown={panelMouseDown}
      onMouseMove={(e) => void orbMouseMove(e)}
      onMouseUp={() => {
        drag.current.down = false;
      }}
    >
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
            {task.status === "active" && <span className="progress-tag mini">in progress</span>}
            {task.blocked && <span className="blocked-tag mini">blocked</span>}
            <span className="mini-sphere">{task.sphere}</span>
          </li>
        ))}
        {visible.length === 0 && <p className="empty">{q ? "No matches." : "All clear."}</p>}
      </ul>
    </div>
  );
}
