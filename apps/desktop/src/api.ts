import type {
  AuthResponse,
  ContextItem,
  Task,
  TaskListResponse,
  UpdateTaskRequest,
} from "@focus/shared";

const BASE_URL = import.meta.env.VITE_FOCUS_API_URL ?? "http://localhost:3001";

let token: string | null = localStorage.getItem("focus.token");

export function isLoggedIn(): boolean {
  return token !== null;
}

export function wsUrl(): string {
  const ws = BASE_URL.replace(/^http/, "ws");
  return `${ws}/ws?token=${encodeURIComponent(token ?? "")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return `${BASE_URL}/attachments/${attachmentKey}?token=${encodeURIComponent(token ?? "")}`;
}
