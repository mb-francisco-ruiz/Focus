# Focus — Technical Reference & Android Handoff

_Last updated: 2026-07-07. Source of truth for API contracts is `packages/shared/src` (Zod schemas) and the live spec at `GET /openapi.json`. When this document and the code disagree, the code wins._

---

## 1. What Focus is

A personal productivity tool for capturing tasks in natural language and letting AI classify, prioritize and enrich them, with deep Slack/Gmail/Calendar integration, proactive reminders/digests, and a memory layer that learns the user's preferences over time. Internal tool, currently 2 users.

**One backend, thin clients.** All business logic (AI, priorities, integrations, reminders, memory) is server-side. Clients render state and stream deltas over WebSocket. The Android app is "just another client" — everything the desktop does flows through the same API documented here.

```
Desktop (Tauri/React, macOS+Win)      Android (Kotlin/Compose — this handoff)
        └──────── HTTPS REST + WebSocket ────────┘
                        │
        Focus API server (Fastify 5, TypeScript, Node 22)
        ├─ AI orchestrator (Gemini via Vercel AI SDK, capability-routed)
        ├─ Integration hub (Google OAuth, Slack app)
        ├─ Memory layer (event log → embeddings → distilled profile)
        └─ BullMQ workers (enrich, polls, reminders, digests, distill)
                        │
        PostgreSQL (+pgvector)   Redis (BullMQ)   [S3 planned for files]
```

### Environments

| | URL | Notes |
|---|---|---|
| Production | `https://<your-server>` (your own deploy) | e.g. Railway; deploy = `railway up --service server` from repo root (Dockerfile). See SETUP.md |
| Local dev | `http://localhost:3001` | `pnpm dev:server`; shares the **same Railway Postgres/Redis** as prod (see gotchas §14) |

### Repo layout

```
apps/server      Fastify API + BullMQ workers (single process)
apps/desktop     Tauri v2 + React client
apps/android     Kotlin + Compose client (in progress, other instance)
packages/shared  Zod schemas = API contract + OpenAPI generator
packages/ai      AI orchestrator, capability routing, prompts
```

---

## 2. Auth & accounts

- **Register**: `POST /auth/register` `{username, password}` → `201 {token, user}`. Open registration, no validation by design (internal). `409` if username taken.
- **Login**: `POST /auth/login` same body → `{token, user}`. `401` on bad credentials.
- Passwords are scrypt-hashed (`salt.hash` hex) server-side.
- **JWT**: signed HS256, payload `{sub: userId}`, **90-day expiry**. Send as `Authorization: Bearer <token>` on every call.
- **Query-token endpoints**: a few endpoints accept the same JWT as `?token=` because headers aren't available (WebSocket upgrade, `<img>` tags, browser OAuth entry): `/ws`, `GET /attachments/:id`, `GET /users/me/avatar`, `/integrations/google/connect`, `/integrations/slack/connect`.
- Everything a user owns hangs off `users.id` — one account, identical state on every client.

### Profile

- `GET /users/me` → `{id, username, displayName, avatarKey, spheres, hasAiKey}`. `hasAiKey` = the user set their own Gemini key (the key itself is never returned).
- `PUT /users/me/spheres` `{spheres: string[]}` (1–8, lowercased) — replaces the category list; **tasks in a removed category are reassigned to the first remaining one**; returns profile + `reassigned` count.
- `POST /users/me/avatar` — multipart image (≤4 MB) → updated profile. `GET /users/me/avatar?token=` streams it. Storage is behind a `FileStorage` interface (Postgres bytea today; S3 backend activates when `AWS_*` env vars are set — not yet implemented).
- `PUT /users/me/ai-key` `{apiKey}` / `DELETE /users/me/ai-key` — set or clear the user's **own Gemini API key** (AES-256-GCM encrypted at rest). Every AI call resolves the key per-user: their key if set, else the global `GOOGLE_GENERATIVE_AI_API_KEY` env fallback. Returns updated profile.
- `PUT /users/me/ai-mode` `{mode: "server"|"local"}` — where foreground AI runs. `local` = the desktop's Claude Code sidecar (user's subscription); `server` = the API. Reflected as `aiMode` in the profile. See **Local AI execution** below.

