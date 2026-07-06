# Focus

Centralised agenda & tasks: natural-language capture, AI classification and
priorities, Slack / Google Calendar / Gmail integrations, memory layer.
Full plan and decisions log: [PLAN.md](PLAN.md).

## Layout

- `apps/server` — Fastify API + Drizzle/Postgres (Railway)
- `apps/desktop` — Tauri v2 + React (macOS & Windows)
- `packages/shared` — Zod domain schemas + API contracts
- `packages/ai` — provider-agnostic AI orchestrator (Gemini first)
- `infra` — Railway config

## Dev

```sh
pnpm install
pnpm build                      # builds shared + ai (server imports their dist)

cp apps/server/.env.example apps/server/.env   # fill in values
pnpm db:push                    # sync schema to Postgres (needs DATABASE_URL in env)
pnpm dev:server                 # API on :3001
pnpm dev:desktop                # Tauri app (first run compiles Rust, takes a while)
```

`GOOGLE_GENERATIVE_AI_API_KEY` unset = capture works, AI enrichment is skipped.

## Railway

Project `focus` (Postgres + Redis). The server reads `DATABASE_URL` from the
environment; locally use the public proxy URL (`railway variables --service Postgres`),
deployed services use the internal one.
