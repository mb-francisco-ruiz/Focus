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

export async function closeDb(): Promise<void> {
  await pool.end();
}
