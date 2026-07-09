import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { SyncResponse } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { serializeTask } from "../lib/serialize.js";
import { subtaskCounts } from "../lib/subtask-counts.js";

function parseCursor(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/sync", async (req): Promise<SyncResponse> => {
    const { since } = req.query as { since?: string };
    const cursor = parseCursor(since);

    const rows = await db.query.tasks.findMany({
      where: cursor
        ? and(eq(schema.tasks.userId, req.userId), gt(schema.tasks.updatedAt, cursor))
        : and(eq(schema.tasks.userId, req.userId), ne(schema.tasks.status, "archived")),
      orderBy: [desc(schema.tasks.updatedAt)],
      limit: 500,
    });

    const pendingSuggestions = await db.query.suggestions.findMany({
      where: and(
        eq(schema.suggestions.userId, req.userId),
        eq(schema.suggestions.status, "pending"),
      ),
      columns: { id: true },
    });

    const counts = await subtaskCounts(rows.map((r) => r.id));
    return {
      tasks: rows.map((r) => serializeTask(r, counts.get(r.id))),
      suggestionCount: pendingSuggestions.length,
      nextCursor: new Date().toISOString(),
    };
  });
}
