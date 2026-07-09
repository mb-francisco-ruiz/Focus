import { z } from "zod";
import {
  Cadence,
  ContextItem,
  PriorityBucket,
  Routine,
  Sphere,
  Subtask,
  Suggestion,
  Task,
  TaskStatus,
} from "./domain.js";

// ---- Auth -----------------------------------------------------------------

export const LoginRequest = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Same shape — registration is intentionally validation-free (internal tool). */
export const RegisterRequest = LoginRequest;
export type RegisterRequest = LoginRequest;

export const UserProfile = z.object({
  id: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarKey: z.string().nullable(),
  spheres: z.array(z.string()),
  /** Whether the user has set their own Gemini API key (the key is never returned). */
  hasAiKey: z.boolean(),
  /** Where foreground AI runs: "server" (API) or "local" (desktop Claude Code). */
  aiMode: z.enum(["server", "local"]),
  /** integration_accounts.id (google) that task→calendar sync writes into. */
  calendarAccountId: z.string().nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const SetCalendarAccountRequest = z.object({ accountId: z.string().nullable() });
export type SetCalendarAccountRequest = z.infer<typeof SetCalendarAccountRequest>;

export const SetAiKeyRequest = z.object({ apiKey: z.string().min(10).max(200) });
export type SetAiKeyRequest = z.infer<typeof SetAiKeyRequest>;

export const SetAiModeRequest = z.object({ mode: z.enum(["server", "local"]) });
export type SetAiModeRequest = z.infer<typeof SetAiModeRequest>;

export const UpdateSpheresResponse = UserProfile.extend({
  reassigned: z.number().int().min(0),
});
export type UpdateSpheresResponse = z.infer<typeof UpdateSpheresResponse>;

export const UpdateSpheresRequest = z.object({
  spheres: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .min(1)
    .max(8),
});
export type UpdateSpheresRequest = z.infer<typeof UpdateSpheresRequest>;

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
  dueHasTime: z.boolean().optional(),
  priority: PriorityBucket.optional(),
  tags: z.array(z.string()).optional(),
  blocked: z.boolean().optional(),
  calendarSync: z.boolean().optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

export const TaskListResponse = z.object({
  tasks: z.array(Task),
});
export type TaskListResponse = z.infer<typeof TaskListResponse>;

// ---- Sync backfill ---------------------------------------------------------

export const SyncResponse = z.object({
  tasks: z.array(Task),
  /** Pending integration suggestions; Android v1 only needs count + refresh trigger. */
  suggestionCount: z.number().int().min(0),
  /** Timestamp cursor to pass as `since` on the next sync. */
  nextCursor: z.iso.datetime(),
});
export type SyncResponse = z.infer<typeof SyncResponse>;

// ---- Context items ----------------------------------------------------------

export const AddContextRequest = z.object({
  kind: z.enum(["text", "link"]),
  body: z.string().min(1).max(8000),
});
export type AddContextRequest = z.infer<typeof AddContextRequest>;

export const ContextListResponse = z.object({
  items: z.array(ContextItem),
});
export type ContextListResponse = z.infer<typeof ContextListResponse>;

// ---- WebSocket sync ---------------------------------------------------------

/** Deltas pushed over /ws; clients apply them to their local cache. */
export type SyncMessage =
  | { type: "task.upserted"; task: Task }
  | { type: "task.deleted"; id: string }
  | { type: "context.added"; taskId: string }
  | { type: "suggestion.changed" }
  // Carries the suggestion so the client can pop a review toast without a fetch.
  | { type: "suggestion.new"; suggestion: Suggestion }
  | { type: "notification"; title: string; body: string; taskId?: string };

// ---- Subtasks -----------------------------------------------------------------

export const CreateSubtaskRequest = z.object({
  title: z.string().min(1).max(500),
});
export type CreateSubtaskRequest = z.infer<typeof CreateSubtaskRequest>;

export const UpdateSubtaskRequest = z.object({
  title: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
});
export type UpdateSubtaskRequest = z.infer<typeof UpdateSubtaskRequest>;

export const SubtaskListResponse = z.object({
  subtasks: z.array(Subtask),
});
export type SubtaskListResponse = z.infer<typeof SubtaskListResponse>;

// ---- Routines -----------------------------------------------------------------

export const CreateRoutineRequest = z.object({
  title: z.string().min(1).max(500),
  sphere: Sphere,
  priority: PriorityBucket.default("P2"),
  cadence: Cadence,
  interval: z.number().int().min(1).max(52).default(1),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
});
export type CreateRoutineRequest = z.infer<typeof CreateRoutineRequest>;

export const UpdateRoutineRequest = z.object({
  title: z.string().min(1).max(500).optional(),
  sphere: Sphere.optional(),
  priority: PriorityBucket.optional(),
  cadence: Cadence.optional(),
  interval: z.number().int().min(1).max(52).optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateRoutineRequest = z.infer<typeof UpdateRoutineRequest>;

export const RoutineListResponse = z.object({ routines: z.array(Routine) });
export type RoutineListResponse = z.infer<typeof RoutineListResponse>;

// ---- Intelligence (memory + behaviour) -----------------------------------------

export const MemoryRecordInfo = z.object({
  id: z.string(),
  kind: z.enum(["entity", "preference", "pattern", "outcome"]),
  content: z.string(),
  createdAt: z.iso.datetime(),
});
export type MemoryRecordInfo = z.infer<typeof MemoryRecordInfo>;

/** Free-text behaviour instructions keyed by sphere, injected into AI prompts. */
export const SpherePreferences = z.record(z.string(), z.string().max(2000));
export type SpherePreferences = z.infer<typeof SpherePreferences>;

export const AddMemoryRecordRequest = z.object({
  kind: z.enum(["entity", "preference", "pattern", "outcome"]),
  content: z.string().min(1).max(500),
});
export type AddMemoryRecordRequest = z.infer<typeof AddMemoryRecordRequest>;

export const MemoryResponse = z.object({
  records: z.array(MemoryRecordInfo),
  preferences: SpherePreferences,
});
export type MemoryResponse = z.infer<typeof MemoryResponse>;

export const PreferencesResponse = z.object({
  preferences: SpherePreferences,
});
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

// ---- Integrations -----------------------------------------------------------

export const IntegrationAccountInfo = z.object({
  id: z.string(),
  provider: z.enum(["google", "slack"]),
  externalId: z.string(),
  /** Category this account's email/messages get filed under (null = unassigned). */
  sphere: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type IntegrationAccountInfo = z.infer<typeof IntegrationAccountInfo>;

export const IntegrationListResponse = z.object({
  accounts: z.array(IntegrationAccountInfo),
  googleConfigured: z.boolean(),
  slackConfigured: z.boolean(),
});
export type IntegrationListResponse = z.infer<typeof IntegrationListResponse>;

/** Link (or unlink, with null) a connected account to a task category. */
export const UpdateIntegrationRequest = z.object({
  sphere: z.string().min(1).max(40).nullable(),
});
export type UpdateIntegrationRequest = z.infer<typeof UpdateIntegrationRequest>;

export const UpdateIntegrationResponse = z.object({
  id: z.string(),
  sphere: z.string().nullable(),
});
export type UpdateIntegrationResponse = z.infer<typeof UpdateIntegrationResponse>;

// ---- Suggestions ------------------------------------------------------------

export const SuggestionListResponse = z.object({
  suggestions: z.array(Suggestion),
});
export type SuggestionListResponse = z.infer<typeof SuggestionListResponse>;

export const QueuedResponse = z.object({
  queued: z.boolean(),
});
export type QueuedResponse = z.infer<typeof QueuedResponse>;

// ---- Slack daily digest ------------------------------------------------------

/** A summarized point, optionally linked to the Slack thread it came from. */
export const SlackDigestPoint = z.object({
  text: z.string(),
  url: z.string().nullable(),
});
export type SlackDigestPoint = z.infer<typeof SlackDigestPoint>;

export const SlackDigestSection = z.object({
  channel: z.string(),
  points: z.array(SlackDigestPoint),
});
export type SlackDigestSection = z.infer<typeof SlackDigestSection>;

export const SlackDigestInfo = z.object({
  /** yyyy-mm-dd in the user's timezone. */
  date: z.string(),
  summary: z.string(),
  sections: z.array(SlackDigestSection),
  createdAt: z.iso.datetime(),
});
export type SlackDigestInfo = z.infer<typeof SlackDigestInfo>;

export const SlackDigestResponse = z.object({
  digest: SlackDigestInfo.nullable(),
  excludedChannels: z.array(z.string()),
  lastError: z.string().nullable().optional(),
});
export type SlackDigestResponse = z.infer<typeof SlackDigestResponse>;

export const SlackChannelInfo = z.object({
  id: z.string(),
  name: z.string(),
});
export type SlackChannelInfo = z.infer<typeof SlackChannelInfo>;

export const SlackChannelsResponse = z.object({
  channels: z.array(SlackChannelInfo),
});
export type SlackChannelsResponse = z.infer<typeof SlackChannelsResponse>;

export const SlackDigestSettingsRequest = z.object({
  excludedChannels: z.array(z.string().min(1).max(80)).max(100),
});
export type SlackDigestSettingsRequest = z.infer<typeof SlackDigestSettingsRequest>;

export const SlackDigestSettingsResponse = z.object({
  excludedChannels: z.array(z.string()),
});
export type SlackDigestSettingsResponse = z.infer<typeof SlackDigestSettingsResponse>;

// ---- Calendar & Today --------------------------------------------------------

export const CalendarEventInfo = z.object({
  id: z.string(),
  title: z.string(),
  start: z.iso.datetime(),
  end: z.string(),
  allDay: z.boolean(),
  account: z.string(),
});
export type CalendarEventInfo = z.infer<typeof CalendarEventInfo>;

export const CalendarResponse = z.object({
  events: z.array(CalendarEventInfo),
  /** False when no Google account is connected (client shows a hint). */
  connected: z.boolean(),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;

/** An AI-proposed focus block scheduling a task into a free slot. */
export const PlanBlock = z.object({
  taskId: z.string().nullable(),
  title: z.string(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  reason: z.string(),
});
export type PlanBlock = z.infer<typeof PlanBlock>;

export const TodayPlanResponse = z.object({ blocks: z.array(PlanBlock) });
export type TodayPlanResponse = z.infer<typeof TodayPlanResponse>;

// ---- Devices ---------------------------------------------------------------

export const DevicePlatform = z.enum(["macos", "windows", "android"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const RegisterDeviceRequest = z.object({
  id: z.string().min(1).optional(),
  platform: DevicePlatform,
  name: z.string().min(1).max(120).nullable().optional(),
  pushToken: z.string().min(1).nullable().optional(),
  appVersion: z.string().min(1).max(80).nullable().optional(),
  osVersion: z.string().min(1).max(80).nullable().optional(),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;

export const DeviceInfo = z.object({
  id: z.string(),
  platform: DevicePlatform,
  name: z.string().nullable(),
  pushToken: z.string().nullable(),
  appVersion: z.string().nullable(),
  osVersion: z.string().nullable(),
  lastSeenAt: z.iso.datetime(),
  disabledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;
