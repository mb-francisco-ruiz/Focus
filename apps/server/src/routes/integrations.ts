import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { IntegrationAccountInfo } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { authUrl, exchangeCode, googleConfigured, toStoredCredentials } from "../lib/google.js";
import { slackConfigured } from "../lib/slack.js";

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  /** Connected accounts (auth via header). */
  app.get("/integrations", { onRequest: [app.authenticate] }, async (req) => {
    const rows = await db.query.integrationAccounts.findMany({
      where: eq(schema.integrationAccounts.userId, req.userId),
    });
    const accounts: IntegrationAccountInfo[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      externalId: r.externalId,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      accounts,
      googleConfigured: googleConfigured(),
      slackConfigured: slackConfigured(),
    };
  });

  app.delete("/integrations/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .delete(schema.integrationAccounts)
      .where(
        and(eq(schema.integrationAccounts.id, id), eq(schema.integrationAccounts.userId, req.userId)),
      );
    return reply.code(204).send();
  });

  /**
   * Browser entry point (opened from the desktop app), so auth is a token
   * query param; state carries a short-lived JWT to survive the redirect.
   */
  app.get("/integrations/google/connect", async (req, reply) => {
    if (!googleConfigured()) {
      return reply.code(503).send({ error: "Google OAuth not configured (GOOGLE_CLIENT_ID/SECRET)" });
    }
    const { token } = req.query as { token?: string };
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token ?? "").sub;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const state = app.jwt.sign({ sub: userId, purpose: "google-oauth" }, { expiresIn: "10m" });
    return reply.redirect(authUrl(state));
  });

  app.get("/integrations/google/callback", async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      return reply.type("text/html").send(resultPage(false, error ?? "missing code"));
    }
    let userId: string;
    try {
      const payload = app.jwt.verify<{ sub: string; purpose?: string }>(state);
      if (payload.purpose !== "google-oauth") throw new Error("wrong purpose");
      userId = payload.sub;
    } catch {
      return reply.code(401).type("text/html").send(resultPage(false, "invalid state"));
    }

    const tokens = await exchangeCode(code);

    // One row per (user, google account) — reconnecting refreshes credentials.
    const existing = await db.query.integrationAccounts.findFirst({
      where: and(
        eq(schema.integrationAccounts.userId, userId),
        eq(schema.integrationAccounts.provider, "google"),
        eq(schema.integrationAccounts.externalId, tokens.email),
      ),
    });
    if (existing) {
      await db
        .update(schema.integrationAccounts)
        .set({ credentials: toStoredCredentials(tokens) })
        .where(eq(schema.integrationAccounts.id, existing.id));
    } else {
      await db.insert(schema.integrationAccounts).values({
        id: ulid(),
        userId,
        provider: "google",
        externalId: tokens.email,
        credentials: toStoredCredentials(tokens),
        settings: {},
      });
    }
    return reply.type("text/html").send(resultPage(true, tokens.email));
  });

}

export function resultPage(ok: boolean, detail: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Focus</title>
<body style="font-family:-apple-system,sans-serif;background:#0c0e13;color:#e7eaf2;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
<h2>${ok ? "✓ Connected" : "✗ Connection failed"}</h2>
<p style="color:#8b93a7">${ok ? `${detail} is linked to Focus.` : detail}</p>
<p style="color:#8b93a7">You can close this window and return to the app.</p>
</div></body>`;
}
