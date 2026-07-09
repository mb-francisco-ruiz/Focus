# Focus

A personal work-and-life assistant: capture tasks in plain language, let AI
classify, prioritise and schedule them, keep them in sync with Slack / Google
Calendar / Gmail, and reach them from a native desktop app (macOS & Windows) —
with an optional conversational assistant and computer-control mode.

- **Set up your own instance → [SETUP.md](SETUP.md)** (self-hosted; a few minutes)
- Plan & decisions log: [PLAN.md](PLAN.md)
- Feature & API reference: [docs/TECHNICAL.md](docs/TECHNICAL.md)

## Layout

- `apps/server` — Fastify API + workers, Drizzle/Postgres (pgvector), BullMQ/Redis
- `apps/desktop` — Tauri v2 + React client (macOS & Windows) + floating mini-orb
- `apps/desktop/sidecar` — local Claude Code (Agent SDK) executor for on-device AI
- `apps/mcp` — MCP server: manage Focus from Claude Code / Claude Desktop
- `packages/shared` — Zod domain schemas + API contracts (OpenAPI)
- `packages/ai` — provider-agnostic AI orchestrator (Gemini / Claude)

## Quick start

```sh
pnpm install
docker compose up -d                             # Postgres (pgvector) + Redis
cp apps/server/.env.example apps/server/.env     # set JWT_SECRET; DB/Redis defaults match compose
pnpm dev:server                                  # API on :3001 (creates tables on first boot)
pnpm dev:desktop                                 # Tauri app (first run compiles Rust)
```

Runs with just Postgres + Redis + `JWT_SECRET`; AI and integrations are optional
and light up as you add their keys. Full walkthrough, integration setup (Google /
Slack OAuth apps, AI), and deployment: **[SETUP.md](SETUP.md)**.

## Deploy — example: Railway

The server ships a root `Dockerfile`, so any container host works. Here's the
setup the project was built on, end to end.

**1. Provision the two backing services.** In a new [Railway](https://railway.app)
project, add a **PostgreSQL** database and a **Redis** database (both one click).
Focus runs `CREATE EXTENSION IF NOT EXISTS vector` on boot, so Postgres needs
**pgvector** available — Railway's Postgres image includes it (if yours doesn't,
use a `pgvector/pgvector` image instead).

**2. Add the server service** from this repo (Railway auto-detects the root
`Dockerfile`). From the repo root you can also push directly with the CLI:

```sh
npm i -g @railway/cli
railway login
railway link           # pick the project
railway up --service server
```

**3. Set the server's variables** (service → **Variables**). Reference the two
databases so the URLs stay in sync, and add your own secret:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<openssl rand -hex 32>      # keep stable; also encrypts stored OAuth tokens
NODE_ENV=production
```

**4. Expose it and set `PUBLIC_URL`.** Under the server's **Settings → Networking**,
generate a domain, then add `PUBLIC_URL=https://<your-app>.up.railway.app`. That
value is what OAuth redirects and Slack event URLs are built from, so integrations
need it correct. No migration step — the schema is created on first boot.

**5. Point clients at it.** Build the desktop app with the deployed URL:

```sh
echo 'VITE_FOCUS_API_URL=https://<your-app>.up.railway.app' > apps/desktop/.env
pnpm --filter @focus/desktop tauri build
```

> Notes: the live-sync bus is in-process, so run a **single** server instance
> (fine for personal/small use). Add integration keys (Google/Slack/AI) as
> variables whenever you want those features — see [SETUP.md](SETUP.md#6-add-integrations-optional).
