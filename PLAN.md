# Focus — Product & Technical Plan

**Goal:** A centralised place to manage agenda and tasks. Capture tasks in natural language from any area of life (work, personal, family), let AI classify, enrich and prioritise them, keep them in sync with Slack / Google Calendar / Gmail, and surface reminders — accessible from real desktop clients (macOS, Windows) and later a native Android app.

---

## 1. Product pillars

1. **Frictionless capture** — type (or paste, or drop) anything; the system figures out what it is.
2. **AI enrichment** — classification (work / personal / family / project), context extraction, due-date inference, priority scoring.
3. **Connected context** — Slack messages, emails and calendar events become task context or tasks themselves. Multiple Google accounts supported.
4. **Proactive** — reminders, daily digests, "this is slipping" nudges.
5. **Everywhere, natively** — installed desktop apps (tray icon, global shortcut, native notifications, offline cache), not a browser tab. Android later.
6. **Swappable AI** — Gemini first, but provider and model are configuration, not architecture.
7. **Memory** — every interaction, task and outcome is recorded and distilled, so the AI gets better at classifying, prioritising and suggesting *for you* over time.

---

## 2. High-level architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ macOS client│   │ Win client  │   │ Android     │  (later)
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │   HTTPS (REST) + WebSocket (live sync/push)
       └────────────┬────────────┴─────────────┘
              ┌─────▼──────────────────────────┐
              │        Focus API server        │
              │  auth · tasks · sync · files   │
              ├────────────────────────────────┤
              │ AI Orchestrator (provider-     │
              │ agnostic: Gemini → others)     │
              ├────────────────────────────────┤
              │ Integration hub                │
              │ Slack · GCal · Gmail (multi-   │
              │ account OAuth, webhooks/poll)  │
              ├────────────────────────────────┤
              │ Memory layer                   │
              │ event log · embeddings ·       │
              │ distilled profile · retrieval  │
              ├────────────────────────────────┤
              │ Scheduler / reminder engine    │
              └───────┬───────────┬────────────┘
                 PostgreSQL   Object storage (images/attachments)
                 + job queue
```

One backend, thin-ish clients. All business logic (AI, prioritisation, integrations, reminders) lives server-side so every client behaves identically and the Android app comes cheap later.

---

## 3. Stack recommendations

### 3.1 Desktop clients — **Tauri v2 + React/TypeScript** (recommended)

The requirement is "real desktop apps, not just a web app". Options considered:

| Option | Pros | Cons |
|---|---|---|
| **Tauri v2** ✅ | One UI codebase for macOS+Windows; tiny binaries (~10 MB); native menus, tray, global shortcuts, notifications, drag-and-drop, auto-update; Rust core for local SQLite cache | UI is web-rendered (system webview) — native *integration*, not native widgets |
| Electron | Same single-codebase benefit, mature | 150+ MB apps, heavier RAM, less "native" feel than Tauri for the same effort |
| Kotlin Multiplatform / Compose | One codebase incl. Android | Desktop story (JVM) is weakest of the three platforms; smaller ecosystem for desktop polish |
| Fully native (SwiftUI + WinUI3 + Kotlin) | Best feel per platform | 3 codebases — too expensive for a small team |

**Why Tauri:** you get genuinely installed apps with the desktop affordances that matter for a capture tool (global hotkey to capture from anywhere, menu-bar/tray quick-add, native notifications, OS drag-and-drop, offline cache) while writing the UI once. Android later is a **native Kotlin + Jetpack Compose** app talking to the same API (Tauri mobile exists but native Android will feel better and was already scoped as a separate later effort).

### 3.2 Backend — **TypeScript (Node) + Fastify/NestJS, PostgreSQL, BullMQ/Redis**

- **TypeScript end-to-end**: shared types between server and clients (one `packages/shared` with Zod schemas → validated API contracts for desktop now, and an OpenAPI spec the Android app can consume later).
- **PostgreSQL** as single source of truth (tasks, context, integration state, memory). **`pgvector` from day one** — the memory layer needs embeddings (see §6).
- **Redis + BullMQ** for background jobs: AI enrichment pipeline, integration polling, reminder scheduling, webhook processing, memory distillation.
- **Object storage** (S3-compatible — Cloudflare R2) for dropped images and attachments.
- **Real-time:** WebSocket channel per user for live sync and push (task updated on desktop A appears on desktop B instantly; reminders push through the same channel when the app is running).

**Hosting: Railway** ✅ *(decided)* — API server + workers as Railway services from the monorepo, plus managed Postgres (with pgvector) and Redis. Infra is managed through the **Railway CLI** (`railway up`, `railway variables`, `railway logs`), which also means Claude can operate deploys, env vars and logs directly. `infra/` holds the Railway config (`railway.json` / service definitions) so infrastructure state lives in the repo.

### 3.3 AI layer — provider-agnostic orchestrator

- Use the **Vercel AI SDK** (TS) as the abstraction: one interface, adapters for Gemini, OpenAI, Anthropic, etc. Swapping provider or model = config change per *capability*, not a rewrite.
- **Capability-based routing**, not one global model setting:

```ts
// ai/config.ts
capabilities: {
  classify:   { provider: "google", model: "gemini-flash",  fallback: "..." },
  enrich:     { provider: "google", model: "gemini-pro" },
  prioritize: { provider: "google", model: "gemini-flash" },
  digest:     { provider: "google", model: "gemini-pro" },
}
```

- Every AI call goes through the orchestrator: logging, token/cost tracking, retries, fallback provider, and **structured output** (JSON schema enforced) so downstream code never parses prose.
- Prompts versioned in-repo (`ai/prompts/`) so changes are reviewable and testable against a fixture set of real task inputs.

### 3.4 Repo layout — one monorepo

```
focus/
├── apps/
│   ├── server/          # Fastify/NestJS API + workers
│   ├── desktop/         # Tauri (macOS + Windows)
│   └── android/         # (later) Kotlin + Compose
├── packages/
│   ├── shared/          # types, Zod schemas, API client
│   └── ai/              # orchestrator, provider adapters, prompts
└── infra/               # Docker, deploy config
```

---

## 4. Core domain model (first pass)

```
User
 ├── IntegrationAccount   # n per user: google (email+cal), slack — OAuth tokens, scopes
 ├── Task
 │    ├── title, rawInput (original natural-language text)
 │    ├── sphere: work | personal | family | ...   (AI-set, user-overridable)
 │    ├── project/tags                              (AI-suggested)
 │    ├── dueAt, remindAt[]
 │    ├── priority: computedScore + userOverride    (override always wins)
 │    ├── status: inbox | active | waiting | done | archived
 │    └── ContextItem[]   # text notes, images, links,
 │                        # linked Slack msgs / emails / calendar events
 ├── Reminder / Digest preferences
 ├── Event                # append-only log: every capture, edit, completion,
 │                        # override, snooze, suggestion accepted/rejected
 ├── MemoryRecord         # distilled facts/preferences/patterns + embedding
 └── Device               # registered clients, for push routing
