import type {
  AuthResponse,
  SlackDigestInfo,
  UserProfile,
  ContextItem,
  IntegrationAccountInfo,
  CalendarEventInfo,
  MemoryRecordInfo,
  PlanBlock,
  Routine,
  SpherePreferences,
  Subtask,
  Suggestion,
  Task,
  TaskListResponse,
  UpdateTaskRequest,
} from "@focus/shared";

import { isTauri } from "./tauri-env";

const BASE_URL = import.meta.env.VITE_FOCUS_API_URL ?? "http://localhost:3001";

/** Always read localStorage (shared across all windows) — never cache in module
 *  state, or secondary windows keep acting as the previous account after a switch. */
function authToken(): string | null {
  return localStorage.getItem("focus.token");
}

/** User id from the JWT payload; keys per-user client caches. */
export function currentUserId(): string | null {
  const t = authToken();
  if (!t) return null;
  try {
    return (JSON.parse(atob(t.split(".")[1]!)) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/** Tell every window (mini, quick) that the signed-in user changed. */
export const AUTH_CHANGED_EVENT = "focus://auth-changed";
function broadcastAuthChange(): void {
  if (!isTauri) return;
  void import("@tauri-apps/api/event").then(({ emit }) => emit(AUTH_CHANGED_EVENT));
}

export function isLoggedIn(): boolean {
  return authToken() !== null;
}

/** For the local-AI sidecar, which calls the Focus API directly with the user's token. */
export function getBaseUrl(): string {
  return BASE_URL;
}
export function getAuthToken(): string | null {
  return authToken();
}

export function wsUrl(): string {
  const ws = BASE_URL.replace(/^http/, "ws");
  return `${ws}/ws?token=${encodeURIComponent(authToken() ?? "")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // Only JSON string bodies get the JSON content type — FormData sets its
      // own boundary, and body-less POSTs must not claim a JSON body.
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const auth = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem("focus.token", auth.token);
  broadcastAuthChange();
  return auth;
}

export function logout(): void {
  localStorage.removeItem("focus.token");
  broadcastAuthChange();
}

export async function register(username: string, password: string): Promise<AuthResponse> {
  const auth = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem("focus.token", auth.token);
  broadcastAuthChange();
  return auth;
}

// ---- Profile ------------------------------------------------------------------

export async function getProfile(): Promise<UserProfile> {
  return request<UserProfile>("/users/me");
}

export async function updateSpheres(
  spheres: string[],
): Promise<UserProfile & { reassigned: number }> {
  return request("/users/me/spheres", { method: "PUT", body: JSON.stringify({ spheres }) });
}

export async function setAiKey(apiKey: string): Promise<UserProfile> {
  return request<UserProfile>("/users/me/ai-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function clearAiKey(): Promise<UserProfile> {
  return request<UserProfile>("/users/me/ai-key", { method: "DELETE" });
}

export async function setAiMode(mode: "server" | "local"): Promise<UserProfile> {
  return request<UserProfile>("/users/me/ai-mode", {
    method: "PUT",
    body: JSON.stringify({ mode }),
  });
}

export async function setCalendarAccount(accountId: string | null): Promise<UserProfile> {
  return request<UserProfile>("/users/me/calendar-account", {
    method: "PUT",
    body: JSON.stringify({ accountId }),
  });
}

export async function uploadAvatar(file: File): Promise<UserProfile> {
  const form = new FormData();
  form.append("file", file);
  return request<UserProfile>("/users/me/avatar", { method: "POST", body: form });
}

/** <img>-safe URL; pass avatarKey as cache-buster so uploads show immediately. */
export function avatarUrl(avatarKey: string): string {
  return `${BASE_URL}/users/me/avatar?token=${encodeURIComponent(authToken() ?? "")}&v=${avatarKey}`;
}

export async function listTasks(): Promise<Task[]> {
  const res = await request<TaskListResponse>("/tasks");
  return res.tasks;
}

export async function createTask(rawInput: string, clientId?: string): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify({ rawInput, clientId }),
  });
}

export async function updateTask(id: string, patch: UpdateTaskRequest): Promise<Task> {
  return request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// Local-mode enrichment: fetch the server-built prompt, run it locally, post back.
export async function getEnrichRequest(taskId: string): Promise<{ prompt: string }> {
  return request(`/tasks/${taskId}/enrich-request`);
}

export async function postEnrichResult(taskId: string, enrichment: unknown): Promise<Task> {
  return request<Task>(`/tasks/${taskId}/enrich-result`, {
    method: "POST",
    body: JSON.stringify({ enrichment }),
  });
}

export async function getContext(taskId: string): Promise<ContextItem[]> {
  const res = await request<{ items: ContextItem[] }>(`/tasks/${taskId}/context`);
  return res.items;
}

export async function addNote(taskId: string, body: string): Promise<ContextItem> {
  return request<ContextItem>(`/tasks/${taskId}/context`, {
    method: "POST",
    body: JSON.stringify({ kind: "text", body }),
  });
}

export async function uploadImage(taskId: string, file: File): Promise<ContextItem> {
  const form = new FormData();
  form.append("file", file);
  return request<ContextItem>(`/tasks/${taskId}/attachments`, { method: "POST", body: form });
}

export function attachmentUrl(attachmentKey: string): string {
  // <img> tags can't send Authorization headers; Phase 2 switches to signed URLs.
  return `${BASE_URL}/attachments/${attachmentKey}?token=${encodeURIComponent(authToken() ?? "")}`;
}

// ---- Suggestions (review queue) ---------------------------------------------

export async function listSuggestions(): Promise<Suggestion[]> {
  const res = await request<{ suggestions: Suggestion[] }>("/suggestions");
  return res.suggestions;
}

export async function acceptSuggestion(id: string): Promise<Task> {
  return request<Task>(`/suggestions/${id}/accept`, { method: "POST" });
}

export async function dismissSuggestion(id: string): Promise<void> {
  await fetch(`${BASE_URL}/suggestions/${id}/dismiss`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}

/** Trigger an immediate Gmail scan for the current user. */
export async function scanInbox(): Promise<void> {
  await request("/suggestions/scan", { method: "POST" });
}

// ---- Integrations -----------------------------------------------------------

export async function listIntegrations(): Promise<{
  accounts: IntegrationAccountInfo[];
  googleConfigured: boolean;
  slackConfigured: boolean;
}> {
  return request("/integrations");
}

/** Link an account to a task category (null unlinks). */
export async function setIntegrationSphere(id: string, sphere: string | null): Promise<void> {
  await request(`/integrations/${id}`, { method: "PUT", body: JSON.stringify({ sphere }) });
}

export async function disconnectIntegration(id: string): Promise<void> {
  await fetch(`${BASE_URL}/integrations/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}

/** Browser URL that starts the Google OAuth flow for this session. */
export function googleConnectUrl(): string {
  return `${BASE_URL}/integrations/google/connect?token=${encodeURIComponent(authToken() ?? "")}`;
}

/** Browser URL that starts the Slack OAuth flow for this session. */
export function slackConnectUrl(): string {
  return `${BASE_URL}/integrations/slack/connect?token=${encodeURIComponent(authToken() ?? "")}`;
}

// ---- Subtasks -------------------------------------------------------------------

export async function listSubtasks(taskId: string): Promise<Subtask[]> {
  const res = await request<{ subtasks: Subtask[] }>(`/tasks/${taskId}/subtasks`);
  return res.subtasks;
}

export async function addSubtask(taskId: string, title: string): Promise<Subtask> {
  return request<Subtask>(`/tasks/${taskId}/subtasks`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function updateSubtask(
  id: string,
  patch: { title?: string; done?: boolean },
): Promise<Subtask> {
  return request<Subtask>(`/subtasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteSubtask(id: string): Promise<void> {
  await fetch(`${BASE_URL}/subtasks/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}

// ---- Calendar & Today -----------------------------------------------------------

export async function getCalendar(
  date?: string,
): Promise<{ events: CalendarEventInfo[]; connected: boolean }> {
  return request(`/calendar${date ? `?date=${date}` : ""}`);
}

export async function planToday(): Promise<PlanBlock[]> {
  const res = await request<{ blocks: PlanBlock[] }>("/today/plan", { method: "POST" });
  return res.blocks;
}

// Local-mode day planning: fetch the server-built prompt, run it locally, post back.
export async function getPlanRequest(): Promise<{ prompt: string }> {
  return request("/today/plan-request");
}

export async function postPlanResult(raw: unknown): Promise<PlanBlock[]> {
  const res = await request<{ blocks: PlanBlock[] }>("/today/plan-result", {
    method: "POST",
    body: JSON.stringify(raw),
  });
  return res.blocks;
}

// ---- Ask Focus (assistant) -----------------------------------------------------

export async function askFocus(
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const res = await request<{ reply: string }>("/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
  return res.reply;
}

// ---- Routines -------------------------------------------------------------------

export async function listRoutines(): Promise<Routine[]> {
  const res = await request<{ routines: Routine[] }>("/routines");
  return res.routines;
}

export async function createRoutine(body: {
  title: string;
  sphere: string;
  priority?: string;
  cadence: string;
  interval?: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
}): Promise<Routine> {
  return request<Routine>("/routines", { method: "POST", body: JSON.stringify(body) });
}

export async function updateRoutine(
  id: string,
  patch: Partial<{ active: boolean; title: string; priority: string; sphere: string }>,
): Promise<Routine> {
  return request<Routine>(`/routines/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteRoutine(id: string): Promise<void> {
  await fetch(`${BASE_URL}/routines/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}

// ---- Slack daily digest ---------------------------------------------------------

export async function getSlackDigest(): Promise<{
  digest: SlackDigestInfo | null;
  excludedChannels: string[];
  lastError: string | null;
}> {
  return request("/slack/digest");
}

export async function listSlackChannels(): Promise<{ id: string; name: string }[]> {
  const res = await request<{ channels: { id: string; name: string }[] }>("/slack/channels");
  return res.channels;
}

export async function refreshSlackDigest(force: boolean): Promise<void> {
  await request("/slack/digest/refresh", { method: "POST", body: JSON.stringify({ force }) });
}

export async function saveSlackDigestSettings(excludedChannels: string[]): Promise<void> {
  await request("/slack/digest/settings", {
    method: "PUT",
    body: JSON.stringify({ excludedChannels }),
  });
}

// ---- Intelligence ---------------------------------------------------------------

export async function listMemory(): Promise<{
  records: MemoryRecordInfo[];
  preferences: SpherePreferences;
}> {
  return request("/memory");
}

export async function addMemoryRecord(
  kind: MemoryRecordInfo["kind"],
  content: string,
): Promise<MemoryRecordInfo> {
  return request<MemoryRecordInfo>("/memory", {
    method: "POST",
    body: JSON.stringify({ kind, content }),
  });
}

export async function savePreferences(preferences: SpherePreferences): Promise<void> {
  await request("/memory/preferences", { method: "PUT", body: JSON.stringify(preferences) });
}

export async function editMemoryRecord(id: string, content: string): Promise<MemoryRecordInfo> {
  return request<MemoryRecordInfo>(`/memory/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export async function deleteMemoryRecord(id: string): Promise<void> {
  await fetch(`${BASE_URL}/memory/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}
