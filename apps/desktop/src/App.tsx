import { useCallback, useEffect, useMemo, useState } from "react";
import { ulid } from "ulid";
import type { Task } from "@focus/shared";
import { createTask, isLoggedIn, listTasks, login, logout, updateTask } from "./api";
import { loadCachedTasks, queueCapture, replayPendingCaptures, saveCachedTasks } from "./cache";
import { PRIORITY_COLORS } from "./colors";
import { registerCaptureHotkey } from "./hotkey";
import { connectSync, disconnectSync, onSyncMessage, onSyncStatus } from "./sync";
import TaskDetail from "./TaskDetail";

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
    <form className="login" onSubmit={submit}>
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
  );
}

function upsert(tasks: Task[], task: Task): Task[] {
  const rest = tasks.filter((t) => t.id !== task.id);
  return [...rest, task];
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const fresh = await listTasks();
      setTasks(fresh);
      await saveCachedTasks(fresh);
      setError(null);
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

    const offMessage = onSyncMessage((msg) => {
      if (msg.type === "task.upserted") {
        setTasks((prev) => {
          const next = upsert(prev, msg.task);
          void saveCachedTasks(next);
          return next;
        });
      } else if (msg.type === "task.deleted") {
        setTasks((prev) => prev.filter((t) => t.id !== msg.id));
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
    return () => {
      offMessage();
      offStatus();
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
        sphere: "other",
        sphereOverridden: false,
        tags: [],
        status: "inbox",
        dueAt: null,
        dueAtOverridden: false,
        priority: "P2",
        priorityScore: 50,
        priorityOverridden: false,
        enrichedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setTasks((prev) => upsert(prev, placeholder));
    }
  };

  const patchTask = async (id: string, patch: Parameters<typeof updateTask>[1]) => {
    const updated = await updateTask(id, patch);
    setTasks((prev) => upsert(prev, updated));
  };

  const visible = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== "done" && t.status !== "archived")
        .sort((a, b) => b.priorityScore - a.priorityScore || b.createdAt.localeCompare(a.createdAt)),
    [tasks],
  );
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="app">
      <header>
        <h1>
          Focus{" "}
          <span className={online ? "dot online" : "dot offline"} title={online ? "live" : "offline"} />
        </h1>
        <button className="link" onClick={() => { logout(); onLogout(); }}>
          Sign out
        </button>
      </header>

      <form className="capture" onSubmit={capture}>
        <input
          placeholder="Capture anything… (⌘⇧Space works from any app)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
      </form>

      {error && <p className="error">{error}</p>}

      <div className="columns">
        <ul className="tasks">
          {visible.map((task) => (
            <li
              key={task.id}
              className={task.id === selectedId ? "selected" : ""}
              onClick={() => setSelectedId(task.id)}
            >
              <button
                className="check"
                title="Done"
                onClick={(e) => {
                  e.stopPropagation();
                  setTasks((prev) => prev.filter((t) => t.id !== task.id));
                  if (selectedId === task.id) setSelectedId(null);
                  void patchTask(task.id, { status: "done" }).catch(() => void refresh());
                }}
              />
              <span className="priority" style={{ background: PRIORITY_COLORS[task.priority] }}>
                {task.priority}
              </span>
              <span className="title">{task.title}</span>
              <span className="meta">
                {task.sphere}
                {task.dueAt && ` · due ${new Date(task.dueAt).toLocaleDateString()}`}
                {!task.enrichedAt && " · classifying…"}
              </span>
            </li>
          ))}
        </ul>

        {selected && (
          <TaskDetail
            task={selected}
            onPatch={(patch) => void patchTask(selected.id, patch)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
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
