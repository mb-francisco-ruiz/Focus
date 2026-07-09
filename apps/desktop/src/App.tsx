import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import type { Task, UpdateTaskRequest, UserProfile } from "@focus/shared";
import { avatarUrl, createTask, getProfile, isLoggedIn, listIntegrations, listSuggestions, listTasks, login, logout, refreshSlackDigest, register, updateTask } from "./api";
import AskFocus from "./AskFocus";
import logo from "./assets/logo.svg";
import { loadCachedTasks, queueCapture, replayPendingCaptures, saveCachedTasks } from "./cache";
import Calendar from "./Calendar";
import Control from "./Control";
import { registerCaptureHotkey } from "./hotkey";
import Intelligence from "./Intelligence";
import { localEnrichTask } from "./localAi";
import { EXPAND_EVENT, shrinkToMini, type ExpandPayload } from "./mini";
import { showNotification } from "./notifications";
import Routines from "./Routines";
import Settings from "./Settings";
import SlackDigest from "./SlackDigest";
import Suggestions from "./Suggestions";
import SuggestionToast from "./SuggestionToast";
import { connectSync, disconnectSync, onSyncMessage, onSyncStatus } from "./sync";
import Today from "./Today";
import TaskDetail from "./TaskDetail";
import TaskRow from "./TaskRow";
import { isTauri } from "./tauri-env";

type View =
  | "roadmap"
  | "today"
  | "todo"
  | "completed"
  | "calendar"
  | "suggestions"
  | "intelligence"
  | "routines"
  | "control"
  | "slack"
  | "settings";

const OPEN_STATUSES = ["inbox", "active", "waiting"];
const VIEW_TITLES: Record<
  Exclude<View, "settings" | "suggestions" | "intelligence" | "calendar" | "slack" | "routines" | "today" | "control">,
  string
> = {
  roadmap: "Roadmap",
  todo: "To Do",
  completed: "Completed",
};

