import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import type { MemoryRecordInfo } from "@focus/shared";
import { db, schema } from "../db/index.js";

/** "What Focus knows about me" (PLAN.md §6): viewable, deletable memory. */
export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/memory", async (req) => {
    const rows = await db.query.memoryRecords.findMany({
      where: and(
        eq(schema.memoryRecords.userId, req.userId),
        eq(schema.memoryRecords.suppressed, false),
      ),
      orderBy: [desc(schema.memoryRecords.createdAt)],
    });
    const records: MemoryRecordInfo[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));
    return { records };
  });

  /** Suppress, not delete: distillation must not re-derive removed facts. */
  app.delete("/memory/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.memoryRecords)
      .set({ suppressed: true, updatedAt: new Date() })
      .where(
        and(eq(schema.memoryRecords.id, id), eq(schema.memoryRecords.userId, req.userId)),
      );
    return reply.code(204).send();
  });
}
