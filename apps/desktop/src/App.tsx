import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import type { Sphere, Task, UpdateTaskRequest } from "@focus/shared";
import { createTask, isLoggedIn, listSuggestions, listTasks, login, logout, updateTask } from "./api";
import logo from "./assets/logo.svg";
import { loadCachedTasks, queueCapture, replayPendingCaptures, saveCachedTasks } from "./cache";
import { registerCaptureHotkey } from "./hotkey";
import Memory from "./Memory";
import { EXPAND_EVENT, shrinkToMini, type ExpandPayload } from "./mini";
import { showNotification } from "./notifications";
import Settings from "./Settings";
import Suggestions from "./Suggestions";
import { connectSync, disconnectSync, onSyncMessage, onSyncStatus } from "./sync";
import TaskDetail from "./TaskDetail";
import TaskRow from "./TaskRow";
import { isTauri } from "./tauri-env";

type View = "roadmap" | "todo" | "completed" | "suggestions" | "memory" | "settings";

const OPEN_STATUSES = ["inbox", "active", "waiting"];
const VIEW_TITLES: Record<Exclude<View, "settings" | "suggestions" | "memory">, string> = {
  roadmap: "Roadmap",
  todo: "To Do",
  completed: "Completed",
};

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      onLogin();
    } catch {
      setError("Invalid credentials");
    }
  };

  return (
    <div className="login-screen">
      <form className="login" onSubmit={submit}>
        <img src={logo} className="logo-lg" alt="Focus" />
        <h1>Focus</h1>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">Sign in</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function upsert(tasks: Task[], task: Task): Task[] {
  return [...tasks.filter((t) => t.id !== task.id), task];
}

const byScore = (a: Task, b: Task) =>
  b.priorityScore - a.priorityScore || b.createdAt.localeCompare(a.createdAt);

