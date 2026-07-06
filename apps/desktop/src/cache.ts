import type { Task } from "@focus/shared";
import { createTask } from "./api";
import { isTauri } from "./tauri-env";

/**
 * Local cache (PLAN.md §7): task snapshot for instant open + offline capture
 * queue replayed on reconnect. Tauri store on desktop, localStorage in a
 * plain browser (dev). JSON is enough at Phase 1 volume; the interface stays
 * if we swap to SQLite.
 */

interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

async function makeStore(): Promise<KV> {
  if (isTauri) {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    return new LazyStore("focus-cache.json");
  }
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = localStorage.getItem(`focus.cache.${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      localStorage.setItem(`focus.cache.${key}`, JSON.stringify(value));
    },
  };
}

const store = makeStore();

export interface PendingCapture {
  clientId: string;
  rawInput: string;
  capturedAt: string;
}

export async function loadCachedTasks(): Promise<Task[]> {
  return (await (await store).get<Task[]>("tasks")) ?? [];
}

export async function saveCachedTasks(tasks: Task[]): Promise<void> {
  await (await store).set("tasks", tasks);
}

export async function queueCapture(capture: PendingCapture): Promise<void> {
  const kv = await store;
  const pending = (await kv.get<PendingCapture[]>("pendingCaptures")) ?? [];
  pending.push(capture);
  await kv.set("pendingCaptures", pending);
}

/** Replay queued captures; clientId makes retries idempotent server-side. */
export async function replayPendingCaptures(): Promise<Task[]> {
  const kv = await store;
  const pending = (await kv.get<PendingCapture[]>("pendingCaptures")) ?? [];
  const created: Task[] = [];
  const stillPending: PendingCapture[] = [];
  for (const capture of pending) {
    try {
      created.push(await createTask(capture.rawInput, capture.clientId));
    } catch {
      stillPending.push(capture);
    }
  }
  await kv.set("pendingCaptures", stillPending);
  return created;
}
