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
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  /** Where browsers reach this server (OAuth redirects, Slack events). */
  PUBLIC_URL: z.string().default("http://localhost:3001"),
  // Google OAuth (Phase 2) — integration routes 503 until set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Custom Slack app (Phase 2).
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  // Firebase Cloud Messaging HTTP v1. If unset, push delivery is skipped.
  FCM_PROJECT_ID: z.string().optional(),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // Gmail real-time push (Cloud Pub/Sub). If unset, hourly polling is used.
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  // AWS S3 for avatars/attachments — Postgres storage until these are set.
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof Env>;

export const env: Env = Env.parse(process.env);

export const isDev = env.NODE_ENV === "development";
