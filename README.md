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
