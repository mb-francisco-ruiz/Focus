import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { generateStructured, suggestPrompt } from "@focus/ai";
import { SuggestionVerdict } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "./ai-key.js";
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
export async function pollGmailForSuggestions(userId?: string): Promise<void> {
  if (!googleConfigured()) return;

  // Manual scan for a user with no AI key: say so instead of "no new emails".
  if (userId && !(await aiKeyFor(userId))) {
    const { notify } = await import("./notify.js");
    await notify(
      userId,
      "scan",
      "Inbox scan",
      "Add your Gemini API key in Settings to enable email screening.",
    );
    return;
  }

  const accounts = await db.query.integrationAccounts.findMany({
    where: userId
      ? and(
          eq(schema.integrationAccounts.provider, "google"),
          eq(schema.integrationAccounts.userId, userId),
        )
      : eq(schema.integrationAccounts.provider, "google"),
  });

  const stats = { fresh: 0, suggested: 0, failed: 0, quota: false };
  for (const account of accounts) {
    // One broken account (revoked token…) must not block the others.
    try {
      const key = await aiKeyFor(account.userId);
      if (!key) continue; // this account's owner has no AI configured
      const r = await pollAccount(account, key);
      stats.fresh += r.fresh;
      stats.suggested += r.suggested;
    } catch (err) {
      stats.failed++;
      const msg = String(err);
      if (msg.includes("quota") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        stats.quota = true;
      }
      console.error(`gmail poll failed for ${account.externalId}`, err);
    }
  }

  // Manual scans report their outcome — silence is indistinguishable from broken.
  if (userId) {
    const { notify } = await import("./notify.js");
    const body = stats.quota
      ? "The AI quota is exhausted for today — screening resumes tomorrow, or enable billing on the Gemini key."
      : stats.failed === accounts.length && accounts.length > 0
        ? "Scan failed — check your Google connections in Settings."
        : stats.fresh === 0
          ? "No new emails since the last scan."
          : `Screened ${stats.fresh} new email${stats.fresh === 1 ? "" : "s"} — ${
              stats.suggested === 0
                ? "nothing needs your action"
                : `${stats.suggested} suggestion${stats.suggested === 1 ? "" : "s"} waiting`
            }.`;
    await notify(userId, "scan", "Inbox scan finished", body);
  }
}

async function pollAccount(
  account: typeof schema.integrationAccounts.$inferSelect,
  apiKey: string,
): Promise<{ fresh: number; suggested: number }> {
  const token = await accessTokenFor(account);
  const messages = await recentMessages(token);
  const stats = { fresh: 0, suggested: 0 };
  if (messages.length === 0) return stats;

  // Learned preferences + user instructions raise precision.
  const learned = await recallMemory(account.userId, null, {
    kind: "preference",
    limit: 10,
  });
  const owner = await db.query.users.findFirst({
    where: eq(schema.users.id, account.userId),
  });
  const memoryContext = [
    ...Object.entries(owner?.preferences ?? {})
      .filter(([, text]) => text)
      .map(([sphere, text]) => `${sphere} instructions: ${text}`),
    ...learned,
  ];

  for (const msg of messages) {
    // Dedup: one verdict per message per account, ever.
    const dedupKey = `gmail:${msg.id}`;
    const seen = await db.query.suggestions.findFirst({
      where: eq(schema.suggestions.dedupKey, dedupKey),
    });
    if (seen) continue;
    stats.fresh++;

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
      { apiKey },
    );

    // Record a row even for rejects — it IS the dedup marker, and rejects
    // are training signal for Phase 3 precision tuning.
    const isSuggestion = verdict.isTask && verdict.confidence >= MIN_CONFIDENCE;
    const [row] = await db
      .insert(schema.suggestions)
      .values({
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
      })
      .returning();
    if (isSuggestion) {
      await recordEvent(account.userId, "suggestion.created", null, {
        source: "gmail",
        from: msg.from,
        confidence: verdict.confidence,
      });
      // Push the whole suggestion so the app pops an in-app review toast.
      publish(account.userId, {
        type: "suggestion.new",
        suggestion: {
          id: row!.id,
          userId: row!.userId,
          source: row!.source,
          accountId: row!.accountId,
          title: row!.title,
          reason: row!.reason,
          excerpt: row!.excerpt,
          sourceRef: row!.sourceRef as Record<string, unknown>,
          status: row!.status,
          taskId: row!.taskId,
          createdAt: row!.createdAt.toISOString(),
        },
      });
      publish(account.userId, { type: "suggestion.changed" });
      stats.suggested++;
    }
  }
  return stats;
}
