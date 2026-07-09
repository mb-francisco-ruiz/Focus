import type { PlanBlock } from "@focus/shared";
import {
  getAuthToken,
  getBaseUrl,
  getEnrichRequest,
  getPlanRequest,
  postEnrichResult,
  postPlanResult,
} from "./api";
import { isTauri } from "./tauri-env";

/**
 * Client side of local AI execution. Talks to the Tauri host (which owns the
 * Claude Code sidecar process) to get its loopback endpoint, then calls the
 * sidecar over HTTP. All calls are best-effort: callers fall back to the server
 * API when local execution is unavailable or errors.
 */

interface Endpoint {
  port: number;
  token: string;
}

export interface LocalHealth {
  ok: boolean;
  claudeVersion: string | null;
  loggedIn: boolean;
}

let cached: Endpoint | null = null;

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

/** Ensure the sidecar is running; returns its endpoint (or null if unavailable). */
export async function startLocalAi(): Promise<Endpoint | null> {
  if (!isTauri) return null;
  try {
    cached = await invoke<Endpoint>("start_local_ai");
  } catch {
    cached = null;
  }
  return cached;
}

export async function stopLocalAi(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("stop_local_ai");
  } catch {
    /* ignore */
  }
  cached = null;
}

async function endpoint(): Promise<Endpoint | null> {
  if (!isTauri) return null;
  if (cached) return cached;
  try {
    cached = await invoke<Endpoint | null>("local_ai_endpoint");
  } catch {
    cached = null;
  }
  return cached ?? (await startLocalAi());
}