// Explicit startDragging: the injected data-tauri-drag-region handler is
// unreliable on focused transparent windows (macOS overlay titlebar).
async function onDragStrip(e: React.MouseEvent): Promise<void> {
  if (!isTauri || e.button !== 0) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  if (e.detail === 2) await getCurrentWindow().toggleMaximize();
  else await getCurrentWindow().startDragging();
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [view, setView] = useState<View>("roadmap");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const captureRef = useRef<HTMLInputElement>(null);
  // While the floating orb is out, bubbles replace native notifications.
  const miniActive = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const fresh = await listTasks();
      setTasks(fresh);
      await saveCachedTasks(fresh);
    } catch (err) {
      if (String(err).includes("unauthorized")) onLogout();
    }
  }, [onLogout]);

  useEffect(() => {
    // Cache first for instant open, then network, then live deltas.
    void loadCachedTasks().then((cached) => {
      setTasks((current) => (current.length ? current : cached));
    });
    void refresh();
    void registerCaptureHotkey();

    const refreshSuggestionCount = () =>
      void listSuggestions()
        .then((s) => setSuggestionCount(s.length))
        .catch(() => {});
    refreshSuggestionCount();

    const offMessage = onSyncMessage((msg) => {
      if (msg.type === "task.upserted") {
        setTasks((prev) => {
          const next = upsert(prev, msg.task);
          void saveCachedTasks(next);
          return next;
        });
      } else if (msg.type === "task.deleted") {
        setTasks((prev) => prev.filter((t) => t.id !== msg.id));
      } else if (msg.type === "suggestion.changed") {
        refreshSuggestionCount();
      } else if (msg.type === "notification") {
        if (!miniActive.current) void showNotification(msg.title, msg.body);
      }
    });
    const offStatus = onSyncStatus((isOnline) => {
      setOnline(isOnline);
      if (isOnline) {
        void replayPendingCaptures().then((created) => {
          if (created.length) void refresh();
        });
      }
    });
    connectSync();

    // Mini-mode expand: land on the task/view the user clicked in the orb panel.
    let unlistenExpand: (() => void) | undefined;
    if (isTauri) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<ExpandPayload>(EXPAND_EVENT, (event) => {
          miniActive.current = false;
          if (event.payload.view === "suggestions") setView("suggestions");
          else if (event.payload.taskId) {
            setView("roadmap");
            setSelectedId(event.payload.taskId);
          }
        }).then((fn) => {
          unlistenExpand = fn;
        }),
      );
    }

    return () => {
      offMessage();
      offStatus();
      unlistenExpand?.();
      disconnectSync();
    };
  }, [refresh]);

  const capture = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = input.trim();
    if (!rawInput) return;
    setInput("");
    const clientId = ulid();
    try {
      const created = await createTask(rawInput, clientId);
      setTasks((prev) => upsert(prev, created));
    } catch {
      // Offline: queue for replay, show a local placeholder immediately.
      await queueCapture({ clientId, rawInput, capturedAt: new Date().toISOString() });
      const placeholder: Task = {
        id: clientId,
        userId: "",
        rawInput,
        title: rawInput,
        titleOverridden: false,
        sphere: "personal",
        sphereOverridden: false,
        tags: [],
        status: "inbox",
        dueAt: null,
        dueAtOverridden: false,
        priority: "P2",
        priorityScore: 50,
        priorityOverridden: false,
        enrichedAt: null,
        aiSuggestion: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setTasks((prev) => upsert(prev, placeholder));
    }
  };

  const patchTask = useCallback(
    async (id: string, patch: UpdateTaskRequest) => {
      // Optimistic: apply locally, reconcile with the server response,
      // roll back via refresh on failure.
      setTasks((prev) => prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t)));
      try {
        const updated = await updateTask(id, patch);
        setTasks((prev) => upsert(prev, updated));
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const counts = useMemo(
    () => ({
      todo: tasks.filter((t) => OPEN_STATUSES.includes(t.status)).length,
      completed: tasks.filter((t) => t.status === "done").length,
    }),
    [tasks],
  );

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const renderRows = (list: Task[]) =>
    list.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        hideSphere
        selected={task.id === selectedId}
        onSelect={() => setSelectedId(task.id)}
        onToggleDone={() =>
          void patchTask(task.id, { status: task.status === "done" ? "inbox" : "done" })
        }
        onRename={(title) => void patchTask(task.id, { title })}
      />
    ));

  /** One sphere column; which sections show depends on the view. */
  const renderColumn = (sphere: Sphere) => {
    const inSphere = tasks.filter((t) => t.sphere === sphere);
    const open =
      view === "completed"
        ? []
        : inSphere.filter((t) => OPEN_STATUSES.includes(t.status)).sort(byScore);
    const completed =
      view === "todo"
        ? []
        : inSphere
            .filter((t) => t.status === "done")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return (
      <section key={sphere} className="sphere-col">
        <h2 className="col-label">{sphere}</h2>
        {view !== "completed" && (
          <>
            <ul className="tasks">{renderRows(open)}</ul>
            {open.length === 0 && <p className="empty">All clear.</p>}
          </>
        )}
        {completed.length > 0 && (
          <div className={view === "completed" ? "" : "completed-sub"}>
            {view !== "completed" && <h3 className="col-label">completed</h3>}
            <ul className="tasks">{renderRows(completed)}</ul>
          </div>
        )}
        {view === "completed" && completed.length === 0 && (
          <p className="empty">Nothing completed yet.</p>
        )}
      </section>
    );
  };

  return (
    <div className="shell">
      {/* empty strip under the overlay titlebar; drag/double-click like a titlebar */}
      <div className="drag-strip" onMouseDown={(e) => void onDragStrip(e)} />
      <nav className="sidebar">
        <div className="brand">
          <button
            className="brand-logo"
            title={isTauri ? "Shrink to floating bubble" : "Focus"}
            onClick={() => {
              if (!isTauri) return;
              miniActive.current = true;
              void shrinkToMini();
            }}
          >
            <img src={logo} className="logo" alt="" />
          </button>
          Focus
        </div>
        <div className="nav">
          <button className={view === "roadmap" ? "active" : ""} onClick={() => setView("roadmap")}>
            Roadmap
          </button>
          <button
            className={`sub ${view === "todo" ? "active" : ""}`}
            onClick={() => setView("todo")}
          >
            To Do <span className="count">{counts.todo}</span>
          </button>
          <button
            className={`sub ${view === "completed" ? "active" : ""}`}
            onClick={() => setView("completed")}
          >
            Completed <span className="count">{counts.completed}</span>
          </button>
          <button
            className={view === "suggestions" ? "active" : ""}
            onClick={() => setView("suggestions")}
          >
            Suggestions{" "}
            {suggestionCount > 0 && <span className="count badge">{suggestionCount}</span>}
          </button>
          <button
            className={view === "memory" ? "active" : ""}
            onClick={() => setView("memory")}
          >
            Memory
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </div>
        <div className="sidebar-footer">
          <button className="link" onClick={() => { logout(); onLogout(); }}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="content">
        {view === "settings" ? (
          <Settings online={online} onLogout={() => { logout(); onLogout(); }} />
        ) : view === "suggestions" ? (
          <Suggestions onCountChange={setSuggestionCount} />
        ) : view === "memory" ? (
          <Memory />
        ) : (
          <>
            <header className="content-head">
              <h1>{VIEW_TITLES[view]}</h1>
            </header>

            {view !== "completed" && (
              <form className="capture" onSubmit={capture}>
                <input
                  ref={captureRef}
                  placeholder="Add a task in natural language… (⌘⇧Space from any app)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoFocus
                />
              </form>
            )}

            <div className="board">
              <div className="columns-board">
                {(["work", "personal"] as const).map((s) => renderColumn(s))}
              </div>

              {selected && (
                <TaskDetail
                  task={selected}
                  onPatch={(patch) => void patchTask(selected.id, patch)}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  return loggedIn ? (
    <Workspace onLogout={() => setLoggedIn(false)} />
  ) : (
    <Login onLogin={() => setLoggedIn(true)} />
  );
}
