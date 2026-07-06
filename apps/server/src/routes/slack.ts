import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { enqueue } from "../lib/queue.js";
import {
  authUrl,
  CAPTURE_EMOJI,
  credentialsFor,
  exchangeCode,
  slackConfigured,
} from "../lib/slack.js";
import { resultPage } from "./integrations.js";

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
