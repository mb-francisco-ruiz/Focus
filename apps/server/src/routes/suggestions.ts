import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Suggestion } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { publish } from "../lib/bus.js";
import { recordEvent } from "../lib/events.js";
import { enqueue } from "../lib/queue.js";
import { serializeTask } from "../lib/serialize.js";

function serialize(row: typeof schema.suggestions.$inferSelect): Suggestion {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source,
    accountId: row.accountId,
    title: row.title,
    reason: row.reason,
    excerpt: row.excerpt,
    sourceRef: row.sourceRef as Record<string, unknown>,
    status: row.status,
    taskId: row.taskId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/suggestions", async (req) => {
    const rows = await db.query.suggestions.findMany({
      where: and(
        eq(schema.suggestions.userId, req.userId),
        eq(schema.suggestions.status, "pending"),
      ),
      orderBy: [desc(schema.suggestions.createdAt)],
      limit: 50,
    });
    return { suggestions: rows.map(serialize) };
  });

  /** Accept: becomes a real task through the normal capture+enrich pipeline. */
  app.post("/suggestions/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const suggestion = await db.query.suggestions.findFirst({
      where: and(eq(schema.suggestions.id, id), eq(schema.suggestions.userId, req.userId)),
    });
    if (!suggestion || suggestion.status !== "pending") {
      return reply.code(404).send({ error: "suggestion not found or already reviewed" });
    }

    const [task] = await db
      .insert(schema.tasks)
      .values({
        id: ulid(),
        userId: req.userId,
        rawInput: `${suggestion.title}\n(from ${suggestion.source}: ${suggestion.excerpt})`,
        title: suggestion.title,
      })
      .returning();
    await db.insert(schema.contextItems).values({
      id: ulid(),
      taskId: task!.id,
      kind: suggestion.source === "gmail" ? "email" : "slack_message",
      body: suggestion.excerpt,
      sourceRef: suggestion.sourceRef,
    });
    await db
      .update(schema.suggestions)
      .set({ status: "accepted", taskId: task!.id })
      .where(eq(schema.suggestions.id, id));

    // Accept/dismiss are the memory layer's precision signal (PLAN.md §6).
    await recordEvent(req.userId, "suggestion.accepted", id, {
      source: suggestion.source,
      taskId: task!.id,
    });
    await recordEvent(req.userId, "task.captured", task!.id, { via: "suggestion" });
    await enqueue("enrich", { taskId: task!.id });

    const serialized = serializeTask(task!);
    publish(req.userId, { type: "task.upserted", task: serialized });
    publish(req.userId, { type: "suggestion.changed" });
    return reply.code(201).send(serialized);
  });

  app.post("/suggestions/:id/dismiss", async (req, reply) => {
    const { id } = req.params as { id: string };
    const suggestion = await db.query.suggestions.findFirst({
      where: and(eq(schema.suggestions.id, id), eq(schema.suggestions.userId, req.userId)),
    });
    if (!suggestion || suggestion.status !== "pending") {
      return reply.code(404).send({ error: "suggestion not found or already reviewed" });
    }
    await db
      .update(schema.suggestions)
      .set({ status: "dismissed" })
      .where(eq(schema.suggestions.id, id));
    await recordEvent(req.userId, "suggestion.dismissed", id, {
      source: suggestion.source,
      from: (suggestion.sourceRef as { from?: string }).from,
    });
    publish(req.userId, { type: "suggestion.changed" });
    return reply.code(204).send();
  });
}