async function sidecar<T>(path: string, body?: unknown): Promise<T> {
  const ep = await endpoint();
  if (!ep) throw new Error("local AI unavailable");
  const res = await fetch(`http://127.0.0.1:${ep.port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${ep.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`sidecar ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** Sidecar liveness + whether Claude Code is installed/logged in on this machine. */
export async function localHealth(): Promise<LocalHealth | null> {
  try {
    return await sidecar<LocalHealth>("/health");
  } catch {
    return null;
  }
}

export async function localAiReady(): Promise<boolean> {
  const h = await localHealth();
  return Boolean(h?.ok);
}

/** Detailed detection for the Settings "Test" button — reports why it's not ready. */
export async function probeLocalAi(): Promise<{ ok: boolean; detail: string }> {
  if (!isTauri) return { ok: false, detail: "Desktop app only" };
  try {
    cached = await invoke<Endpoint>("start_local_ai");
  } catch (e) {
    return { ok: false, detail: `Sidecar didn't start: ${String(e)}` };
  }
  const h = await localHealth();
  if (!h) return { ok: false, detail: "Sidecar not responding" };
  if (!h.ok) return { ok: false, detail: "Claude Code not found on PATH — run `claude login`" };
  return { ok: true, detail: `Ready — ${h.claudeVersion}` };
}

/** Mirror of the server /chat system prompt so local replies behave the same. */
export function focusSystemPrompt(spheres: string[], timezone?: string): string {
  const now = new Date().toLocaleString("sv-SE", timezone ? { timeZone: timezone } : undefined);
  return `You are Focus, the user's personal work-and-life assistant. Today is ${now} (their timezone).
Their task categories are: ${spheres.join(", ")}.
Use the tools to read and manage their tasks, routines and memory — always act via tools rather than guessing.
If the user asks you to DO something on their computer (open apps, browse the web, click, type on their Mac), call control_computer with a clear task description — a live view will show it working.
Be concise and practical. Reply in the user's language. When you change something, confirm briefly what you did.`;
}

/** Run Ask Focus locally; tools call the Focus API with the user's token. */
export async function localAssistant(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const { reply } = await sidecar<{ reply: string }>("/assistant", {
    system,
    messages,
    focusBaseUrl: getBaseUrl(),
    jwt: getAuthToken(),
  });
  return reply;
}

/** One-shot structured generation (returns raw text; caller validates). */
export async function localStructured(prompt: string): Promise<string> {
  const { text } = await sidecar<{ text: string }>("/structured", { prompt });
  return text;
}

// ---- Computer control ------------------------------------------------------

export interface ControlStep {
  action: string;
  args: Record<string, unknown>;
  at: number;
}
export interface ControlStatus {
  running: boolean;
  task: string | null;
  done: boolean;
  result: string | null;
  error: string | null;
  steps: ControlStep[];
  shots: string[]; // data: URLs, one per display
}

export async function startControl(task: string): Promise<void> {
  await sidecar("/control", { task });
}
export async function controlStatus(): Promise<ControlStatus> {
  return sidecar<ControlStatus>("/control/status");
}
export async function stopControl(): Promise<void> {
  await sidecar("/control/stop", {});
}

// ---- MCP one-click setup ---------------------------------------------------

export interface McpSetup {
  built: boolean;
  claudeCode: string;
  claudeDesktop: string;
  dist: string;
}

/** Build the Focus MCP server and register it with Claude Code + Desktop, wired
 *  to this account (via the current token). Returns a per-target status report. */
export async function setupMcp(): Promise<McpSetup> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<McpSetup>("setup_mcp", { token: getAuthToken(), apiUrl: getBaseUrl() });
}

export interface McpStatus {
  registered: boolean;
  connected: boolean;
  detail: string;
}

/** Live check of whether the Focus MCP server is registered/connected in Claude Code. */
export async function mcpStatus(): Promise<McpStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<McpStatus>("mcp_status");
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences/prose). */
function extractJson(text: string): unknown | null {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Run enrichment for a task on the local Claude Code: fetch the server-built
 * prompt, execute it, post the JSON back for the server to validate + apply.
 * Throws if local AI is unavailable — callers ignore it and let the server's
 * delayed safety-net job enrich instead.
 */
export async function enrichLocally(taskId: string): Promise<void> {
  const { prompt } = await getEnrichRequest(taskId);
  const enrichment = extractJson(await localStructured(prompt));
  if (!enrichment) throw new Error("no JSON from local model");
  await postEnrichResult(taskId, enrichment);
}

/**
 * Plan the day on the local Claude Code: fetch the server-built prompt, execute
 * it, post the JSON back for the server to validate + filter. Throws if local
 * AI is unavailable — callers fall back to the server planToday().
 */
export async function planLocally(): Promise<PlanBlock[]> {
  const { prompt } = await getPlanRequest();
  const raw = extractJson(await localStructured(prompt));
  if (!raw) throw new Error("no JSON from local model");
  return postPlanResult(raw);
}

/**
 * Cross-window claim so only one webview (main or mini) enriches a given task —
 * localStorage is shared across Tauri windows. Released on failure so a retry or
 * the server safety-net still runs.
 */
export function claimLocalEnrich(taskId: string): boolean {
  const key = `focus.enriching.${taskId}`;
  const prev = Number(localStorage.getItem(key) ?? 0);
  if (Date.now() - prev < 120_000) return false;
  localStorage.setItem(key, String(Date.now()));
  return true;
}
function releaseLocalEnrich(taskId: string): void {
  localStorage.removeItem(`focus.enriching.${taskId}`);
}

/**
 * Fire local enrichment for a freshly-arrived task if it's in local mode, still
 * open, un-enriched, and not already claimed by another window. Best-effort:
 * failures fall through to the server's delayed safety-net job.
 */
export function localEnrichTask(
  task: { id: string; enrichedAt: string | null; status: string },
  aiMode: "server" | "local",
): void {
  if (aiMode !== "local") return;
  if (task.enrichedAt || !["inbox", "active", "waiting"].includes(task.status)) return;
  if (!claimLocalEnrich(task.id)) return;
  void enrichLocally(task.id).catch(() => releaseLocalEnrich(task.id));
}
