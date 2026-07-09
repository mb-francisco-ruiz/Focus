import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });
export { schema };

/** pgvector must exist before drizzle-kit push creates vector columns. */
export async function ensureExtensions(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
}

/**
 * Idempotent, additive DDL applied at boot so a deploy can never drift ahead of
 * the live schema (the classic "code shipped, ALTER never run → 500" failure).
 * Only CREATE/ADD ... IF NOT EXISTS — never drops or rewrites existing objects.
 * drizzle-kit push stays the source of truth for local/dev; this is the safety
 * net for the shared Railway DB where interactive push isn't available.
 */
export async function ensureSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS routines (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      title text NOT NULL,
      sphere text NOT NULL DEFAULT 'personal',
      priority text NOT NULL DEFAULT 'P2',
      cadence text NOT NULL,
      interval integer NOT NULL DEFAULT 1,
      weekday integer,
      day_of_month integer,
      active boolean NOT NULL DEFAULT true,
      next_run_at timestamptz NOT NULL,
      last_spawned_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routines_user_idx ON routines (user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routines_next_run_idx ON routines (next_run_at)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS devices (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      platform text NOT NULL,
      name text,
      push_token text,
      app_version text,
      os_version text,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id)`);

  await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_api_key text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'server'`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_account_id text`);
  await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_has_time boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS calendar_sync boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS gcal_event_id text`);
  await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS gcal_account_id text`);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
