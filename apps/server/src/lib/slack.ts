import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { decrypt, encrypt } from "./crypto.js";
import { recordEvent } from "./events.js";
import { enqueue } from "./queue.js";
import { serializeTask } from "./serialize.js";

/** Reacting with this emoji on any message captures it as a task (PLAN.md §5.3). */
export const CAPTURE_EMOJI = "eyes"; // 👀

export function slackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET);
}

/**
 * User-token OAuth (not bot): Focus reads what the user can read, nothing more.
 */
const USER_SCOPES = [
  "channels:history",
  "channels:read", // digest: list public channels
  "groups:history",
  "im:history",
  "mpim:history",
  "reactions:read",
  "users:read", // digest: resolve author names
].join(",");

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID!,
    user_scope: USER_SCOPES,
    redirect_uri: `${env.PUBLIC_URL}/integrations/slack/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

interface SlackOAuthResult {
  teamId: string;
  teamName: string;
  slackUserId: string;
  userToken: string;
}

export async function exchangeCode(code: string): Promise<SlackOAuthResult> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      redirect_uri: `${env.PUBLIC_URL}/integrations/slack/callback`,
    }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    team?: { id: string; name: string };
    authed_user?: { id: string; access_token?: string };
  };
  if (!data.ok || !data.authed_user?.access_token) {
    throw new Error(`slack oauth failed: ${data.error ?? "no user token"}`);
  }
  return {
    teamId: data.team!.id,
    teamName: data.team!.name,
    slackUserId: data.authed_user.id,
    userToken: data.authed_user.access_token,
  };
}

export function credentialsFor(result: SlackOAuthResult): Record<string, string> {
  return { userToken: encrypt(result.userToken), teamName: result.teamName };
}

async function slackApi<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) throw new Error(`slack ${method} failed: ${data.error}`);
  return data;
}

/**
 * Queue job: turn a 👀-reacted message into a task with the message as context.
 * Runs off the request path — Slack requires event ACKs within 3 seconds.
 */
export async function captureFromReaction(input: {
  accountId: string;
  channel: string;
  ts: string;
}): Promise<void> {
  const account = await db.query.integrationAccounts.findFirst({
    where: eq(schema.integrationAccounts.id, input.accountId),
  });
  if (!account) return;
  const token = decrypt((account.credentials as { userToken: string }).userToken);

  // Same message captured before (re-reacting) → don't duplicate the task.
  const existing = await db.execute<{ id: string }>(sql`
    SELECT ci.id FROM context_items ci
    JOIN tasks t ON t.id = ci.task_id
    WHERE t.user_id = ${account.userId}
      AND ci.kind = 'slack_message'
      AND ci.source_ref->>'channel' = ${input.channel}
      AND ci.source_ref->>'ts' = ${input.ts}
    LIMIT 1`);
  if (existing.rows.length > 0) return;

  const history = await slackApi<{ messages: { text?: string; user?: string }[] }>(
    token,
    "conversations.history",
    { channel: input.channel, latest: input.ts, inclusive: "true", limit: "1" },
  );
  const message = history.messages[0];
  const text = message?.text?.trim();
  if (!text) return;

  const [task] = await db
    .insert(schema.tasks)
    .values({
      id: ulid(),
      userId: account.userId,
      rawInput: text.slice(0, 4000),
      title: text.length > 120 ? `${text.slice(0, 117)}…` : text,
    })
    .returning();
  await db.insert(schema.contextItems).values({
    id: ulid(),
    taskId: task!.id,
    kind: "slack_message",
    body: text.slice(0, 8000),
    sourceRef: { channel: input.channel, ts: input.ts, team: account.externalId.split(":")[0] },
  });

  await recordEvent(account.userId, "task.captured", task!.id, { via: "slack-reaction" });
  await recordEvent(account.userId, "context.added", task!.id, { kind: "slack_message" });
  await enqueue("enrich", { taskId: task!.id });
  publish(account.userId, { type: "task.upserted", task: serializeTask(task!) });
}


// ---- Digest helpers -----------------------------------------------------------

export interface SlackChannel {
  id: string;
  name: string;
}

/**
 * Public channels the user is a member of (user tokens can only read those).
 * Paginates fully — big workspaces have far more than one page of channels.
 */
export async function memberChannels(token: string): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor = "";
  do {
    const data = await slackApi<{
      channels: { id: string; name: string; is_member: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel",
      exclude_archived: "true",
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    for (const c of data.channels) {
      if (c.is_member) out.push({ id: c.id, name: c.name });
    }
    cursor = data.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function channelHistory(
  token: string,
  channel: string,
  oldest: number,
  limit = 100,
): Promise<{ user?: string; text?: string; ts: string; subtype?: string }[]> {
  const data = await slackApi<{
    messages: { user?: string; text?: string; ts: string; subtype?: string }[];
  }>(token, "conversations.history", {
    channel,
    oldest: String(oldest),
    limit: String(limit),
  });
  return data.messages;
}

/** Workspace URL (e.g. https://acme.slack.com/) for building permalinks. No scope needed. */
export async function workspaceUrl(token: string): Promise<string | null> {
  try {
    const data = await slackApi<{ url?: string }>(token, "auth.test", {});
    return data.url ?? null;
  } catch {
    return null;
  }
}

/** id → display name for the whole workspace (one call, cached per run). */
export async function memberNames(token: string): Promise<Map<string, string>> {
  const data = await slackApi<{
    members: { id: string; profile?: { display_name?: string; real_name?: string } }[];
  }>(token, "users.list", { limit: "200" });
  return new Map(
    data.members.map((m) => [
      m.id,
      m.profile?.display_name || m.profile?.real_name || m.id,
    ]),
  );
}
