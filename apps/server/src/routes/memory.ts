import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ulid } from "ulid";
import { AddMemoryRecordRequest, SpherePreferences, type MemoryRecordInfo } from "@focus/shared";
import { embedText } from "@focus/ai";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "../lib/ai-key.js";
import { recordEvent } from "../lib/events.js";

/** Embed text with the user's key, or null when AI isn't configured for them. */
async function embedFor(userId: string, content: string): Promise<number[] | null> {
  const key = await aiKeyFor(userId);
  return key ? embedText(content, key).catch(() => null) : null;
}

/** Intelligence: viewable/deletable memory + behaviour preferences (PLAN.md §6). */
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
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.userId) });
    return {
      records,
      preferences: { work: user?.preferences.work ?? "", personal: user?.preferences.personal ?? "" },
    };
  });

  /** Manually taught facts (e.g. entities) enter the same memory store. */
  app.post("/memory", async (req, reply) => {
    const { kind, content } = AddMemoryRecordRequest.parse(req.body);
    const embedding = await embedFor(req.userId, content);
    const [row] = await db
      .insert(schema.memoryRecords)
      .values({
        id: ulid(),
        userId: req.userId,
        kind,
        content,
        provenance: [],
        ...(embedding ? { embedding } : {}),
      })
      .returning();
    return reply.code(201).send({
      id: row!.id,
      kind: row!.kind,
      content: row!.content,
      createdAt: row!.createdAt.toISOString(),
    } satisfies MemoryRecordInfo);
  });

  /** Behaviour instructions per sphere — injected into every AI prompt. */
  app.put("/memory/preferences", async (req) => {
    const preferences = SpherePreferences.parse(req.body);
    await db
      .update(schema.users)
      .set({ preferences })
      .where(eq(schema.users.id, req.userId));
    await recordEvent(req.userId, "task.updated", null, { preferencesChanged: true });
    return { preferences };
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

  /** Edit a memory's text (re-embed so retrieval stays accurate). */
  app.patch("/memory/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { content } = z.object({ content: z.string().min(1).max(500) }).parse(req.body);
    const embedding = await embedFor(req.userId, content);
    const [row] = await db
      .update(schema.memoryRecords)
      .set({ content, ...(embedding ? { embedding } : {}), updatedAt: new Date() })
      .where(and(eq(schema.memoryRecords.id, id), eq(schema.memoryRecords.userId, req.userId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    } satisfies MemoryRecordInfo;
  });
}