---

## 3. Domain model & conventions

All types in `packages/shared/src/domain.ts` / `api.ts`.

### Task

```
id            ULID (string PK — sortable, client-generatable)
rawInput      original natural-language capture — NEVER modified by AI
title         AI-written unless titleOverridden
sphere        one of the user's categories (free string; defaults work|personal)
status        inbox | active | waiting | done | archived
priority      P1 | P2 | P3   (displayed as High / Medium / Low)
priorityScore 0–100 (sort key within/across buckets)
dueAt         ISO datetime | null
tags          string[]
aiSuggestion* legacy, always null now (feature disabled)
subtaskCount / subtaskDone   aggregated live
enrichedAt    null until first AI pass ("classifying…" state in UI)
*Overridden   titleOverridden, sphereOverridden, dueAtOverridden, priorityOverridden
```

**Two iron rules every client must respect:**
1. **Capture never waits on AI.** `POST /tasks` returns immediately with defaults (`priority P2`, `sphere personal`, title = rawInput). Enrichment arrives seconds later as a `task.upserted` WebSocket delta.
2. **Overrides pin fields.** When the user manually edits title/sphere/due/priority, the server sets the corresponding `*Overridden` flag and AI re-enrichment never touches that field again. Clients don't manage the flags — just PATCH the field; the server pins it.

### Other entities

- **Subtask** `{id, taskId, title, done, createdAt}` — optional checklist inside a task.
- **ContextItem** `{id, taskId, kind: text|image|link|email|slack_message|calendar_event, body, attachmentKey, sourceRef, createdAt}` — append-only per-task activity feed. **Adding context re-runs full enrichment** (respecting overrides).
- **Suggestion** `{id, source: gmail|slack, accountId, title, reason, excerpt, sourceRef, status: pending|accepted|dismissed, taskId}` — AI-detected actions from inboxes awaiting user review. Nothing becomes a task without explicit accept.
- **MemoryRecordInfo** `{id, kind: entity|preference|pattern|outcome, content, createdAt}` — the learned profile ("Intelligence").
- **Event** — append-only log of every user action (captures, edits, completions, accepts/dismisses, reminders fired). Server-internal; feeds nightly memory distillation.

### Priority engine (server-side, FYI)

Deterministic base from due proximity (overdue 95 → no-due 30) + staleness creep (+1 per 3 days, cap 10) + AI importance adjustment (`(ai−50)×0.4`), clamped 0–100. Buckets: `≥70 P1`, `≥40 P2`, else `P3`. Recomputed on due-date change, on new context (via re-enrich), and nightly at 04:00 UTC. Never touches `priorityOverridden` tasks.

Display: P1 red tint `#ff6961`, P2 amber `#ffb224`, P3 gray `#8b93a7`; labels **High / Medium / Low**.

---

## 4. REST API reference

Auth = Bearer header unless noted. Validation errors → `400 {error:"validation", issues}`; unknown auth → `401`.

### Tasks

| Method & path | Body / params | Returns | Notes |
|---|---|---|---|
| `GET /tasks` | — | `{tasks: Task[]}` | Open + done, excludes archived, ≤200, sorted by score |
| `POST /tasks` | `{rawInput, clientId?}` | `201 Task` (or `200` existing) | `clientId` = client ULID for **idempotent offline replay** |
| `PATCH /tasks/:id` | any of `{title, sphere, status, dueAt, priority, tags, blocked}` | `Task` | Sets override flags; due change re-arms reminders + rescores; `blocked:true` sinks the task below same-priority peers |
| `GET /sync?since=ISO` | cursor optional | `{tasks, suggestionCount, nextCursor}` | Delta backfill: tasks with `updatedAt > since` (includes archived so deletions propagate); no cursor → full open set, ≤500. Store `nextCursor`, pass it next time |

### Subtasks

| | | |
|---|---|---|
| `GET /tasks/:id/subtasks` | | `{subtasks: Subtask[]}` |
| `POST /tasks/:id/subtasks` | `{title}` | `201 Subtask` |
| `PATCH /subtasks/:id` | `{title?, done?}` | `Subtask` |
| `DELETE /subtasks/:id` | | `204` |

