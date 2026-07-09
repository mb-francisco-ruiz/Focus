import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateStructured, planDayPrompt } from "@focus/ai";
import type { CalendarEventInfo, PlanBlock } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "../lib/ai-key.js";
import { accessTokenFor, listEvents } from "../lib/google.js";

const PlanOutput = z.object({
  blocks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      reason: z.string(),
    }),
  ),
});

/** Local-day window [00:00, 24:00) as ISO, in the user's timezone. */
function dayWindow(date: string, timezone: string): { min: string; max: string } {
  // date is yyyy-mm-dd; derive the day's UTC bounds via the tz offset at noon.
  const noon = new Date(`${date}T12:00:00Z`);
  const local = new Date(noon.toLocaleString("en-US", { timeZone: timezone }));
  const offsetMs = local.getTime() - noon.getTime();
  const startLocalUtc = new Date(`${date}T00:00:00Z`).getTime() - offsetMs;
  return {
    min: new Date(startLocalUtc).toISOString(),
    max: new Date(startLocalUtc + 24 * 3600 * 1000).toISOString(),
  };
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/calendar", async (req) => {
    const { date } = req.query as { date?: string };
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.userId) });
    const day = date ?? new Date().toLocaleDateString("sv-SE", { timeZone: user?.timezone ?? "UTC" });
    const { min, max } = dayWindow(day, user?.timezone ?? "UTC");

    const accounts = await db.query.integrationAccounts.findMany({
      where: and(
        eq(schema.integrationAccounts.userId, req.userId),
        eq(schema.integrationAccounts.provider, "google"),
      ),
    });
    const events: CalendarEventInfo[] = [];
    for (const account of accounts) {
      try {
        const token = await accessTokenFor(account);
        events.push(...(await listEvents(token, account.externalId, min, max)));
      } catch (err) {
        app.log.warn({ err, account: account.externalId }, "calendar fetch failed");
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, connected: accounts.length > 0 };
  });

  /**
   * Build the day-plan prompt: gather today's calendar events + open tasks and
   * format them. Shared by the server path and the local path
   * (`GET /today/plan-request`). `forLocal` appends an explicit JSON contract.
   */
  async function buildPlanPrompt(
    userId: string,
    forLocal: boolean,
  ): Promise<{ prompt: string; taskIds: Set<string> }> {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    const tz = user?.timezone ?? "UTC";
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
    const { min, max } = dayWindow(today, tz);

    const accounts = await db.query.integrationAccounts.findMany({
      where: and(
        eq(schema.integrationAccounts.userId, userId),
        eq(schema.integrationAccounts.provider, "google"),
      ),
    });
    const events = [];
    for (const account of accounts) {
      try {
        events.push(...(await listEvents(await accessTokenFor(account), account.externalId, min, max)));
      } catch {
        /* skip broken account */
      }
    }

    const openTasks = await db.query.tasks.findMany({
      where: and(
        eq(schema.tasks.userId, userId),
        inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
      ),
      orderBy: [schema.tasks.priority],
      limit: 30,
    });

    const now = new Date().toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T");
    let prompt = planDayPrompt({
      now,
      events: events.map((e) => ({ title: e.title, start: e.start, end: e.end })),
      tasks: openTasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
      })),
    });
    if (forLocal) {
      prompt += `\n\nRespond with ONLY a JSON object — no prose, no markdown fences — of exactly this shape:
{"blocks": [{"taskId": string (an id from the list above), "title": string, "start": ISO datetime, "end": ISO datetime, "reason": string}]}
Return {"blocks": []} if there's no meaningful free time.`;
    }
    return { prompt, taskIds: new Set(openTasks.map((t) => t.id)) };
  }

  /** Keep only blocks that reference a real open task. */
  const filterBlocks = (
    blocks: z.infer<typeof PlanOutput>["blocks"],
    taskIds: Set<string>,
  ): PlanBlock[] => blocks.filter((b) => taskIds.has(b.taskId)).map((b) => ({ ...b, taskId: b.taskId }));

  /** AI day plan (server path): schedule today's open tasks around meetings. */
  app.post("/today/plan", async (req, reply) => {
    const apiKey = await aiKeyFor(req.userId);
    if (!apiKey) {
      return reply.code(503).send({ error: "AI not configured" });
    }
    const { prompt, taskIds } = await buildPlanPrompt(req.userId, false);
    const { blocks } = await generateStructured("plan", PlanOutput, prompt, {
      abortSignal: AbortSignal.timeout(60_000),
      apiKey,
    });
    return { blocks: filterBlocks(blocks, taskIds) };
  });

  /** Local path: the desktop fetches the prompt, runs it through Claude Code... */
  app.get("/today/plan-request", async (req) => {
    const { prompt } = await buildPlanPrompt(req.userId, true);
    return { prompt };
  });

  /** ...then posts the model's JSON back; the server validates + filters it. */
  app.post("/today/plan-result", async (req, reply) => {
    const parsed = PlanOutput.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ error: "invalid plan" });
    const open = await db.query.tasks.findMany({
      where: and(
        eq(schema.tasks.userId, req.userId),
        inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
      ),
      columns: { id: true },
    });
    return { blocks: filterBlocks(parsed.data.blocks, new Set(open.map((t) => t.id))) };
  });
}
