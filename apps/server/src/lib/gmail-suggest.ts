import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { generateStructured, suggestPrompt } from "@focus/ai";
import { SuggestionVerdict } from "@focus/shared";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { recordEvent } from "./events.js";
import { recallMemory } from "./memory.js";
import { accessTokenFor, googleConfigured, recentMessages } from "./google.js";

const MIN_CONFIDENCE = 0.6;

/**
 * Gmail auto-suggest (PLAN.md §5.3, decided day-one): poll each connected
 * google account, run the cheap suggest pass, queue hits for review.
 * Suggestions NEVER become tasks directly. Polling is the Phase 2 baseline;
 * Pub/Sub push replaces it when volume warrants.
 */
export async function pollGmailForSuggestions(): Promise<void> {
  if (!googleConfigured() || !env.GOOGLE_GENERATIVE_AI_API_KEY) return;

  const accounts = await db.query.integrationAccounts.findMany({
    where: eq(schema.integrationAccounts.provider, "google"),
  });

  for (const account of accounts) {
    // One broken account (revoked token…) must not block the others.
    try {
      await pollAccount(account);
    } catch (err) {
      console.error(`gmail poll failed for ${account.externalId}`, err);
    }
  }
}

async function pollAccount(
  account: typeof schema.integrationAccounts.$inferSelect,
): Promise<void> {
  const token = await accessTokenFor(account);
  const messages = await recentMessages(token);
  if (messages.length === 0) return;

  // Learned preferences ("newsletters from X are never tasks") raise precision.
  const memoryContext = await recallMemory(account.userId, null, {
    kind: "preference",
    limit: 10,
  });

  for (const msg of messages) {
    // Dedup: one verdict per message per account, ever.
    const dedupKey = `gmail:${msg.id}`;
    const seen = await db.query.suggestions.findFirst({
      where: eq(schema.suggestions.dedupKey, dedupKey),
    });
    if (seen) continue;

    const verdict = await generateStructured(
      "suggest",
      SuggestionVerdict,
      suggestPrompt({
        source: "gmail",
        from: msg.from,
        subject: msg.subject,
        body: msg.snippet,
        userEmail: account.externalId,
        memoryContext,
      }),
    );

    // Record a row even for rejects — it IS the dedup marker, and rejects
    // are training signal for Phase 3 precision tuning.
    const isSuggestion = verdict.isTask && verdict.confidence >= MIN_CONFIDENCE;
    await db.insert(schema.suggestions).values({
      id: ulid(),
      userId: account.userId,
      source: "gmail",
      accountId: account.id,
      title: verdict.title || msg.subject || "(no title)",
      reason: verdict.reason,
      excerpt: `${msg.subject ? `${msg.subject} — ` : ""}${msg.snippet}`.slice(0, 500),
      sourceRef: { messageId: msg.id, from: msg.from },
      dedupKey,
      status: isSuggestion ? "pending" : "dismissed",
    });
    if (isSuggestion) {
      await recordEvent(account.userId, "suggestion.created", null, {
        source: "gmail",
        from: msg.from,
        confidence: verdict.confidence,
      });
      publish(account.userId, { type: "suggestion.changed" });
    }
  }
}