function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signin") await login(username, password);
      else await register(username, password);
      onLogin();
    } catch (err) {
      setError(
        mode === "signup" && String(err).includes("409")
          ? "That username is taken"
          : "Invalid credentials",
      );
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
        <button type="submit">{mode === "signin" ? "Sign in" : "Create account"}</button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setError(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
        >
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function upsert(tasks: Task[], task: Task): Task[] {
  return [...tasks.filter((t) => t.id !== task.id), task];
}

const BUCKET_RANK = { P1: 0, P2: 1, P3: 2 } as const;
const byScore = (a: Task, b: Task) =>
  BUCKET_RANK[a.priority] - BUCKET_RANK[b.priority] ||
  Number(a.blocked) - Number(b.blocked) || // blocked sinks below same-priority peers
  b.priorityScore - a.priorityScore ||
  b.createdAt.localeCompare(a.createdAt);

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const [hasSlack, setHasSlack] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const spheres = profile?.spheres?.length ? profile.spheres : ["work", "personal"];
  const [hiddenSpheres, setHiddenSpheres] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("focus.hiddenColumns") ?? "[]");
    } catch {
      return [];
    }
  });
  const visibleList = spheres.filter((s) => !hiddenSpheres.includes(s));
  const captureRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chatSeed, setChatSeed] = useState<{ text: string; nonce: number } | null>(null);
  // While the floating orb is out, bubbles replace native notifications.
  const miniActive = useRef(false);
  // Local-mode enrichment: kick off on the desktop for un-enriched tasks that
  // arrive over the socket (from any window). Guarded so the closure in the
  // long-lived sync handler always sees the current mode + in-flight set.
  const aiModeRef = useRef<"server" | "local">("server");
  aiModeRef.current = profile?.aiMode ?? "server";
  const maybeLocalEnrich = useCallback((task: Task) => {
    localEnrichTask(task, aiModeRef.current);
  }, []);

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
    void getProfile().then(setProfile).catch(() => {});
    void listIntegrations()
      .then(({ accounts }) => setHasSlack(accounts.some((a) => a.provider === "slack")))
      .catch(() => {});
    // Daily Slack digest: generate if today's is missing (no-op otherwise).
    void refreshSlackDigest(false).catch(() => {});
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
        maybeLocalEnrich(msg.task);
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

    // Catch-all reconciliation: the live WS delta only reaches clients on the
    // same server instance that handled a write, so tasks created out-of-band
    // (MCP, another device, a different instance sharing the DB) can be missed.
    // Refetch when the window regains focus, and poll gently while it's open.
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 45_000);

    // Mini-mode expand: land on the task/view the user clicked in the orb panel.
    let unlistenExpand: (() => void) | undefined;
    if (isTauri) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<ExpandPayload>(EXPAND_EVENT, (event) => {
          miniActive.current = false;
          if (event.payload.chat) {
            setChatSeed({ text: event.payload.chat, nonce: Date.now() });
          } else if (event.payload.view === "suggestions") setView("suggestions");
          else if (event.payload.taskId) {
            const id = event.payload.taskId;
            setView("roadmap");
            setExpandedIds(new Set([id]));
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
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
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
        sphere: spheres[0] ?? "personal",
        sphereOverridden: false,
        tags: [],
        status: "inbox",
        dueAt: null,
        dueAtOverridden: false,
        dueHasTime: false,
        calendarSync: false,
        priority: "P2",
        priorityScore: 50,
        priorityOverridden: false,
        blocked: false,
        enrichedAt: null,
        aiSuggestion: null,
        aiSuggestionDetail: null,
        subtaskCount: 0,
        subtaskDone: 0,
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

  const toggleSphere = (s: string) =>
    setHiddenSpheres((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      if (spheres.every((sp) => next.includes(sp))) return prev; // keep one visible
      localStorage.setItem("focus.hiddenColumns", JSON.stringify(next));
      return next;
    });

  // Only one task detail open at a time.
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));

  const renderRows = (list: Task[]) =>
    list.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        hideSphere
        expanded={expandedIds.has(task.id)}
        onToggleExpand={() => toggleExpand(task.id)}
        onToggleDone={() =>
          void patchTask(task.id, { status: task.status === "done" ? "inbox" : "done" })
        }
        onRename={(title) => void patchTask(task.id, { title })}
        onContextMenu={(x, y) => setMenu({ id: task.id, x, y })}
      >
        <TaskDetail task={task} spheres={spheres} onPatch={(patch) => void patchTask(task.id, patch)} />
      </TaskRow>
    ));

  /** One sphere column; which sections show depends on the view. */
  const renderColumn = (sphere: string) => {
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
            className={view === "calendar" ? "active" : ""}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
          <button
            className={`sub ${view === "today" ? "active" : ""}`}
            onClick={() => setView("today")}
          >
            Today
          </button>
          <button
            className={view === "suggestions" ? "active" : ""}
            onClick={() => setView("suggestions")}
          >
            Suggestions{" "}
            {suggestionCount > 0 && <span className="count badge">{suggestionCount}</span>}
          </button>
          <button
            className={view === "intelligence" ? "active" : ""}
            onClick={() => setView("intelligence")}
          >
            Intelligence
          </button>
          <button
            className={view === "routines" ? "active" : ""}
            onClick={() => setView("routines")}
          >
            Routines
          </button>
          {isTauri && profile?.aiMode === "local" && (
            <button
              className={view === "control" ? "active" : ""}
              onClick={() => setView("control")}
            >
              Control
            </button>
          )}
          {hasSlack && (
            <button
              className={view === "slack" ? "active" : ""}
              onClick={() => setView("slack")}
            >
              Slack
            </button>
          )}
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </div>
        <div className="sidebar-footer">
          <div className="me">
            {profile?.avatarKey ? (
              <img className="avatar" src={avatarUrl(profile.avatarKey)} alt="" />
            ) : (
              <span className="avatar placeholder">{(profile?.username ?? "?")[0]?.toUpperCase()}</span>
            )}
            <span className="me-name">{profile?.displayName ?? profile?.username ?? ""}</span>
          </div>
          <button className="link" onClick={() => { logout(); onLogout(); }}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="content">
        {view === "settings" ? (
          <Settings online={online} profile={profile} onProfileChange={setProfile} onLogout={() => { logout(); onLogout(); }} />
        ) : view === "slack" ? (
          <SlackDigest />
        ) : view === "suggestions" ? (
          <Suggestions onCountChange={setSuggestionCount} />
        ) : view === "intelligence" ? (
          <Intelligence />
        ) : view === "routines" ? (
          <Routines />
        ) : view === "control" ? (
          <Control />
        ) : view === "today" ? (
          <Today
            tasks={tasks}
            aiMode={profile?.aiMode ?? "server"}
            onOpenTask={(id) => {
              setView("roadmap");
              setExpandedIds(new Set([id]));
            }}
          />
        ) : view === "calendar" ? (
          <Calendar
            tasks={tasks}
            onOpenTask={(id) => {
              setView("roadmap");
              setExpandedIds(new Set([id]));
            }}
            onMoveTask={(id, dueAt) => void patchTask(id, { dueAt })}
          />
        ) : (
          <>
            <header className="content-head">
              <h1>{VIEW_TITLES[view]}</h1>
              <div className="col-toggles">
                {spheres.map((s) => (
                  <label key={s} className={!hiddenSpheres.includes(s) ? "on" : ""}>
                    <input
                      type="checkbox"
                      checked={!hiddenSpheres.includes(s)}
                      onChange={() => toggleSphere(s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
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

            <div className="columns-board">
              {visibleList.map((s) => renderColumn(s))}
            </div>
          </>
        )}
      </main>

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            {(() => {
              const t = tasks.find((x) => x.id === menu.id);
              const inProgress = t?.status === "active";
              return (
                <>
                  <button
                    onClick={() => {
                      void patchTask(menu.id, { status: inProgress ? "inbox" : "active" });
                      setMenu(null);
                    }}
                  >
                    {inProgress ? "Not in progress" : "In Progress"}
                  </button>
                  <button
                    onClick={() => {
                      void patchTask(menu.id, { blocked: !t?.blocked });
                      setMenu(null);
                    }}
                  >
                    {t?.blocked ? "Unblock" : "Blocked"}
                  </button>
                </>
              );
            })()}
            <button
              className="danger"
              onClick={() => {
                void patchTask(menu.id, { status: "archived" });
                setExpandedIds((prev) => { const n = new Set(prev); n.delete(menu.id); return n; });
                setMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      <AskFocus
        seed={chatSeed ?? undefined}
        aiMode={profile?.aiMode ?? "server"}
        spheres={spheres}
        onControlStarted={() => setView("control")}
      />

      <SuggestionToast
        onCreated={() => {
          void refresh();
          void listSuggestions().then((s) => setSuggestionCount(s.length)).catch(() => {});
        }}
      />
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
