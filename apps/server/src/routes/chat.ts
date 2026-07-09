import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or, ilike } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { runAssistant, type AssistantTool } from "@focus/ai";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "../lib/ai-key.js";
import { publish } from "../lib/bus.js";
import { recordEvent } from "../lib/events.js";
import { enqueue } from "../lib/queue.js";
import { recallMemory } from "../lib/memory.js";
import { computeNextRun } from "../lib/routines.js";
import { serializeTask } from "../lib/serialize.js";

const SCORE: Record<"P1" | "P2" | "P3", number> = { P1: 85, P2: 55, P3: 20 };

const ChatRequest = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1)
    .max(40),
});

function compact(t: typeof schema.tasks.$inferSelect) {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    sphere: t.sphere,
    status: t.status,
    blocked: t.blocked,
    dueAt: t.dueAt?.toISOString() ?? null,
  };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/chat", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { messages } = ChatRequest.parse(req.body);
    const userId = req.userId;
    const apiKey = await aiKeyFor(userId);
    if (!apiKey) {
      return reply.code(503).send({ error: "AI not configured" });
    }
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    const spheres = user?.spheres?.length ? user.spheres : ["work", "personal"];
    const now = new Date().toLocaleString("sv-SE", { timeZone: user?.timezone ?? "UTC" });

    const tools: Record<string, AssistantTool> = {
      search_tasks: {
        description: "Search the user's tasks. Omit query for all open tasks.",
        inputSchema: z.object({
          query: z.string().optional(),
          includeDone: z.boolean().optional(),
        }),
        execute: async ({ query, includeDone }) => {
          const conds = [eq(schema.tasks.userId, userId)];
          if (!includeDone) conds.push(inArray(schema.tasks.status, ["inbox", "active", "waiting"]));
          const q = (query as string | undefined)?.trim();
          if (q) conds.push(or(ilike(schema.tasks.title, `%${q}%`), ilike(schema.tasks.rawInput, `%${q}%`))!);
          const rows = await db.query.tasks.findMany({
            where: and(...conds),
            orderBy: [schema.tasks.priority, desc(schema.tasks.priorityScore)],
            limit: 40,
          });
          return rows.map(compact);
        },
      },
      create_task: {
        description: "Capture a new task from natural language. It is enriched by AI automatically.",
        inputSchema: z.object({ text: z.string().min(1) }),
        execute: async ({ text }) => {
          const [row] = await db
            .insert(schema.tasks)
            .values({ id: ulid(), userId, rawInput: text as string, title: text as string })
            .returning();
          await recordEvent(userId, "task.captured", row!.id, { via: "assistant" });
          await enqueue("enrich", { taskId: row!.id });
          publish(userId, { type: "task.upserted", task: serializeTask(row!) });
          return compact(row!);
        },
      },
      update_task: {
        description:
          "Update a task by id: priority (P1/P2/P3), status (inbox/active/waiting/done/archived), sphere, blocked, or dueAt (ISO or null).",
        inputSchema: z.object({
          id: z.string(),
          priority: z.enum(["P1", "P2", "P3"]).optional(),
          status: z.enum(["inbox", "active", "waiting", "done", "archived"]).optional(),
          sphere: z.string().optional(),
          blocked: z.boolean().optional(),
          dueAt: z.string().nullable().optional(),
        }),
        execute: async (args) => {
          const id = args.id as string;
          const owned = await db.query.tasks.findFirst({
            where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)),
          });
          if (!owned) return { error: "task not found" };
          const priority = args.priority as "P1" | "P2" | "P3" | undefined;
          const [row] = await db
            .update(schema.tasks)
            .set({
              ...(args.status !== undefined ? { status: args.status as typeof owned.status } : {}),
              ...(args.blocked !== undefined ? { blocked: args.blocked as boolean } : {}),
              ...(args.sphere !== undefined
                ? { sphere: args.sphere as string, sphereOverridden: true }
                : {}),
              ...(priority ? { priority, priorityScore: SCORE[priority], priorityOverridden: true } : {}),
              ...(args.dueAt !== undefined
                ? {
                    dueAt: args.dueAt ? new Date(args.dueAt as string) : null,
                    dueAtOverridden: true,
                    dueSoonNotifiedAt: null,
                    overdueNotifiedAt: null,
                  }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, id))
            .returning();
          await recordEvent(userId, "task.updated", id, { via: "assistant" });
          publish(userId, { type: "task.upserted", task: serializeTask(row!) });
          return compact(row!);
        },
      },
      recall_memory: {
        description: "Recall what Focus has learned about the user (preferences, entities, patterns).",
        inputSchema: z.object({ query: z.string().optional() }),
        execute: async ({ query }) => recallMemory(userId, (query as string) ?? null, { limit: 12 }),
      },
      create_routine: {
        description: "Create a recurring task. cadence: daily|weekly|monthly.",
        inputSchema: z.object({
          title: z.string(),
          sphere: z.string().optional(),
          priority: z.enum(["P1", "P2", "P3"]).optional(),
          cadence: z.enum(["daily", "weekly", "monthly"]),
          interval: z.number().int().min(1).max(52).optional(),
          weekday: z.number().int().min(0).max(6).nullable().optional(),
          dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
        }),
        execute: async (a) => {
          const cadence = a.cadence as "daily" | "weekly" | "monthly";
          const interval = (a.interval as number) ?? 1;
          const weekday = (a.weekday as number | null) ?? null;
          const dayOfMonth = (a.dayOfMonth as number | null) ?? null;
          const [row] = await db
            .insert(schema.routines)
            .values({
              id: ulid(),
              userId,
              title: a.title as string,
              sphere: (a.sphere as string) ?? spheres[0]!,
              priority: (a.priority as "P1" | "P2" | "P3") ?? "P2",
              cadence,
              interval,
              weekday,
              dayOfMonth,
              nextRunAt: computeNextRun(cadence, interval, weekday, dayOfMonth, new Date()),
            })
            .returning();
          return { id: row!.id, title: row!.title, cadence: row!.cadence };
        },
      },
    };

    const system = `You are Focus, the user's personal work-and-life assistant. Today is ${now} (their timezone).
Their task categories are: ${spheres.join(", ")}.
Use the tools to read and manage their tasks, routines and memory — always act via tools rather than guessing.
Be concise and practical. Reply in the user's language. When you change something, confirm briefly what you did.`;

    try {
      const reply = await runAssistant({ system, messages, tools, apiKey });
      return { reply };
    } catch (err) {
      const msg = String(err);
      if (msg.includes("quota") || msg.includes("429")) {
        return reply.code(200).send({ reply: "I'm out of AI quota for now — try again later." });
      }
      app.log.error({ err }, "assistant failed");
      return reply.code(500).send({ error: "assistant failed" });
    }
  });
}
