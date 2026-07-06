import type { FastifyInstance } from "fastify";
import { and, desc, eq, ne } from "drizzle-orm";
import { ulid } from "ulid";
import {
  CreateTaskRequest,
  UpdateTaskRequest,
  type TaskListResponse,
} from "@focus/shared";
import { db, schema } from "../db/index.js";
import { publish } from "../lib/bus.js";
import { recordEvent } from "../lib/events.js";
import { enqueue } from "../lib/queue.js";
import { serializeTask } from "../lib/serialize.js";

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/tasks", async (req): Promise<TaskListResponse> => {
    const rows = await db.query.tasks.findMany({
      where: and(eq(schema.tasks.userId, req.userId), ne(schema.tasks.status, "archived")),
      orderBy: [desc(schema.tasks.priorityScore), desc(schema.tasks.createdAt)],
      limit: 200,
    });
    return { tasks: rows.map(serializeTask) };
  });

  /** Capture: task exists immediately with raw text; enrichment patches it async. */
  app.post("/tasks", async (req, reply) => {
    const { rawInput, clientId } = CreateTaskRequest.parse(req.body);

    if (clientId) {
      const existing = await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, clientId), eq(schema.tasks.userId, req.userId)),
      });
      if (existing) return reply.code(200).send(serializeTask(existing));
    }

    const [row] = await db
      .insert(schema.tasks)
      .values({
        id: clientId ?? ulid(),
        userId: req.userId,
        rawInput,
        title: rawInput.length > 120 ? `${rawInput.slice(0, 117)}…` : rawInput,
      })
      .returning();

    await recordEvent(req.userId, "task.captured", row!.id, { rawInput });

    // Capture never waits on AI (PLAN.md §5.1) — enrichment runs on the queue.
    await enqueue("enrich", { taskId: row!.id });

    const task = serializeTask(row!);
    publish(req.userId, { type: "task.upserted", task });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateTaskRequest.parse(req.body);

    const existing = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, req.userId)),
    });
    if (!existing) return reply.code(404).send({ error: "task not found" });

    // Manual edits to AI-settable fields pin them against re-enrichment.
    const { dueAt, ...rest } = patch;
    const [row] = await db
      .update(schema.tasks)
      .set({
        ...rest,
        ...(dueAt !== undefined
          ? {
              dueAt: dueAt ? new Date(dueAt) : null,
              dueAtOverridden: true,
              // new deadline → reminders may fire again
              dueSoonNotifiedAt: null,
              overdueNotifiedAt: null,
            }
          : {}),
        ...(patch.title !== undefined ? { titleOverridden: true } : {}),
        ...(patch.sphere !== undefined ? { sphereOverridden: true } : {}),
        ...(patch.priority !== undefined ? { priorityOverridden: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id))
      .returning();

    if (patch.priority !== undefined) {
      await recordEvent(req.userId, "task.priority_overridden", id, {
        from: existing.priority,
        to: patch.priority,
      });
    }
    if (patch.sphere !== undefined) {
      await recordEvent(req.userId, "task.sphere_overridden", id, {
        from: existing.sphere,
        to: patch.sphere,
      });
    }
    if (patch.status !== undefined) {
      await recordEvent(
        req.userId,
        patch.status === "done" ? "task.completed" : "task.status_changed",
        id,
        { from: existing.status, to: patch.status },
      );
    }
    await recordEvent(req.userId, "task.updated", id, { patch });

    // Due date moved without a manual priority: proximity changed, rescore.
    if (dueAt !== undefined && !row!.priorityOverridden) {
      await enqueue("recompute-task", { taskId: id });
    }

    const task = serializeTask(row!);
    publish(req.userId, { type: "task.upserted", task });
    return task;
  });
}
