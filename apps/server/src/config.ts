import { fileURLToPath } from "node:url";
import { z } from "zod";

// Local dev reads apps/server/.env; deployed envs (Railway) inject real vars
// and have no .env file, hence the swallow.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  /* no .env file */
}

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  // Interim single-user credentials until Google/Slack OAuth (Phase 2).
  AUTH_USERNAME: z.string().min(1),
  AUTH_PASSWORD: z.string().min(1),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof Env>;

export const env: Env = Env.parse(process.env);

export const isDev = env.NODE_ENV === "development";
