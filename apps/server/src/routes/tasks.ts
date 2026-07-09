import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { ulid } from "ulid";
import {
  CreateSubtaskRequest,
  CreateTaskRequest,
  Enrichment,
  UpdateSubtaskRequest,
  UpdateTaskRequest,
  type Subtask,
  type TaskListResponse,
} from "@focus/shared";
import { db, schema } from "../db/index.js";
import { applyEnrichment, buildEnrichPrompt } from "../lib/enrich.js";
import { publish } from "../lib/bus.js";
import { recordEvent } from "../lib/events.js";
import { enqueue } from "../lib/queue.js";
import { serializeTask } from "../lib/serialize.js";
import { countsFor, subtaskCounts } from "../lib/subtask-counts.js";

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/tasks", async (req): Promise<TaskListResponse> => {
    const rows = await db.query.tasks.findMany({
      where: and(eq(schema.tasks.userId, req.userId), ne(schema.tasks.status, "archived")),
      // bucket first ('P1'<'P2'<'P3'), then unblocked before blocked, then score
      orderBy: [
        asc(schema.tasks.priority),
        asc(schema.tasks.blocked),
        desc(schema.tasks.priorityScore),
        desc(schema.tasks.createdAt),
      ],
      limit: 200,
    });
    const counts = await subtaskCounts(rows.map((r) => r.id));
    return { tasks: rows.map((r) => serializeTask(r, counts.get(r.id))) };
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
    // Local-mode users enrich on their own desktop; the server only schedules a
    // delayed safety net that no-ops if the client already enriched the task.
    const owner = await db.query.users.findFirst({
      where: eq(schema.users.id, req.userId),
      columns: { aiMode: true },
    });
    if (owner?.aiMode === "local") {
      await enqueue("enrich", { taskId: row!.id, ifUnenriched: true }, { delay: 90_000 });
    } else {
      await enqueue("enrich", { taskId: row!.id });
    }

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
        ...(patch.priority !== undefined
          ? {
              priorityOverridden: true,
              // keep the sort key consistent with the chosen bucket
              priorityScore: { P1: 85, P2: 55, P3: 20 }[patch.priority],
            }
          : {}),
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

    const task = serializeTask(row!, await countsFor(id));
    publish(req.userId, { type: "task.upserted", task });
    return task;
  });

  // ---- Local-mode enrichment (client executes the model) --------------------

  /** The desktop fetches the prepared prompt, runs it through Claude Code... */
  app.get("/tasks/:id/enrich-request", async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, req.userId)),
    });
    if (!owned) return reply.code(404).send({ error: "task not found" });
    const built = await buildEnrichPrompt(id, { forLocal: true });
    if (!built) return reply.code(404).send({ error: "task not found" });
    return { prompt: built.prompt };
  });

  /** ...then posts the model's JSON back; the server validates + applies it. */
  app.post("/tasks/:id/enrich-result", async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, req.userId)),
    });
    if (!owned) return reply.code(404).send({ error: "task not found" });
    const parsed = Enrichment.safeParse((req.body as { enrichment?: unknown })?.enrichment);
    if (!parsed.success) return reply.code(422).send({ error: "invalid enrichment" });
    await applyEnrichment(id, parsed.data);
    const fresh = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
    return serializeTask(fresh!, await countsFor(id));
  });

  // ---- Subtasks -------------------------------------------------------------

  const serializeSubtask = (row: typeof schema.subtasks.$inferSelect): Subtask => ({
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    done: row.done,
    createdAt: row.createdAt.toISOString(),
  });

  /** Re-broadcast the parent so progress counters update everywhere. */
  const publishParent = async (userId: string, taskId: string) => {
    const parent = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
    if (parent) {
      publish(userId, { type: "task.upserted", task: serializeTask(parent, await countsFor(taskId)) });
    }
  };

  app.get("/tasks/:id/subtasks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, req.userId)),
    });
    if (!owned) return reply.code(404).send({ error: "task not found" });
    const rows = await db.query.subtasks.findMany({
      where: eq(schema.subtasks.taskId, id),
      orderBy: [schema.subtasks.createdAt],
    });
    return { subtasks: rows.map(serializeSubtask) };
  });

  app.post("/tasks/:id/subtasks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, req.userId)),
    });
    if (!owned) return reply.code(404).send({ error: "task not found" });
    const { title } = CreateSubtaskRequest.parse(req.body);
    const [row] = await db
      .insert(schema.subtasks)
      .values({ id: ulid(), taskId: id, title })
      .returning();
    await recordEvent(req.userId, "subtask.added", id, { title });
    await publishParent(req.userId, id);
    return reply.code(201).send(serializeSubtask(row!));
  });

  app.patch("/subtasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateSubtaskRequest.parse(req.body);
    const existing = await db
      .select({ sub: schema.subtasks, userId: schema.tasks.userId })
      .from(schema.subtasks)
      .innerJoin(schema.tasks, eq(schema.subtasks.taskId, schema.tasks.id))
      .where(and(eq(schema.subtasks.id, id), eq(schema.tasks.userId, req.userId)))
      .then((r) => r[0]);
    if (!existing) return reply.code(404).send({ error: "subtask not found" });

    const [row] = await db
      .update(schema.subtasks)
      .set(patch)
      .where(eq(schema.subtasks.id, id))
      .returning();
    if (patch.done === true && !existing.sub.done) {
      await recordEvent(req.userId, "subtask.completed", existing.sub.taskId, {
        title: row!.title,
      });
    }
    await publishParent(req.userId, existing.sub.taskId);
    return serializeSubtask(row!);
  });

  app.delete("/subtasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await db
      .select({ taskId: schema.subtasks.taskId })
      .from(schema.subtasks)
      .innerJoin(schema.tasks, eq(schema.subtasks.taskId, schema.tasks.id))
      .where(and(eq(schema.subtasks.id, id), eq(schema.tasks.userId, req.userId)))
      .then((r) => r[0]);
    if (!existing) return reply.code(404).send({ error: "subtask not found" });
    await db.delete(schema.subtasks).where(eq(schema.subtasks.id, id));
    await publishParent(req.userId, existing.taskId);
    return reply.code(204).send();
  });
}