```

Key rules:
- **`rawInput` is never lost** — AI output decorates, never replaces, what the user typed.
- **Every AI-set field has an override flag.** Once a user overrides priority/sphere/due date, re-enrichment never touches that field again.
- Context items are append-only updates (like a mini activity feed per task) — text, dropped images, forwarded emails, linked Slack threads.

---

## 5. Key flows

### 5.1 Capture → enrich
1. User hits global hotkey / quick-add, types: *"remind Coni about the school form before Friday"*.
2. Client POSTs raw text (+ any dropped files) → task created instantly in `inbox` with the raw text. **Capture never waits on AI.**
3. Server enqueues `enrich` job → AI orchestrator classifies (sphere: family), extracts entities (Coni, school form), infers due date (this Friday), proposes priority.
4. Enrichment lands as a patch; clients get it via WebSocket. UI shows AI-filled fields as suggestions the user can tap to override.

### 5.2 Priority engine
- **Deterministic base score** from rules: due-date proximity, sphere weighting, calendar collision (busy day → surface earlier), staleness.
- **AI adjustment** on top: importance signals in the text ("CEO asked", "blocks the release").
- Score maps to P0–P3 buckets. **User override pins the bucket** and is excluded from recompute. Recompute runs on due-date changes, new context, and a nightly pass.

### 5.3 Integrations
- **Google (Gmail + Calendar):** OAuth per account, N accounts per user. Calendar: bidirectional awareness (tasks with times can create events; events inform priority/scheduling). Gmail: watch via Pub/Sub push (fallback: polling).
  - **AI auto-suggestion from day one** ✅ *(decided)*: incoming email runs through a cheap classify pass ("is there an action for the user here?"); hits become **suggested tasks in a review queue** — one tap to accept, edit, or dismiss. Suggestions never land directly in the task list. Accept/dismiss decisions are logged as events and feed the memory layer, so precision improves per user (e.g. "newsletters from X are never tasks"). Per-account and per-label filters to control the firehose.
- **Slack — custom Slack app** ✅ *(decided)*: our own Slack app serves two roles:
  - **Auth:** "Sign in with Slack" (OpenID Connect) as a login method alongside Google.
  - **Access:** user-token OAuth scopes to read messages/threads the user can see, so a task linked to a Slack thread can pull the thread as context and stay updated. Capture via message shortcut "Add to Focus" + emoji-reaction trigger (e.g. 👀 creates a task with the thread as context). Events API webhook → integration hub. Same auto-suggest classify pass as Gmail can run on DMs/mentions (opt-in per channel type).
- All integrations write through one internal interface (`SourceItem` → task or context), so adding e.g. Notion/Linear later is an adapter, not surgery.
- Tokens encrypted at rest (per-user envelope encryption); scopes requested minimally.

### 5.4 Reminders & updates
- Scheduler (queue-based, per-reminder jobs) fires: due-date reminders, custom `remindAt`, morning digest ("today: 3 meetings, 4 tasks, 1 slipping"), and event-driven nudges (new Slack context on a P0 task).
- Delivery: WebSocket → native desktop notification when a client is online; email fallback; FCM push when Android arrives. Optional: reminders via Slack DM from the Focus bot.

---

## 6. Memory layer

Goal: everything that happens in Focus — captures, edits, completions, overrides, accepted/dismissed suggestions, integration items — is **registered** and **used** to make future AI behaviour smarter and more personal.

Three tiers, all in Postgres:

1. **Event log (raw, append-only).** Every meaningful action is an `Event` row: `(user, type, entity, payload, ts)`. Cheap to write, never deleted, and the ground truth everything else is derived from. This ships in Phase 1 — *you can't backfill what you didn't record.*
2. **Embeddings (semantic recall).** Tasks, context items and memory records get pgvector embeddings. Enables "similar past tasks", dedup ("you already have a task for this email"), and retrieval for prompts.
3. **Distilled profile (learned memory).** A nightly/periodic background job runs AI over recent events and maintains `MemoryRecord`s — small, structured, human-readable facts with provenance:
   - *Entities:* "Coni = daughter, school-related tasks are family/P1."
   - *Preferences:* "User always bumps tax-related tasks to P0." "Dismisses task suggestions from newsletter senders."
   - *Patterns:* "Reviews inbox ~8:30; deep work Tue/Thu mornings — don't schedule nudges then."
   - *Outcomes:* "Tasks tagged 'call X' usually complete same-day; 'write doc' tasks slip ~3 days" → feeds priority/ETA realism.

**How memory is used:** the AI orchestrator injects relevant memory per capability — classification gets the entity glossary, prioritisation gets learned preference rules, suggestion filters get accept/dismiss history, digests get patterns. Retrieval = filtered `MemoryRecord`s + top-k embedding hits, capped per prompt.

**Feedback loop:** user overrides are first-class correction signals. Re-classifying a task or dismissing a suggestion doesn't just fix that item — the distillation job turns repeated corrections into a durable memory record.

**Controls:** memory is per-user, viewable ("what Focus knows about me"), individually deletable, and exportable. Deleting a memory record also excludes it from re-derivation.

## 7. Sync & offline

- Server is the source of truth. Clients keep a **local SQLite cache** (Tauri makes this trivial) so the app opens instantly and capture works offline.
- Offline mutations queue locally with client-generated ULIDs and replay on reconnect; last-write-wins per field (fine for a personal/small-team tool — no CRDT complexity for v1).
- WebSocket delivers deltas; full re-sync endpoint (`GET /sync?since=cursor`) for reconnects.

## 8. Auth & multi-user

- OAuth login: Google and **Sign in with Slack** (via our custom Slack app). Sessions via short-lived JWT + refresh tokens per device.
- Model it **multi-user from day one** (every row has `user_id`) even if it starts as a two-person tool — this costs nothing now and everything later.

---

## 9. Roadmap

**Phase 0 — Foundations (1–2 wks)**
Monorepo, CI, server skeleton, Postgres schema (incl. pgvector + `events` table), auth, shared types package, Railway project + CLI setup (services, Postgres, Redis, env), Tauri shell that logs in and lists tasks.

**Phase 1 — Core loop (3–4 wks)** → *usable daily on macOS/Windows*
Natural-language capture (global hotkey + quick-add), AI enrichment pipeline via orchestrator (Gemini), priority engine + overrides, context items (text + image drag-and-drop), WebSocket sync, local cache. **Event log wired into every mutation from the start.**

**Phase 2 — Integrations (3–4 wks)**
Custom Slack app (Sign in with Slack, shortcut + reaction capture, thread context), Google OAuth multi-account, Calendar read + event awareness, Gmail watch + **AI auto-suggested tasks with review queue**, integration settings UI.

**Phase 3 — Proactivity & memory ✅ complete (2026-07-07)**
Reminder scheduler, morning digest, native + Android/FCM notifications, nudges on stale/slipping tasks. Memory distillation + retrieval into AI prompts, **Intelligence** screen (behaviour instructions, learned entities, editable/deletable Memories). Review queue fed by Gmail + Slack digest, precision-tuned to reject marketing/automated mail. Gmail real-time via Pub/Sub push (hourly poll fallback). Language-preserving enrichment. Deferred niceties: email fallback for offline notifications, per-user digest times, Calendar event-awareness in the priority engine.

**Phase 3.5 — Assistant, calendar & routines ✅ complete (2026-07-07)**
Three "personal assistant" upgrades: (1) **Ask Focus** — a conversational, tool-calling layer (`POST /chat`) that reads and manages tasks/routines/memory scoped to the user; desktop shows it as a bottom chat bar, the mini orb's right-click "Chat" field seeds a message that opens the app and auto-sends. (2) **Real Google Calendar integration + AI day-planning** — `GET /calendar` merges events across linked Google accounts; `POST /today/plan` schedules open tasks into free gaps; a new **Today** page renders an hourly timetable. (3) **Configurable recurring tasks** — a **Routines** page + CRUD (`/routines`) with daily/weekly/monthly cadence, spawned by an hourly `routines-run` job. Also: user-flagged **blocked** tasks (sink below same-priority peers). Deferred: two-way calendar write-back, drag-to-edit plan blocks, streaming chat responses.

**Phase 4 — Android (later)**
Kotlin + Jetpack Compose against the existing API (OpenAPI-generated client), FCM push, share-sheet capture ("share to Focus" from any app).

**Deliberately out of v1:** team/shared tasks, web client, voice capture, non-Google calendars. All have a landing spot in the architecture but none block the core loop.

---

## 10. Decisions log

| # | Decision | Choice |
|---|---|---|
| 1 | Desktop framework | **Tauri v2 + React/TS** (2026-07-06) |
| 2 | Hosting | **Railway**, managed via Railway CLI (2026-07-06) |
| 3 | Slack | **Custom Slack app** — Sign in with Slack for auth + user-token scopes to read messages (2026-07-06) |
| 4 | Gmail ingestion | **AI auto-suggest from day one**, gated by a review queue (2026-07-06) |
| 5 | Memory | **Memory layer in core**: event log from Phase 1, embeddings + distilled profile by Phase 3 (2026-07-06) |
| 6 | Spheres | **Two spheres only: work / personal** — family & other folded into personal (2026-07-06) |
| 7 | UI | **Dark theme only**, sidebar layout (Inbox / Today / Completed / Memory / Settings), priority-grouped lists (2026-07-06) |
| 8 | Context → AI | Adding context **re-runs full enrichment** (priority, deadline, next-step suggestion), respecting all user-pinned fields (2026-07-06) |
| 9 | Interim auth | Single credential pair via AUTH_USERNAME/AUTH_PASSWORD env vars until Phase 2 OAuth (2026-07-06) |
| 10 | Priorities | **Three tiers: High / Medium / Low** (P1-P3 internally; P0 retired). Tinted chips, no group headers, sort by score (2026-07-06) |
| 11 | Navigation | **Roadmap** (open + completed per sphere column) with indented To Do / Completed sub-views; Suggestions review queue as its own section (2026-07-06) |
| 12 | Vibrancy | Semi-transparent native theme, user-adjustable via Settings slider (--glass-level) (2026-07-06) |
| 13 | Deployment | Self-hosted (Dockerfile at repo root; e.g. Railway via `railway up --service server`). See SETUP.md; set `PUBLIC_URL` to your deploy (2026-07-06) |
| 14 | AI models | Free-tier Gemini key: everything routes to flash/flash-lite (pro quota = 0). Revisit digest/distill → pro when billing is enabled (2026-07-06) |
| 15 | Queue isolation | Dev and prod share Railway Redis; BullMQ prefix `bull-dev` locally vs default in prod so workers can't steal each other's jobs (2026-07-06) |
| 16 | Mini mode | Clicking the sidebar logo shrinks the app to a floating always-on-top orb (own frameless window): click → quick capture + search + recent list (image drop attaches context); task click restores the full app; notifications/suggestions surface as speech bubbles while shrunk (2026-07-06) |
| 17 | Intelligence | Memory page rebranded **Intelligence**: per-sphere behaviour instructions (users.preferences, injected into enrich+suggest prompts), learned-entity cards with manual teach, distilled records. Subtasks added to the domain (own table, progress in rows). In-task AI suggestion expands to what/why/when (2026-07-06) |
| 18 | Gemini quota | Free tier = 20 req/day on gemini-2.5-flash — exhausted same-day by ambient AI. **Billing on the Gemini key is required** for real usage (2026-07-06) |
| 19 | Accounts | DB-backed users: open registration (username+password, scrypt-hashed), no validation by design (internal, 2 users). All data user-keyed → any client. Avatar upload behind FileStorage interface (Postgres now, S3 when AWS_* env set) (2026-07-06) |
| 20 | Categories | Spheres are **user-defined** (Settings → Categories, defaults work/personal, 1–8). Drive AI classification (never invents new ones), columns, toggles, behaviour cards. Deleting one reassigns its tasks to the first remaining (2026-07-06) |
