import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { SlackDigestSettingsRequest, type SlackDigestInfo } from "@focus/shared";
import { env } from "../config.js";
import { decrypt } from "../lib/crypto.js";
import { latestSlackDigest } from "../lib/slack-digest.js";
import { db, schema } from "../db/index.js";
import { enqueue } from "../lib/queue.js";
import {
  authUrl,
  CAPTURE_EMOJI,
  credentialsFor,
  exchangeCode,
  memberChannels,
  slackConfigured,
} from "../lib/slack.js";
import { resultPage } from "./integrations.js";

/** Digest rows store JSON; older rows may hold plain markdown (wrap as one section). */
function parseDigestContent(content: string): {
  summary: string;
  sections: SlackDigestInfo["sections"];
} {
  try {
    const parsed = JSON.parse(content) as { summary?: string; sections?: SlackDigestInfo["sections"] };
    if (parsed && typeof parsed.summary === "string" && Array.isArray(parsed.sections)) {
      return { summary: parsed.summary, sections: parsed.sections };
    }
  } catch {
    /* legacy markdown */
  }
  return { summary: content, sections: [] };
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

function verifySignature(req: FastifyRequest): boolean {
  const ts = req.headers["x-slack-request-timestamp"] as string | undefined;
  const sig = req.headers["x-slack-signature"] as string | undefined;
  if (!ts || !sig || !req.rawBody) return false;
  // Replay window per Slack docs.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = `v0=${createHmac("sha256", env.SLACK_SIGNING_SECRET!)
    .update(`v0:${ts}:${req.rawBody}`)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface SlackEventBody {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type: string;
    reaction?: string;
    user?: string;
    item?: { type: string; channel: string; ts: string };
  };
}

export async function slackRoutes(app: FastifyInstance): Promise<void> {
  // Scoped parser: keep the raw body — Slack signatures are computed over the
  // exact bytes, not the parsed JSON. Encapsulation limits this to slack routes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error);
    }
  });

  app.post("/integrations/slack/events", async (req, reply) => {
    if (!slackConfigured()) return reply.code(503).send();
    if (!verifySignature(req)) return reply.code(401).send({ error: "bad signature" });

    const body = req.body as SlackEventBody;
    if (body.type === "url_verification") return { challenge: body.challenge };

    // ACK within Slack's 3s budget; real work happens on the queue.
    if (
      body.type === "event_callback" &&
      body.event?.type === "reaction_added" &&
      body.event.reaction === CAPTURE_EMOJI &&
      body.event.item?.type === "message"
    ) {
      const externalId = `${body.team_id}:${body.event.user}`;
      const account = await db.query.integrationAccounts.findFirst({
        where: and(
          eq(schema.integrationAccounts.provider, "slack"),
          eq(schema.integrationAccounts.externalId, externalId),
        ),
      });
      if (account) {
        await enqueue("slack-capture", {
          capture: {
            accountId: account.id,
            channel: body.event.item.channel,
            ts: body.event.item.ts,
          },
        });
      }
    }
    return reply.code(200).send();
  });

  const slackAccountFor = async (userId: string) =>
    db.query.integrationAccounts.findFirst({
      where: and(
        eq(schema.integrationAccounts.userId, userId),
        eq(schema.integrationAccounts.provider, "slack"),
      ),
    });

  /** Latest digest + exclusion settings for the Settings section. */
  app.get("/slack/digest", { onRequest: [app.authenticate] }, async (req, reply) => {
    const account = await slackAccountFor(req.userId);
    if (!account) return reply.code(404).send({ error: "no slack account connected" });
    const digest = await latestSlackDigest(req.userId);
    const settings = account.settings as {
      digestExcludedChannels?: string[];
      digestError?: string | null;
    };
    return {
      digest: digest
        ? ({
            date: digest.date,
            ...parseDigestContent(digest.content),
            createdAt: digest.createdAt.toISOString(),
          } satisfies SlackDigestInfo)
        : null,
      excludedChannels: settings.digestExcludedChannels ?? [],
      lastError: settings.digestError ?? null,
    };
  });

  /** Public channels the user is in — feeds the exclusion picker. */
  app.get("/slack/channels", { onRequest: [app.authenticate] }, async (req, reply) => {
    const account = await slackAccountFor(req.userId);
    if (!account) return reply.code(404).send({ error: "no slack account connected" });
    try {
      const token = decrypt((account.credentials as { userToken: string }).userToken);
      return { channels: await memberChannels(token) };
    } catch (err) {
      if (String(err).includes("missing_scope")) {
        return reply.code(409).send({ error: "reconnect_required" });
      }
      throw err;
    }
  });

  /**
   * Generate the digest. Default = only if today's is missing (called on app
   * startup); force = the manual refresh button. Runs on the queue; the
   * client polls GET /slack/digest and gets a notification when done.
   */
  app.post("/slack/digest/refresh", { onRequest: [app.authenticate] }, async (req, reply) => {
    const account = await slackAccountFor(req.userId);
    if (!account) return reply.code(404).send({ error: "no slack account connected" });
    const { force } = (req.body ?? {}) as { force?: boolean };
    await enqueue("slack-digest", { digest: { userId: req.userId, force: force === true } });
    return reply.code(202).send({ queued: true });
  });

  app.put("/slack/digest/settings", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { excludedChannels } = SlackDigestSettingsRequest.parse(req.body);
    const account = await slackAccountFor(req.userId);
    if (!account) return reply.code(404).send({ error: "no slack account connected" });
    const settings = { ...(account.settings as object), digestExcludedChannels: excludedChannels };
    await db
      .update(schema.integrationAccounts)
      .set({ settings })
      .where(eq(schema.integrationAccounts.id, account.id));
    return { excludedChannels };
  });

  /** Browser entry point (same pattern as Google). */
  app.get("/integrations/slack/connect", async (req, reply) => {
    if (!slackConfigured()) {
      return reply.code(503).send({ error: "Slack app not configured (SLACK_* env vars)" });
    }
    const { token } = req.query as { token?: string };
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token ?? "").sub;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const state = app.jwt.sign({ sub: userId, purpose: "slack-oauth" }, { expiresIn: "10m" });
    return reply.redirect(authUrl(state));
  });

  app.get("/integrations/slack/callback", async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      return reply.type("text/html").send(resultPage(false, error ?? "missing code"));
    }
    let userId: string;
    try {
      const payload = app.jwt.verify<{ sub: string; purpose?: string }>(state);
      if (payload.purpose !== "slack-oauth") throw new Error("wrong purpose");
      userId = payload.sub;
    } catch {
      return reply.code(401).type("text/html").send(resultPage(false, "invalid state"));
    }

    const result = await exchangeCode(code);
    const externalId = `${result.teamId}:${result.slackUserId}`;

    const existing = await db.query.integrationAccounts.findFirst({
      where: and(
        eq(schema.integrationAccounts.userId, userId),
        eq(schema.integrationAccounts.provider, "slack"),
        eq(schema.integrationAccounts.externalId, externalId),
      ),
    });
    if (existing) {
      await db
        .update(schema.integrationAccounts)
        .set({ credentials: credentialsFor(result) })
        .where(eq(schema.integrationAccounts.id, existing.id));
    } else {
      await db.insert(schema.integrationAccounts).values({
        id: ulid(),
        userId,
        provider: "slack",
        externalId,
        credentials: credentialsFor(result),
        settings: {},
      });
    }
    return reply
      .type("text/html")
      .send(resultPage(true, `Slack (${result.teamName}) — react with :${CAPTURE_EMOJI}: to capture`));
  });
}
