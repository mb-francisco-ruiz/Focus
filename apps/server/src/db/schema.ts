import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Postgres schema (PLAN.md §4). ULIDs as text PKs — sortable, client-generatable
 * for offline capture. Every AI-settable field carries an `*Overridden` flag:
 * once true, re-enrichment must never write that field again.
 */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** Sign-in identity (DB auth since 2026-07-06). */
  username: text("username").unique(),
  /** scrypt hash, `salt.hash` hex. */
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  /** FileStorage key of the profile picture (attachment id / S3 key later). */
  avatarKey: text("avatar_key"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  /** User-defined task categories, in display order. */
  spheres: jsonb("spheres").$type<string[]>().notNull().default(["work", "personal"]),
  /** Behaviour instructions per sphere, injected into AI prompts. */
  preferences: jsonb("preferences")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  /** Per-user Gemini API key, AES-256-GCM encrypted (lib/crypto). Overrides the
   *  global GOOGLE_GENERATIVE_AI_API_KEY env fallback for this user's AI calls. */
  aiApiKey: text("ai_api_key"),
  /** Where this user's foreground AI runs: "server" (API) or "local" (their
   *  desktop's Claude Code via the sidecar). Server enrich routing honors it. */
  aiMode: text("ai_mode", { enum: ["server", "local"] }).notNull().default("server"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** OAuth connections: google (gmail+calendar) and slack. N per user. */
export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    provider: text("provider", { enum: ["google", "slack"] }).notNull(),
    /** Provider-side identity (email for google, team+user id for slack). */
    externalId: text("external_id").notNull(),
    /** Encrypted OAuth tokens + scopes. */
    credentials: jsonb("credentials").notNull(),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("integration_accounts_user_idx").on(t.userId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    rawInput: text("raw_input").notNull(),
    title: text("title").notNull(),
    titleOverridden: boolean("title_overridden").notNull().default(false),
    /** Free-form category from the user's spheres list. */
    sphere: text("sphere").notNull().default("personal"),
    sphereOverridden: boolean("sphere_overridden").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status", { enum: ["inbox", "active", "waiting", "done", "archived"] })
      .notNull()
      .default("inbox"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueAtOverridden: boolean("due_at_overridden").notNull().default(false),
    priority: text("priority", { enum: ["P1", "P2", "P3"] }).notNull().default("P2"),
    priorityScore: integer("priority_score").notNull().default(50),
    priorityOverridden: boolean("priority_overridden").notNull().default(false),
    /** User-flagged blocked — sorts below same-priority peers, purple tag. */
    blocked: boolean("blocked").notNull().default(false),
    /** Raw 0-100 importance from enrichment; input to the priority engine,
     *  kept separate from priorityScore so recomputes never compound. */
    aiImportance: integer("ai_importance"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    aiSuggestion: text("ai_suggestion"),
    aiSuggestionDetail: jsonb("ai_suggestion_detail").$type<{
      what: string;
      why: string;
      when: string;
    } | null>(),
    /** Reminder dedup markers — cleared when dueAt changes. */
    dueSoonNotifiedAt: timestamp("due_soon_notified_at", { withTimezone: true }),
    overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
    /** Semantic embedding of title+rawInput (memory layer tier 2). */
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_user_due_idx").on(t.userId, t.dueAt),
  ],
);

/** Recurring task templates that spawn tasks on a cadence. */
export const routines = pgTable(
  "routines",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    sphere: text("sphere").notNull().default("personal"),
    priority: text("priority", { enum: ["P1", "P2", "P3"] }).notNull().default("P2"),
    cadence: text("cadence", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    interval: integer("interval").notNull().default(1),
    weekday: integer("weekday"),
    dayOfMonth: integer("day_of_month"),
    active: boolean("active").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastSpawnedAt: timestamp("last_spawned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("routines_user_idx").on(t.userId), index("routines_next_run_idx").on(t.nextRunAt)],
);

/** Optional checkable steps inside a task. */
export const subtasks = pgTable(
  "subtasks",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subtasks_task_idx").on(t.taskId)],
);

/** Append-only per-task activity: notes, images, linked emails/messages/events. */
export const contextItems = pgTable(
  "context_items",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    kind: text("kind", {
      enum: ["text", "image", "link", "email", "slack_message", "calendar_event"],
    }).notNull(),
    body: text("body"),
    attachmentKey: text("attachment_key"),
    sourceRef: jsonb("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("context_items_task_idx").on(t.taskId)],
);

/** Memory layer tier 1: append-only event log. Never updated, never deleted. */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    type: text("type").notNull(),
    entityId: text("entity_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_user_created_idx").on(t.userId, t.createdAt),
    index("events_entity_idx").on(t.entityId),
  ],
);

/** Memory layer tier 3: distilled facts/preferences/patterns with provenance. */
export const memoryRecords = pgTable(
  "memory_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["entity", "preference", "pattern", "outcome"] }).notNull(),
    /** Human-readable fact, e.g. "Coni = daughter; school tasks are family/P1". */
    content: text("content").notNull(),
    /** Event ids this record was derived from. */
    provenance: jsonb("provenance").$type<string[]>().notNull().default([]),
    embedding: vector("embedding", { dimensions: 768 }),
    /** User deleted it; also excluded from re-derivation. */
    suppressed: boolean("suppressed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memory_records_user_idx").on(t.userId)],
);

/** AI-suggested tasks from integrations, awaiting user review (PLAN.md §5.3). */
export const suggestions = pgTable(
  "suggestions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    source: text("source", { enum: ["gmail", "slack"] }).notNull(),
    accountId: text("account_id").notNull().references(() => integrationAccounts.id),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    excerpt: text("excerpt").notNull(),
    /** Provider-side pointer; also the dedup key per account. */
    sourceRef: jsonb("source_ref").notNull(),
    dedupKey: text("dedup_key").notNull(),
    status: text("status", { enum: ["pending", "accepted", "dismissed"] })
      .notNull()
      .default("pending"),
    taskId: text("task_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("suggestions_user_status_idx").on(t.userId, t.status),
    uniqueIndex("suggestions_dedup_idx").on(t.accountId, t.dedupKey),
  ],
);

/**
 * Dropped images/files. Bytea keeps Phase 1 infra-free; context_items reference
 * rows here via attachmentKey. Moves to object storage (R2) in Phase 2 —
 * attachmentKey becomes the R2 key, the GET route contract stays identical.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_user_idx").on(t.userId)],
);

/** One AI-written Slack summary per user per local day (PLAN.md §5.4). */
export const slackDigests = pgTable(
  "slack_digests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    /** yyyy-mm-dd in the user's timezone. */
    date: text("date").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("slack_digests_user_date_idx").on(t.userId, t.date)],
);

/** Registered clients, for push routing (desktop now, FCM later). */
export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    platform: text("platform", { enum: ["macos", "windows", "android"] }).notNull(),
    name: text("name"),
    pushToken: text("push_token"),
    appVersion: text("app_version"),
    osVersion: text("os_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);
