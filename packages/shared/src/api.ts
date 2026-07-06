import { z } from "zod";
import { Task, PriorityBucket, Sphere, TaskStatus } from "./domain.js";

// ---- Auth -----------------------------------------------------------------

export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AuthResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

// ---- Tasks ----------------------------------------------------------------

export const CreateTaskRequest = z.object({
  /** Natural-language input; everything else is derived. */
  rawInput: z.string().min(1).max(4000),
  /**
   * Client-generated ULID for offline capture: replaying the same capture is
   * idempotent — the server returns the existing task instead of duplicating.
   */
  clientId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = z.object({
  title: z.string().min(1).optional(),
  sphere: Sphere.optional(),
  status: TaskStatus.optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  priority: PriorityBucket.optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

export const TaskListResponse = z.object({
  tasks: z.array(Task),
});
export type TaskListResponse = z.infer<typeof TaskListResponse>;

// ---- Context items ----------------------------------------------------------

export const AddContextRequest = z.object({
  kind: z.enum(["text", "link"]),
  body: z.string().min(1).max(8000),
});
export type AddContextRequest = z.infer<typeof AddContextRequest>;

// ---- WebSocket sync ---------------------------------------------------------

/** Deltas pushed over /ws; clients apply them to their local cache. */
export type SyncMessage =
  | { type: "task.upserted"; task: Task }
  | { type: "task.deleted"; id: string }
  | { type: "context.added"; taskId: string };