Every subtask mutation re-broadcasts the parent task (`task.upserted`) with fresh `subtaskDone/subtaskCount`.

### Context & attachments

| | | |
|---|---|---|
| `GET /tasks/:id/context` | | `{items: ContextItem[]}` |
| `POST /tasks/:id/context` | `{kind: "text"\|"link", body}` | `201 ContextItem` — triggers re-enrichment |
| `POST /tasks/:id/attachments` | multipart `file` (image/*, ≤8 MB) | `201 ContextItem` (kind image) — triggers re-enrichment |
| `GET /attachments/:id?token=` | | image bytes with content-type |

### Suggestions (review queue)

| | | |
|---|---|---|
| `GET /suggestions` | | `{suggestions}` — pending only, ≤50, newest first |
| `POST /suggestions/:id/accept` | | `201 Task` — creates task via normal pipeline; **inherits the source account's linked sphere (pinned)**; source content attached as context |
| `POST /suggestions/:id/dismiss` | | `204` — dismissal is memory-layer training signal |
| `POST /suggestions/scan` | | `202 {queued}` — manual Gmail scan **for this user only** |

### Integrations

| | | |
|---|---|---|
| `GET /integrations` | | `{accounts: [{id, provider, externalId, sphere, createdAt}], googleConfigured, slackConfigured}` |
| `PUT /integrations/:id` | `{sphere: string\|null}` | link account → category (validated against user's spheres); `400` unknown category |
| `DELETE /integrations/:id` | | `204` disconnect |
| `GET /integrations/google/connect?token=` | browser | redirects to Google consent (multi-account: repeat per account) |
| `GET /integrations/slack/connect?token=` | browser | redirects to Slack consent (user-token scopes) |
| `POST /integrations/slack/events` | Slack only | signed events endpoint (HMAC verified) — not for clients |

### Slack daily digest

| | | |
|---|---|---|
| `GET /slack/digest` | | `{digest: {date, content(markdown), createdAt} \| null, excludedChannels}` — `404` if no Slack account |
| `GET /slack/channels` | | `{channels: [{id, name}]}` — public channels the user is a **member** of (full pagination); `409 {error:"reconnect_required"}` if token lacks scopes |
| `POST /slack/digest/refresh` | `{force?: bool}` | `202` — `force:false` = generate only if today's missing (call this **on app startup**); `force:true` = manual refresh button |
| `PUT /slack/digest/settings` | `{excludedChannels: string[]}` | persist channel exclusions |

Completion is signalled by a `notification` WS push + the digest row changing; clients poll `GET /slack/digest` while pending (desktop polls every 4s, 3-min cap, pending state persisted so it survives navigation).

### Intelligence (memory + behaviour)

| | | |
|---|---|---|
| `GET /memory` | | `{records: MemoryRecordInfo[], preferences: Record<sphere, string>}` |
| `POST /memory` | `{kind, content}` | `201` — manually teach a fact (e.g. entity) |
| `DELETE /memory/:id` | | `204` — suppresses (never re-learned by distillation) |
| `PUT /memory/preferences` | `Record<sphere, string>` | free-text behaviour instructions per category, injected into every AI prompt |

### Devices & push (Android-critical)

| | | |
|---|---|---|
| `POST /devices` | `{id?, platform: "android", name?, pushToken?, appVersion?, osVersion?}` | `201/200 DeviceInfo` — **upsert**: reuse your stored device id to update the FCM token; re-registering re-enables a disabled device |
| `DELETE /devices/:id` | | `204` — disables + clears push token (call on logout) |

### Local AI execution (desktop only)

An opt-in per-device mode where **Ask Focus**, **enrich-on-capture**, and **Plan my day** run through the user's local **Claude Code** login (Agent SDK) instead of the server API — drawing on their Claude subscription. Architecture: **server prepares + applies, client executes**.

- **Sidecar** (`apps/desktop/sidecar/`, Node + `@anthropic-ai/claude-agent-sdk`): the Tauri host spawns it, reads a `{port,token}` handshake from stdout, and proxies webview calls. Endpoints: `GET /health` (claude installed/logged-in), `POST /structured` (one-shot), `POST /assistant` (agent loop; Focus tools are in-process MCP tools that call the Focus API with the user's JWT). Requires Node 18+ and `claude login` on the machine (detected in Settings; not bundled).
- **Enrich (client-driven when local):** capture routes to a delayed `ifUnenriched` safety-net job (~90 s) instead of immediate server enrich; the desktop does `GET /tasks/:id/enrich-request` → runs it locally → `POST /tasks/:id/enrich-result` (server strict-validates with `Enrichment` + applies). If the desktop never does it (app closed, Android capture), the safety net enriches server-side. `enrichTask` is split into `buildEnrichPrompt` + `applyEnrichment` (reused by both paths).
- **Assistant (client-driven when local):** the client calls the sidecar `/assistant`; on any failure it falls back to `POST /chat`.
- **Plan my day (client-driven when local):** `GET /today/plan-request` → run locally → `POST /today/plan-result` (server validates `PlanOutput` + filters to real task ids); falls back to `POST /today/plan`.
- **Mini orb capture** triggers local enrichment directly; a cross-window `localStorage` claim (`focus.enriching.<id>`) dedupes it against the main window's socket-driven trigger.
- **Computer control** (Control page, desktop + local mode only): an autonomous computer-use agent. Sidecar `computer.js` exposes MCP tools — `screenshot` (all displays via built-in `screencapture` + `sips` downscale, returned as image blocks for Claude's vision; per-display geometry from `osascript` JXA `NSScreen`) and input actions (`move/click/type/key/scroll/wait`) via `@nut-tree-fork/nut-js`; coordinates are per-display image pixels mapped to global logical points. Loop: `POST /control {task}` runs `query()` with the computer tools, `maxTurns` step cap, and an `AbortController`; `GET /control/status` (steps + latest screenshots) is polled by the UI; `POST /control/stop` aborts. Requires macOS **Screen Recording** (capture) + **Accessibility** (input) for the running process. Autonomous with a live view + Stop button; runs on the Claude subscription (image-heavy).
- **Fallback everywhere:** no local executor → server API. Ambient jobs (Gmail/distill/digest) and Android always use the server.
- **Caveat:** uses the Claude plan; Anthropic's paused `-p`/SDK billing split could bill API rates if un-paused. Instantly disableable via the mode toggle.
- Note: `Enrichment.dueAt` accepts a UTC **offset** (not just `Z`) — the prompt asks for a local offset so "end of day" stays on the right calendar day; local Claude obeys it precisely (Gemini had been returning `Z`).

### Calendar & Today

| | | |
|---|---|---|
| `GET /calendar?date=YYYY-MM-DD` | | `{events: CalendarEventInfo[], connected}` — merged events across all linked Google accounts for that day (default today, user's tz); `connected:false` when no Google account is linked |
| `POST /today/plan` | — | `{blocks: PlanBlock[]}` — AI schedules the user's open tasks into the free gaps around the day's meetings. `503` if AI unconfigured; empty on quota exhaustion |

`CalendarEventInfo = {id, title, start, end, allDay}`. `PlanBlock = {taskId: string\|null, title, start, end, reason}` (taskId null = a suggested break/buffer). The desktop "Today" page renders these on an hourly timetable (07:00–23:00) alongside due-today task chips.

### Routines (recurring tasks)

| | | |
|---|---|---|
| `GET /routines` | | `{routines: Routine[]}` |
| `POST /routines` | `{title, sphere?, priority?, cadence, interval?, weekday?, dayOfMonth?}` | `201 Routine` — `nextRunAt` computed server-side |
| `PATCH /routines/:id` | any of `{active, title, priority, sphere, cadence, interval, weekday, dayOfMonth}` | `Routine` — recomputes `nextRunAt` on any schedule change |
| `DELETE /routines/:id` | | `204` |

`Routine = {id, userId, title, sphere, priority, cadence: "daily"|"weekly"|"monthly", interval, weekday: 0–6|null, dayOfMonth: 1–31|null, active, nextRunAt, lastSpawnedAt, createdAt}`. A BullMQ repeatable job spawns a normal (pre-enriched) task from each due routine at ~07:00 UTC and advances `nextRunAt`.

### Ask Focus (conversational assistant)

| | | |
|---|---|---|
| `POST /chat` | `{messages: [{role: "user"\|"assistant", content}]}` (≤40) | `{reply: string}` | Tool-calling assistant scoped to the caller. `503` if AI unconfigured; on quota exhaustion returns `200` with a friendly fallback reply |

The server exposes DB-backed tools to the model (`search_tasks`, `create_task`, `update_task`, `recall_memory`, `create_routine`), all scoped to `req.userId`; mutations publish the usual `task.upserted` WS deltas so every client updates live. Provider-agnostic via the `assistant` capability route. Clients send the full thread each turn (stateless server). Desktop surfaces it as a bottom chat bar; the mini orb's right-click "Chat" field seeds a message that opens the main window and auto-sends.

### MCP server (Claude Code / Desktop)

`apps/mcp` is a standalone stdio **MCP server** that exposes Focus over the same REST API to Claude Code and Claude Desktop — tools: `list_tasks`, `create_task`, `update_task`, `complete_task`, `list_routines`, `create_routine`, `recall_memory`. Auth via `FOCUS_TOKEN` or `FOCUS_USERNAME`/`FOCUS_PASSWORD` (+ `FOCUS_API_URL`). Kept out of the pnpm workspace (own `npm install`); see [apps/mcp/README.md](../apps/mcp/README.md). It's a pure API client — no new server endpoints.

### Misc

- `GET /health` → `{ok, service}`
- `GET /openapi.json` → generated OpenAPI spec (from the same Zod schemas) — use it to generate the Kotlin client.

---

## 5. WebSocket protocol

Connect: `wss://<host>/ws?token=<JWT>`. Server → client only (client messages ignored). Reconnect with backoff; on reconnect do a `GET /sync?since=<lastCursor>` to backfill anything missed.

Message envelope (JSON per frame), discriminated on `type`:

| type | payload | meaning |
|---|---|---|
| `task.upserted` | `{task: Task}` | create/update — replace by id in local store (also fires for enrichment results, recomputes, subtask count changes) |
| `task.deleted` | `{id}` | remove |
| `context.added` | `{taskId}` | refetch that task's context if visible |
| `suggestion.changed` | — | pending-suggestion set changed → refetch count/list |
| `suggestion.new` | `{suggestion: Suggestion}` | full payload — show an **in-app review popup** (Create task / Dismiss) without fetching |
| `notification` | `{title, body, taskId?}` | show a system notification (see delivery matrix §8) |

⚠️ The WS bus is in-process on the server: it only reaches clients connected to the same instance. Fine today (single instance per env); Android should treat WS as an optimization over `GET /sync`, not the only sync path.

---

## 6. Sync & offline model (what desktop does; Android should mirror)

1. **Instant open**: render from a local cache keyed by user id (never share cache across accounts — see §14).
2. **Startup**: `GET /sync` (with stored cursor) → reconcile; store `nextCursor`. Also fire `POST /slack/digest/refresh {force:false}` (server no-ops if fresh today).
3. **Live**: WebSocket deltas.
4. **Offline capture**: generate a ULID client-side, queue `{clientId, rawInput}` locally, replay on reconnect — the server's `clientId` idempotency makes retries safe (returns the existing task instead of duplicating).
5. Optimistic UI on mutations; reconcile with the returned entity; on failure refetch.

ULID alphabet for `clientId`: Crockford base32, 26 chars, regex `^[0-9A-HJKMNP-TV-Z]{26}$`.

---

## 7. AI pipeline (server-side; clients only see the effects)

- **Orchestrator** (`packages/ai`): every call is a capability with its own model route — `enrich`, `suggest`, `digest`, `distill`, plus embeddings (`text-embedding-004`, 768-dim pgvector). Overridable per capability via `FOCUS_AI_ROUTE_<CAP>` env.
- **Enrichment** (on capture + on every context add): classifies sphere (from the *user's* category list — never invents), infers due date (in the user's local timezone offset), scores importance, writes title/tags. Injects the user's per-sphere behaviour instructions + recalled memory records into the prompt.
- **Gmail suggest**: screens last-24h inbox of every connected Google account (query `in:inbox newer_than:1d -category:promotions -category:social` — NOT `category:primary`, which is empty on Workspace accounts); high-precision "is there a concrete action for the user?" filter that hard-rejects marketing/notifications/automated mail; hits become pending Suggestions (+ `suggestion.new` push). Every verdict (even rejects) is stored as the dedup marker per message. **Real-time**: if `GMAIL_PUBSUB_TOPIC` is set, `users.watch` publishes new mail to Pub/Sub → our `POST /integrations/gmail/push` webhook enqueues a scoped scan (near-instant); the hourly poll is the fallback/safety net. Watches renew daily (05:00 UTC).
- **Language**: enrichment and memory distillation preserve the user's language — a Spanish task keeps a Spanish title/tags; nothing is translated.
- **Slack daily digest**: reads last-24h history of included member channels (8-way concurrent fetch), resolves author names AND in-text `<@ID>`/`<#C|name>`/`<url|label>` encodings to plain text (needs `users:read`). The AI returns **structured** output — a summary plus per-channel points, each carrying the source message `ts` so the server builds a Slack permalink (`<workspace>/archives/<channel>/p<ts>`) rendered as a per-point "open thread" link. Stored in `slack_digests.content` as JSON `{summary, sections:[{channel, points:[{text, url}]}]}` (legacy rows are plain markdown → wrapped as one section). The same call returns **action items** → `source:"slack"` pending Suggestions (deduped per day) + `suggestion.new` toasts, so the review queue is fed by both Gmail and Slack.
- **Morning digest**: 08:00 Paris — AI text summary of the day's tasks, delivered as a notification.
- **Memory distillation**: nightly; turns the event log into durable records (entities/preferences/patterns/outcomes) that feed back into enrichment and suggestion filtering. User-deleted records are suppressed forever.
- **Day planning** (`plan` capability, on-demand via `POST /today/plan`): given the user's open tasks + the day's calendar events, schedules tasks into the free gaps and returns time-boxed `PlanBlock`s.
- **Ask Focus assistant** (`assistant` capability, on-demand via `POST /chat`): a multi-step tool-calling loop (`stepCountIs(6)`) with DB-backed tools scoped to the user (search/create/update tasks, recall memory, create routines). Reads and mutates real state; replies in the user's language.

---

## 8. Notifications delivery matrix

`notify()` on the server does three things for every notification (kinds: `due_soon`, `overdue`, `digest`, `slack_digest`):

1. Records an event (memory layer).
2. Pushes WS `notification` to connected clients.
3. **Sends FCM to all enabled Android devices with a push token.**

FCM message shape (HTTP v1):

```json
{
  "message": {
    "token": "<device pushToken>",
    "notification": { "title": "...", "body": "..." },
    "data": { "kind": "due_soon", "taskId": "01H..." },   // taskId optional
    "android": { "priority": "HIGH" }
  }
}
```

Android: register the FCM token via `POST /devices` on login/token-refresh; deep-link `data.taskId` to the task detail; `data.kind` distinguishes reminder vs digest. Requires `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON` env on the server (silently skipped if unset).

Reminder semantics: due-soon fires ~1h before `dueAt`, overdue fires once when passed; both re-arm when the due date changes.

---

## 9. Integrations — behavior summary

### Google (Gmail + Calendar scopes)
- Multi-account: each connect adds an `integration_accounts` row; OAuth tokens AES-256-GCM encrypted at rest; auto-refresh.
- **Category linking**: each account can be linked to a sphere (`PUT /integrations/:id`). Accepted email suggestions land in that sphere, pinned.
- **Calendar**: `GET /calendar` merges events across all linked Google accounts for a given day; feeds the desktop "Today" timetable and the AI day-planner (`POST /today/plan`).

### Slack (custom app, user tokens)
- Capture: reacting 👀 (`:eyes:`) to any message creates a task with the message as context (via signed events endpoint → queue).
- Daily digest: see §4. Requires user scopes `channels:history, channels:read, groups:history, im:history, mpim:history, reactions:read, users:read` — accounts connected before 2026-07-07 must reconnect (server detects `missing_scope` and sends a "reconnect" notification / `409` on the channels endpoint).
- User tokens can only read channels the user is a **member** of.

---

## 10. Background jobs (BullMQ, in the server process)

| Job | Schedule | Purpose |
|---|---|---|
| `reminder-scan` | every 60 s | due-soon/overdue notifications |
| `gmail-poll` | hourly (+ on-demand per user) | inbox screening → suggestions |
| `morning-digest` | 06:00 UTC | AI day summary notification |
| `memory-distill` | 02:30 UTC | events → memory records |
| `nightly-recompute` | 04:00 UTC | priority staleness/decay pass |
| `routines-run` | hourly | spawns tasks from routines whose `nextRunAt` has passed; advances `nextRunAt` |
| `enrich`, `recompute-task`, `slack-capture`, `slack-digest` | on demand | queued by routes/events |

---

## 11. Desktop-only features (context for parity decisions)

Not expected in Android v1, listed so you know they exist: floating mini-orb window (quick capture/search, notification speech bubbles), global capture hotkey (⌘⇧Space), native window vibrancy with user-adjustable transparency, drag-and-drop of images onto tasks, calendar month/year views with drag-to-reschedule, work/personal column toggles, in-app suggestion toasts (Android equivalent = FCM + a review screen).

---

## 12. Environment variables (server)

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`.
AI: `GOOGLE_GENERATIVE_AI_API_KEY` — now only the **fallback**; each user can set their own key in Settings (`PUT /users/me/ai-key`, encrypted) which takes precedence. AI features skip per-user when neither exists. `FOCUS_AI_ROUTE_*` model overrides.
Integrations: `PUBLIC_URL`, `GOOGLE_CLIENT_ID/SECRET`, `SLACK_CLIENT_ID/SECRET/SIGNING_SECRET`.
Push: `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`.
Files (future): `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

---

## 13. Android integration checklist

Ready on the server today:
- [x] `POST /auth/register` / `login` (90-day JWT)
- [x] `GET /sync` cursor backfill + WS deltas
- [x] `POST /devices` FCM registration (+ disable on logout)
- [x] FCM pushes for reminders/digests with `taskId` deep-link data
- [x] `GET /openapi.json` for client generation
- [x] Idempotent offline capture via client ULIDs
- [x] Full tasks/subtasks/context/suggestions/memory/profile APIs
- [x] Calendar + AI day-plan (`GET /calendar`, `POST /today/plan`)
- [x] Routines CRUD (`GET/POST/PATCH/DELETE /routines`) + hourly spawner
- [x] Ask Focus assistant (`POST /chat`) — stateless, send full thread each turn

Client responsibilities: per-user local cache; offline queue + replay; treat WS as optimization over `/sync`; render "classifying…" until `enrichedAt` set; use display labels (High/Medium/Low) over P-buckets; respect `spheres` from `/users/me` everywhere a category appears.

---

## 14. Known gotchas & constraints

1. **Gemini free tier**: `gemini-2.5-pro` quota is 0 and flash is ~20 req/day — the ambient pipeline exhausts it; until billing is enabled on the key, enrichment/digests intermittently 429 and tasks sit at "classifying…". Everything currently routes to flash/flash-lite.
2. **Dev and prod share one Redis and one Postgres.** BullMQ uses prefix `bull-dev` locally vs default in prod so workers don't steal each other's jobs — but data is shared; local testing touches real data.
3. **WS bus is in-process** — see §5.
4. **Slack**: user-token model limits digests/capture to channels the user has joined; scope changes require the user to re-run the OAuth connect.
5. **Timezones**: `users.timezone` exists (default Europe/Paris) and is used for digests/due-date prompts, but the morning-digest cron is fixed at 06:00 UTC (not per-user yet).
6. **Attachments/avatars** stream through Postgres for now; `<img>`-style access uses `?token=` query params (S3 + signed URLs planned).
7. **`drizzle-kit push` needs a TTY** for destructive-looking prompts — schema DDL on the live DB is applied via plain SQL instead. If code references columns you don't see in the DB, check they were actually applied.
8. **Suggestions from email** only screen the "primary" Gmail category, last 24h, ≤25 messages/account/run.
