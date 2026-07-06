import { z } from "zod";

// ---- Enums ----------------------------------------------------------------

export const Sphere = z.enum(["work", "personal", "family", "other"]);
export type Sphere = z.infer<typeof Sphere>;

export const TaskStatus = z.enum(["inbox", "active", "waiting", "done", "archived"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** P0 = drop everything … P3 = someday. */
export const PriorityBucket = z.enum(["P0", "P1", "P2", "P3"]);
export type PriorityBucket = z.infer<typeof PriorityBucket>;

export const ContextItemKind = z.enum(["text", "image", "link", "email", "slack_message", "calendar_event"]);
export type ContextItemKind = z.infer<typeof ContextItemKind>;

// ---- Task -----------------------------------------------------------------

export const Task = z.object({
  id: z.string(),
  userId: z.string(),
  /** Original natural-language input. Never modified by AI. */
  rawInput: z.string(),
  title: z.string(),
  sphere: Sphere,
  /** True once the user has manually set sphere; enrichment must not touch it. */
  sphereOverridden: z.boolean(),
  tags: z.array(z.string()),
  status: TaskStatus,
  dueAt: z.iso.datetime().nullable(),
  dueAtOverridden: z.boolean(),
  priority: PriorityBucket,
  priorityScore: z.number().min(0).max(100),
  priorityOverridden: z.boolean(),
  /** Set when AI enrichment has completed at least once. */
  enrichedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Task = z.infer<typeof Task>;

export const ContextItem = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: ContextItemKind,
  /** Text content, or caption for attachments/links. */
  body: z.string().nullable(),
  /** Object-storage key for images/files. */
  attachmentKey: z.string().nullable(),
  /** Source reference for integration items (slack ts, gmail message id…). */
  sourceRef: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type ContextItem = z.infer<typeof ContextItem>;

// ---- Events (memory layer, tier 1) ----------------------------------------

export const EventType = z.enum([
  "task.captured",
  "task.enriched",
  "task.updated",
  "task.completed",
  "task.status_changed",
  "task.priority_overridden",
  "task.sphere_overridden",
  "task.due_overridden",
  "context.added",
  "suggestion.created",
  "suggestion.accepted",
  "suggestion.dismissed",
  "reminder.fired",
]);
export type EventType = z.infer<typeof EventType>;

export const Event = z.object({
  id: z.string(),
  userId: z.string(),
  type: EventType,
  /** Entity the event is about (usually a task id). */
  entityId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type Event = z.infer<typeof Event>;

// ---- AI enrichment contract ------------------------------------------------

/** Structured output the classify/enrich capability must return. */
export const Enrichment = z.object({
  title: z.string().describe("Short imperative title for the task"),
  sphere: Sphere,
  tags: z.array(z.string()).max(5),
  dueAt: z.iso.datetime().nullable().describe("Inferred due date, null if none"),
  priority: PriorityBucket,
  priorityScore: z.number().min(0).max(100),
  reasoning: z.string().describe("One sentence on why this priority"),
});
export type Enrichment = z.infer<typeof Enrichment>;
