import { LazyStore } from "@tauri-apps/plugin-store";
import type { Task } from "@focus/shared";
import { createTask } from "./api";

/**
 * Local cache (PLAN.md §7): task snapshot for instant open + offline capture
 * queue replayed on reconnect. JSON store is enough at Phase 1 volume; the
 * interface stays if we swap to SQLite.
 */

const store = new LazyStore("focus-cache.json");

export interface PendingCapture {
  clientId: string;
  rawInput: string;
  capturedAt: string;
}

export async function loadCachedTasks(): Promise<Task[]> {
  return (await store.get<Task[]>("tasks")) ?? [];
}

export async function saveCachedTasks(tasks: Task[]): Promise<void> {
  await store.set("tasks", tasks);
}

export async function queueCapture(capture: PendingCapture): Promise<void> {
  const pending = (await store.get<PendingCapture[]>("pendingCaptures")) ?? [];
  pending.push(capture);
  await store.set("pendingCaptures", pending);
}

export async function pendingCaptures(): Promise<PendingCapture[]> {
  return (await store.get<PendingCapture[]>("pendingCaptures")) ?? [];
}

/** Replay queued captures; clientId makes retries idempotent server-side. */
export async function replayPendingCaptures(): Promise<Task[]> {
  const pending = await pendingCaptures();
  const created: Task[] = [];
  const stillPending: PendingCapture[] = [];
  for (const capture of pending) {
    try {
      created.push(await createTask(capture.rawInput, capture.clientId));
    } catch {
      stillPending.push(capture);
    }
  }
  await store.set("pendingCaptures", stillPending);
  return created;
}
