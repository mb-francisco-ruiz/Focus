import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { generateStructured, slackDigestPrompt } from "@focus/ai";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "./ai-key.js";
import { publish } from "./bus.js";
import { decrypt } from "./crypto.js";
import { recordEvent } from "./events.js";
import { notify } from "./notify.js";
import { channelHistory, memberChannels, memberNames, workspaceUrl } from "./slack.js";

const DigestOutput = z.object({
  summary: z.string(),
  sections: z.array(
    z.object({
      channel: z.string(),
      points: z.array(
        z.object({
          text: z.string(),
          ts: z.string().describe("exact (ts:...) of the source message, or '' "),
        }),
      ),
    }),
  ),
  // Required (not .default) — a defaulted field becomes optional in the JSON
  // schema and Gemini omits it entirely, so actions were never produced.
  actions: z
    .array(
      z.object({
        title: z.string(),
        channel: z.string(),
        reason: z.string().describe("one sentence: why this needs the user"),
      }),
    )
    .describe("Concrete actions for the user; [] only if genuinely none"),
});

/** Resolve Slack's in-text encodings (<@ID>, <#C|name>, <url|label>) to plain text. */
function resolveMentions(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${names.get(id) ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_, name) => `#${name}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_, _u, label) => label)
    .replace(/<(https?:[^>]+)>/g, (_, u) => u);
}

// Kept tight: the whole 24h corpus goes into one prompt, and the free-tier
// Gemini key throttles hard on input tokens (raise once billing is enabled).
const MAX_TOTAL_MESSAGES = 250;
const MAX_MESSAGE_CHARS = 280;
const MAX_MESSAGES_PER_CHANNEL = 40;

function localDate(timezone: string): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: timezone });
}

export async function latestSlackDigest(userId: string) {
  return db.query.slackDigests.findFirst({
    where: eq(schema.slackDigests.userId, userId),
    orderBy: [desc(schema.slackDigests.createdAt)],
  });
}

/**
 * Slack daily digest (PLAN.md §5.4): scan the last 24h of public channels the
 * user is in (minus their exclusion list), have the AI write the summary.
 * `force` regenerates even if today's digest exists (manual refresh button);
 * without it, app-startup calls are cheap no-ops after the first of the day.
 */
export async function generateSlackDigest(userId: string, force: boolean): Promise<void> {
  const apiKey = await aiKeyFor(userId);
  if (!apiKey) return;

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return;
  const today = localDate(user.timezone);

  if (!force) {
    const existing = await db.query.slackDigests.findFirst({
      where: and(eq(schema.slackDigests.userId, userId), eq(schema.slackDigests.date, today)),
    });
    if (existing) return; // already fresh today
  }

  const account = await db.query.integrationAccounts.findFirst({
    where: and(
      eq(schema.integrationAccounts.userId, userId),
      eq(schema.integrationAccounts.provider, "slack"),
    ),
  });
  if (!account) return;

  const settings = account.settings as { digestExcludedChannels?: string[] };
  const excluded = new Set(settings.digestExcludedChannels ?? []);
  const token = decrypt((account.credentials as { userToken: string }).userToken);

  try {
    // users:read may be missing on older tokens — fall back to raw ids.
    const [channels, names, wsUrl] = await Promise.all([
      memberChannels(token),
      memberNames(token).catch(() => new Map<string, string>()),
      workspaceUrl(token).catch(() => null),
    ]);
    const oldest = Math.floor(Date.now() / 1000) - 24 * 3600;
    const included = channels.filter((c) => !excluded.has(c.name));
    const channelIdByName = new Map(included.map((c) => [c.name, c.id]));

    // Fetch histories with bounded concurrency — sequential over 70+ channels
    // took minutes and risked Slack rate limits.
    const fetched = await mapWithConcurrency(included, 8, async (channel) => {
      const history = await channelHistory(token, channel.id, oldest).catch(() => []);
      const lines = history
        .filter((m) => m.text && !m.subtype) // plain user messages only
        .reverse() // chronological
        .map((m) => {
          const time = new Date(Number(m.ts) * 1000).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: user.timezone,
          });
          const author = names.get(m.user ?? "") ?? "someone";
          const text = resolveMentions(m.text!.slice(0, MAX_MESSAGE_CHARS), names);
          return `(ts:${m.ts}) [${time}] ${author}: ${text}`;
        });
      return { name: channel.name, messages: lines.slice(-MAX_MESSAGES_PER_CHANNEL) };
    });

    const withMessages: { name: string; messages: string[] }[] = [];
    let total = 0;
    for (const c of fetched) {
      if (c.messages.length === 0 || total >= MAX_TOTAL_MESSAGES) continue;
      withMessages.push(c);
      total += c.messages.length;
    }

    // Slack permalink: <workspace>/archives/<channelId>/p<ts without dot>.
    const permalink = (channel: string, ts: string): string | null => {
      const id = channelIdByName.get(channel);
      if (!wsUrl || !id || !/^\d+\.\d+$/.test(ts)) return null;
      return `${wsUrl.replace(/\/$/, "")}/archives/${id}/p${ts.replace(".", "")}`;
    };

    let structured: { summary: string; sections: { channel: string; points: { text: string; url: string | null }[] }[] };
    let actions: { title: string; channel: string; reason: string }[] = [];
    if (withMessages.length === 0) {
      structured = {
        summary: "A quiet day: no new messages in your public channels in the last 24 hours.",
        sections: [],
      };
    } else {
      const out = await generateStructured(
        "digest",
        DigestOutput,
        slackDigestPrompt({
          date: today,
          userName: user.displayName ?? user.username ?? "the user",
          channels: withMessages,
        }),
        // don't hang in retry loops for minutes — fail fast and tell the user
        { abortSignal: AbortSignal.timeout(90_000), apiKey },
      );
      structured = {
        summary: out.summary,
        sections: out.sections.map((s) => ({
          channel: s.channel,
          points: s.points.map((p) => ({ text: p.text, url: permalink(s.channel, p.ts) })),
        })),
      };
      actions = out.actions;
    }
    const content = JSON.stringify(structured);

    await db
      .insert(schema.slackDigests)
      .values({ id: ulid(), userId, date: today, content })
      .onConflictDoUpdate({
        target: [schema.slackDigests.userId, schema.slackDigests.date],
        set: { content, createdAt: new Date() },
      });

    // Feed actionable items from the digest into the review queue.
    await createSuggestionsFromActions(userId, account.id, today, actions);

    await setDigestError(account.id, names.size === 0 ? "names_scope" : null);
    await notify(userId, "slack_digest", "Slack daily summary", "Your digest for today is ready.");
  } catch (err) {
    const msg = String(err);
    if (msg.includes("missing_scope")) {
      await setDigestError(account.id, "missing_scope");
      await notify(
        userId,
        "slack_digest",
        "Slack summary needs new permissions",
        "Reconnect your workspace in Settings → Integrations to enable daily summaries.",
      );
      return;
    }
    if (msg.includes("quota") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      await setDigestError(account.id, "quota");
      // Retrying a quota error just burns more quota — report and stop.
      await notify(
        userId,
        "slack_digest",
        "Slack summary hit the AI quota",
        "The Gemini key is out of free-tier quota. It will retry automatically tomorrow, or enable billing on the key.",
      );
      return;
    }
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("TimeoutError")) {
      await setDigestError(account.id, "timeout");
      await notify(
        userId,
        "slack_digest",
        "Slack summary timed out",
        "The AI call took too long. Try Refresh now again in a few minutes.",
      );
      return;
    }
    throw err;
  }
}

async function setDigestError(accountId: string, error: string | null): Promise<void> {
  const account = await db.query.integrationAccounts.findFirst({
    where: eq(schema.integrationAccounts.id, accountId),
  });
  if (!account) return;
  await db
    .update(schema.integrationAccounts)
    .set({ settings: { ...(account.settings as object), digestError: error } })
    .where(eq(schema.integrationAccounts.id, accountId));
}

/**
 * Turn digest action items into pending Slack suggestions. Dedup key is
 * per-day + slugified title so re-running today's digest never duplicates them,
 * while a genuinely new action on a later day still comes through.
 */
async function createSuggestionsFromActions(
  userId: string,
  accountId: string,
  date: string,
  actions: { title: string; channel: string; reason: string }[],
): Promise<void> {
  for (const action of actions) {
    const slug = action.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const dedupKey = `slack-digest:${date}:${slug}`;
    const seen = await db.query.suggestions.findFirst({
      where: eq(schema.suggestions.dedupKey, dedupKey),
    });
    if (seen) continue;

    const [row] = await db
      .insert(schema.suggestions)
      .values({
        id: ulid(),
        userId,
        source: "slack",
        accountId,
        title: action.title,
        reason: action.reason,
        excerpt: `#${action.channel} — ${action.reason}`.slice(0, 500),
        sourceRef: { channel: action.channel, fromDigest: date },
        dedupKey,
        status: "pending",
      })
      .returning();

    await recordEvent(userId, "suggestion.created", null, {
      source: "slack",
      channel: action.channel,
    });
    publish(userId, {
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
  }
  if (actions.length > 0) publish(userId, { type: "suggestion.changed" });
}

/** Run `fn` over items with at most `limit` in flight; preserves input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
