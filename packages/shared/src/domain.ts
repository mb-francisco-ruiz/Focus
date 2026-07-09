import { z } from "zod";

// ---- Enums ----------------------------------------------------------------

/** Free-form category name from the user's spheres list (defaults: work, personal). */
export const Sphere = z.string().min(1).max(40);
export type Sphere = z.infer<typeof Sphere>;

export const TaskStatus = z.enum(["inbox", "active", "waiting", "done", "archived"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** P1 = high … P3 = low. (P0 retired 2026-07-06; rows migrated to P1.) */
export const PriorityBucket = z.enum(["P1", "P2", "P3"]);
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
  /** True once the user edited the title; enrichment must not rewrite it. */
  titleOverridden: z.boolean(),
  sphere: Sphere,
  /** True once the user has manually set sphere; enrichment must not touch it. */
  sphereOverridden: z.boolean(),
  tags: z.array(z.string()),
  status: TaskStatus,
  dueAt: z.iso.datetime().nullable(),
  dueAtOverridden: z.boolean(),
  /** Whether dueAt's clock time is meaningful (timed) vs a date-only due. */
  dueHasTime: z.boolean(),
  /** User opted this task in to mirror onto Google Calendar. */
  calendarSync: z.boolean(),
  priority: PriorityBucket,
  priorityScore: z.number().min(0).max(100),
  priorityOverridden: z.boolean(),
  /** User-flagged blocked; sorts below same-priority peers. */
  blocked: z.boolean(),
  /** Set when AI enrichment has completed at least once. */
  enrichedAt: z.iso.datetime().nullable(),
  /** Short AI-suggested next step, refreshed on (re-)enrichment. */
  aiSuggestion: z.string().nullable(),
  /** Expanded suggestion (what / why / when), shown on click. */
  aiSuggestionDetail: z
    .object({ what: z.string(), why: z.string(), when: z.string() })
    .nullable(),
  subtaskCount: z.number(),
  subtaskDone: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// ---- Routines (recurring tasks) --------------------------------------------

export const Cadence = z.enum(["daily", "weekly", "monthly"]);
export type Cadence = z.infer<typeof Cadence>;

export const Routine = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  sphere: Sphere,
  priority: PriorityBucket,
  cadence: Cadence,
  /** Every N days/weeks/months. */
  interval: z.number().int().min(1).max(52),
  /** 0–6 (Mon–Sun) for weekly; null otherwise. */
  weekday: z.number().int().min(0).max(6).nullable(),
  /** 1–31 for monthly; null otherwise. */
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  active: z.boolean(),
  nextRunAt: z.iso.datetime(),
  lastSpawnedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Routine = z.infer<typeof Routine>;

export const Subtask = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  done: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Subtask = z.infer<typeof Subtask>;
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
  "subtask.added",
  "subtask.completed",
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

// ---- Suggestions (review queue, PLAN.md §5.3) -------------------------------

export const SuggestionSource = z.enum(["gmail", "slack"]);
export type SuggestionSource = z.infer<typeof SuggestionSource>;

export const Suggestion = z.object({
  id: z.string(),
  userId: z.string(),
  source: SuggestionSource,
  /** integration_accounts row this came from. */
  accountId: z.string(),
  title: z.string(),
  /** Why the AI thinks this is a task (shown in the review queue). */
  reason: z.string(),
  /** Excerpt of the source content (email snippet, message text). */
  excerpt: z.string(),
  /** Provider-side pointer (gmail message id, slack ts…). */
  sourceRef: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "accepted", "dismissed"]),
  /** Task created on accept. */
  taskId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Suggestion = z.infer<typeof Suggestion>;

// ---- AI enrichment contract ------------------------------------------------

/** Structured output the classify/enrich capability must return. */
export const Enrichment = z.object({
  title: z.string().describe("Short imperative title for the task"),
  sphere: Sphere,
  tags: z.array(z.string()).max(5),
  // offset:true — the enrich prompt asks for a local UTC offset (not "Z") so
  // "end of day" lands on the right calendar day; the schema must accept it.
  dueAt: z.iso.datetime({ offset: true }).nullable().describe("Inferred due date, null if none"),
  priority: PriorityBucket,
  priorityScore: z.number().min(0).max(100),
  reasoning: z.string().describe("One sentence on why this priority"),
  // nextStep suggestions removed 2026-07-06 (user: not useful yet).
  // Task.aiSuggestion* fields remain in the schema for old rows; always null now.
});

/** Structured output for the distill capability (events → memory records). */
export const Distillation = z.object({
  records: z
    .array(
      z.object({
        kind: z.enum(["entity", "preference", "pattern", "outcome"]),
        content: z
          .string()
          .describe("One human-readable fact, e.g. 'Emails from newsletters@x are never tasks'"),
      }),
    )
    .max(10),
});
export type Distillation = z.infer<typeof Distillation>;

/** Structured output for the suggest capability (is this email/message a task?). */
export const SuggestionVerdict = z.object({
  isTask: z.boolean().describe("True only if there is a concrete action for the user"),
  title: z.string().describe("Short imperative task title, empty string if isTask is false"),
  reason: z.string().describe("One sentence on why this needs the user's action"),
  confidence: z.number().min(0).max(1),
});
export type SuggestionVerdict = z.infer<typeof SuggestionVerdict>;
export type Enrichment = z.infer<typeof Enrichment>;
