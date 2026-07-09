import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { CreateRoutineRequest, UpdateRoutineRequest } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { computeNextRun, serializeRoutine } from "../lib/routines.js";

export async function routineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/routines", async (req) => {
    const rows = await db.query.routines.findMany({
      where: eq(schema.routines.userId, req.userId),
      orderBy: [desc(schema.routines.createdAt)],
    });
    return { routines: rows.map(serializeRoutine) };
  });

  app.post("/routines", async (req, reply) => {
    const body = CreateRoutineRequest.parse(req.body);
    // First occurrence: next matching slot from now.
    const nextRunAt = computeNextRun(
      body.cadence,
      body.interval,
      body.weekday,
      body.dayOfMonth,
      new Date(),
    );
    const [row] = await db
      .insert(schema.routines)
      .values({ id: ulid(), userId: req.userId, ...body, nextRunAt })
      .returning();
    return reply.code(201).send(serializeRoutine(row!));
  });

  app.patch("/routines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateRoutineRequest.parse(req.body);
    const existing = await db.query.routines.findFirst({
      where: and(eq(schema.routines.id, id), eq(schema.routines.userId, req.userId)),
    });
    if (!existing) return reply.code(404).send({ error: "routine not found" });

    // Recompute schedule if any cadence field changed.
    const cadence = patch.cadence ?? existing.cadence;
    const interval = patch.interval ?? existing.interval;
    const weekday = patch.weekday !== undefined ? patch.weekday : existing.weekday;
    const dayOfMonth = patch.dayOfMonth !== undefined ? patch.dayOfMonth : existing.dayOfMonth;
    const scheduleChanged =
      patch.cadence !== undefined ||
      patch.interval !== undefined ||
      patch.weekday !== undefined ||
      patch.dayOfMonth !== undefined;

    const [row] = await db
      .update(schema.routines)
      .set({
        ...patch,
        ...(scheduleChanged
          ? { nextRunAt: computeNextRun(cadence, interval, weekday, dayOfMonth, new Date()) }
          : {}),
      })
      .where(eq(schema.routines.id, id))
      .returning();
    return serializeRoutine(row!);
  });

  app.delete("/routines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .delete(schema.routines)
      .where(and(eq(schema.routines.id, id), eq(schema.routines.userId, req.userId)));
    return reply.code(204).send();
  });
}
