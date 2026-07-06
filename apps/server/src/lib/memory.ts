import { and, cosineDistance, desc, eq, gte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { distillPrompt, embedText, generateStructured } from "@focus/ai";
import { Distillation } from "@focus/shared";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";

const DAY_MS = 86_400_000;

/**
 * Memory tier 3 (PLAN.md §6): nightly distillation of the event log into
 * durable records. Suppressed records stay in the prompt's "existing" list so
 * deleted facts don't get re-derived.
 */
export async function distillMemory(): Promise<void> {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return;

  const users = await db.query.users.findMany();
  for (const user of users) {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const events = await db.query.events.findMany({
      where: and(eq(schema.events.userId, user.id), gte(schema.events.createdAt, since)),
      orderBy: [schema.events.createdAt],
      limit: 300,
    });
    if (events.length < 5) continue; // not enough signal yet

    const existing = await db.query.memoryRecords.findMany({
      where: eq(schema.memoryRecords.userId, user.id),
    });

    const { records } = await generateStructured(
      "distill",
      Distillation,
      distillPrompt({
        events: events.map(
          (e) => `${e.createdAt.toISOString().slice(0, 16)} ${e.type} ${summarizePayload(e)}`,
        ),
        existingRecords: existing.map((r) => `[${r.kind}] ${r.content}`),
      }),
    );

    for (const record of records) {
      const embedding = await embedText(record.content).catch(() => null);
      await db.insert(schema.memoryRecords).values({
        id: ulid(),
        userId: user.id,
        kind: record.kind,
        content: record.content,
        provenance: events.slice(-50).map((e) => e.id),
        ...(embedding ? { embedding } : {}),
      });
    }
  }
}

function summarizePayload(event: typeof schema.events.$inferSelect): string {
  const p = event.payload as Record<string, unknown>;
  const bits: string[] = [];
  for (const key of ["rawInput", "via", "from", "to", "kind", "source"]) {
    if (p[key] !== undefined) bits.push(`${key}=${JSON.stringify(p[key])}`);
  }
  if (p.enrichment) {
    const e = p.enrichment as { sphere?: string; priority?: string };
    bits.push(`sphere=${e.sphere} priority=${e.priority}`);
  }
  return bits.join(" ").slice(0, 200);
}

/**
 * Retrieval (PLAN.md §6): active records for a user, semantically ranked
 * against `query` when embeddings exist, newest-first otherwise.
 */
export async function recallMemory(
  userId: string,
  query: string | null,
  opts: { kind?: "entity" | "preference" | "pattern" | "outcome"; limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 8;
  const base = and(
    eq(schema.memoryRecords.userId, userId),
    eq(schema.memoryRecords.suppressed, false),
    ...(opts.kind ? [eq(schema.memoryRecords.kind, opts.kind)] : []),
  );

  if (query && env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const queryEmbedding = await embedText(query).catch(() => null);
    if (queryEmbedding) {
      const rows = await db
        .select({ content: schema.memoryRecords.content })
        .from(schema.memoryRecords)
        .where(and(base, sql`${schema.memoryRecords.embedding} IS NOT NULL`))
        .orderBy(cosineDistance(schema.memoryRecords.embedding, queryEmbedding))
        .limit(limit);
      if (rows.length > 0) return rows.map((r) => r.content);
    }
  }

  const rows = await db.query.memoryRecords.findMany({
    where: base,
    orderBy: [desc(schema.memoryRecords.createdAt)],
    limit,
  });
  return rows.map((r) => r.content);
}
