import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { decrypt } from "./crypto.js";

/**
 * Resolve the Gemini API key to use for a user's AI calls: their own
 * per-user key (set in Settings, encrypted at rest) if present, else the
 * global GOOGLE_GENERATIVE_AI_API_KEY env fallback. Returns null when neither
 * exists — callers treat that as "AI not configured for this user".
 *
 * Cached briefly so the many AI calls in one job/request don't each hit the DB;
 * the Settings write path calls clearAiKeyCache to invalidate immediately.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { key: string | null; at: number }>();

export async function aiKeyFor(userId: string): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.key;

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { aiApiKey: true },
  });
  let key: string | null = null;
  if (user?.aiApiKey) {
    try {
      key = decrypt(user.aiApiKey);
    } catch {
      key = null; // key encrypted under a different secret — fall through
    }
  }
  key = key ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;
  cache.set(userId, { key, at: Date.now() });
  return key;
}

export function clearAiKeyCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
