# Setting up your own Focus

Focus is self-hosted: you run your own server, database and (optionally) your own
Google/Slack/AI credentials. Nothing points at anyone else's instance. This guide
takes you from `git clone` to a running Focus in a few minutes, with integrations
optional and addable later.

## Prerequisites

- **Node 22+** and **pnpm** (`corepack enable && corepack prepare pnpm@latest`)
- **Docker** (for the local Postgres + Redis) — or your own Postgres-with-pgvector and Redis
- **Rust + Tauri prerequisites** only if you want to run/build the desktop app ([tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/))

## 1. Install

```bash
git clone <your-fork-url> focus && cd focus
pnpm install
```

## 2. Bring up local infra

```bash
docker compose up -d          # Postgres (pgvector) on :5432, Redis on :6379
```

Using your own database/Redis instead? Skip this and point the env vars (next
step) at them. Postgres must have the **pgvector** extension available — the
server enables it automatically on boot.

## 3. Configure the server

```bash
cp apps/server/.env.example apps/server/.env
```

Fill in the three **required** values (the compose defaults already match the
first two):

```
DATABASE_URL=postgresql://focus:focus@localhost:5432/focus
REDIS_URL=redis://localhost:6379
JWT_SECRET=            # openssl rand -hex 32
```

Everything else is optional — see [§6](#6-add-integrations-optional). `JWT_SECRET`
also derives the key that encrypts stored OAuth tokens, so **keep it stable**;
changing it logs everyone out and invalidates saved integration tokens.

## 4. Run

```bash
pnpm dev:server               # http://localhost:3001 — creates tables on first boot
```

The schema self-migrates on startup (pgvector extension + all tables), so there's
no separate migration step. Check it's up: `curl localhost:3001/health`.

## 5. Run a client

**Desktop (macOS/Windows):**

```bash
cp apps/desktop/.env.example apps/desktop/.env   # VITE_FOCUS_API_URL — defaults to localhost
pnpm dev:desktop
```

**Browser (quick check, no Tauri):** `pnpm --filter @focus/desktop dev` then open the printed URL.

Create an account in-app (open registration) and you're in. Tasks, capture,
routines, Today/Calendar and accounts all work with **zero** integrations
configured — AI and the integrations below light up only once you add their keys.

## 6. Add integrations (optional)

Each is independent; add only what you want. All credentials are **yours** — you
create your own apps/keys, tied to your own accounts.

### AI (Gemini)
Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Set
`GOOGLE_GENERATIVE_AI_API_KEY` in `apps/server/.env`, **or** set it per-user in the
app under **Settings → AI**. Without it, capture still works — tasks just aren't
auto-classified. (Local Claude Code mode is a per-device alternative — see the
Settings → AI toggle; it needs Claude Code installed and logged in.)

### Google (Gmail + Calendar)
1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. Enable the **Gmail API** and **Google Calendar API**.
3. Credentials → **OAuth client ID** → *Web application*.
   - Authorized redirect URI: `<PUBLIC_URL>/integrations/google/callback`
4. Put the client id/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. While unverified, add yourself as a **Test user** on the OAuth consent screen.

Scopes requested: Gmail readonly, Calendar readonly, userinfo.email.

### Slack (custom app)
1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**.
2. **OAuth & Permissions** → redirect URL `<PUBLIC_URL>/integrations/slack/callback`;
   user token scopes: `channels:history`, `channels:read`, `users:read`, `reactions:read`.
3. **Event Subscriptions** → request URL `<PUBLIC_URL>/integrations/slack/events`;
   subscribe to `reaction_added`.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.

> Slack events and Google redirects need a **public** `PUBLIC_URL`. For local
> testing, tunnel with e.g. `cloudflared`/`ngrok` and set `PUBLIC_URL` to the tunnel.

### Android push (FCM), Gmail real-time, S3 storage
Optional; see the comments in `apps/server/.env.example`. All degrade gracefully
(WebSocket + native notifications, hourly Gmail polling, and Postgres file storage
are the fallbacks).

## 7. Deploy (when you want it always-on)

The repo ships a root `Dockerfile` for the server. Any container host works; the
project was built on **Railway**:

```bash
railway up --service server     # from repo root
```

Set the same env vars on the host (`railway variables`), and set `PUBLIC_URL` to
the deployed URL. Then build the desktop app with `VITE_FOCUS_API_URL` pointing at
it. See [docs/TECHNICAL.md](docs/TECHNICAL.md) for the full API + architecture.

## 8. Claude integration (MCP)

Manage your tasks from Claude Code / Claude Desktop. Easiest: in the desktop app,
**Settings → Claude apps → Set up in Claude**. Manual setup and details:
[apps/mcp/README.md](apps/mcp/README.md).

## Good to know

- **Minimum to run:** Postgres + Redis + `JWT_SECRET`. Everything else is additive.
- **Single instance:** the live-sync bus is in-process, so run one server instance
  (fine for personal/small use; swap for Redis pub/sub to scale out).
- **Gemini free tier** is rate-limited (a handful of requests/day); enable billing
  or use local Claude Code mode for heavier use.
- **License:** none is set yet — add one before sharing publicly if that matters to you.
