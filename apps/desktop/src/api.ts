import type {
  AuthResponse,
  ContextItem,
  IntegrationAccountInfo,
  MemoryRecordInfo,
  Suggestion,
  Task,
  TaskListResponse,
  UpdateTaskRequest,
} from "@focus/shared";

const BASE_URL = import.meta.env.VITE_FOCUS_API_URL ?? "http://localhost:3001";

let token: string | null = null;

/** Re-reads localStorage when unset: secondary windows (quick, mini) load at
 *  app start and must pick up a login that happened in the main window. */
function authToken(): string | null {
  if (!token) token = localStorage.getItem("focus.token");
  return token;
}

export function isLoggedIn(): boolean {
  return authToken() !== null;
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
  token = auth.token;
  localStorage.setItem("focus.token", auth.token);
  return auth;
}

export function logout(): void {
  token = null;
  localStorage.removeItem("focus.token");
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

// ---- Integrations -----------------------------------------------------------

export async function listIntegrations(): Promise<{
  accounts: IntegrationAccountInfo[];
  googleConfigured: boolean;
  slackConfigured: boolean;
}> {
  return request("/integrations");
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

// ---- Memory -------------------------------------------------------------------

export async function listMemory(): Promise<MemoryRecordInfo[]> {
  const res = await request<{ records: MemoryRecordInfo[] }>("/memory");
  return res.records;
}

export async function deleteMemoryRecord(id: string): Promise<void> {
  await fetch(`${BASE_URL}/memory/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken()}` },
  });
}
