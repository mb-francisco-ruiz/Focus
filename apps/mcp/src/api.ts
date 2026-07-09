/**
 * Minimal Focus API client for the MCP server. Auth is either a long-lived
 * FOCUS_TOKEN, or FOCUS_USERNAME + FOCUS_PASSWORD (auto-login, re-login on 401).
 * Self-contained (no @focus/shared) so the server runs standalone via `npx`/node.
 */

const BASE = process.env.FOCUS_API_URL ?? "http://localhost:3001";
let token: string | null = process.env.FOCUS_TOKEN ?? null;

export interface Task {
  id: string;
  title: string;
  rawInput: string;
  sphere: string;
  status: "inbox" | "active" | "waiting" | "done" | "archived";
  priority: "P1" | "P2" | "P3";
  blocked: boolean;
  dueAt: string | null;
  subtaskDone: number;
  subtaskCount: number;
  enrichedAt: string | null;
}

export interface Routine {
  id: string;
  title: string;
  sphere: string;
  priority: string;
  cadence: string;
  interval: number;
  weekday: number | null;
  dayOfMonth: number | null;
  active: boolean;
  nextRunAt: string;
}

async function login(): Promise<void> {
  const username = process.env.FOCUS_USERNAME;
  const password = process.env.FOCUS_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Focus auth missing — set FOCUS_TOKEN, or FOCUS_USERNAME and FOCUS_PASSWORD in the MCP server env.",
    );
  }
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Focus login failed (${res.status}). Check your credentials.`);
  token = ((await res.json()) as { token: string }).token;
}

async function api<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  if (!token) await login();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  // Token expired/invalid → re-login once if we have credentials to do so.
  if (res.status === 401 && retry && process.env.FOCUS_USERNAME) {
    token = null;
    return api<T>(path, init, false);
  }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export const focus = {
  listTasks: () => api<{ tasks: Task[] }>("/tasks").then((r) => r.tasks),
  createTask: (rawInput: string) =>
    api<Task>("/tasks", { method: "POST", body: JSON.stringify({ rawInput }) }),
  updateTask: (id: string, patch: Record<string, unknown>) =>
    api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listRoutines: () => api<{ routines: Routine[] }>("/routines").then((r) => r.routines),
  createRoutine: (body: Record<string, unknown>) =>
    api<Routine>("/routines", { method: "POST", body: JSON.stringify(body) }),
  memory: () => api<{ records: { content: string }[] }>("/memory").then((r) => r.records),
};

export { BASE };
