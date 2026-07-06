import { eq } from "drizzle-orm";
import { embedText, enrichPrompt, generateStructured } from "@focus/ai";
import { Enrichment } from "@focus/shared";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { recordEvent } from "./events.js";
import { bucketFor, computePriorityScore } from "./priority.js";
import { serializeTask } from "./serialize.js";

/**
 * Async enrichment (PLAN.md §5.1): runs on the job queue after capture;
 * patches only fields the user has not overridden, then pushes the delta
 * to connected clients.
 */
export async function enrichTask(taskId: string): Promise<void> {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return; // AI not configured yet

  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) return;

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, task.userId) });
  const now = new Date().toLocaleString("sv-SE", { timeZone: user?.timezone ?? "UTC" });

  const enrichment = await generateStructured(
    "enrich",
    Enrichment,
    enrichPrompt({ rawInput: task.rawInput, now }),
  );

  // Embedding failure must not fail enrichment.
  const embedding = await embedText(`${enrichment.title}\n${task.rawInput}`).catch(() => null);

  const dueAt = task.dueAtOverridden
    ? task.dueAt
    : enrichment.dueAt
      ? new Date(enrichment.dueAt)
      : null;
  const score = computePriorityScore({
    dueAt,
    createdAt: task.createdAt,
    aiScore: enrichment.priorityScore,
  });

  const [row] = await db
    .update(schema.tasks)
    .set({
      title: enrichment.title,
      tags: enrichment.tags,
      aiImportance: enrichment.priorityScore,
      ...(task.sphereOverridden ? {} : { sphere: enrichment.sphere }),
      ...(task.dueAtOverridden ? {} : { dueAt }),
      ...(task.priorityOverridden
        ? {}
        : { priority: bucketFor(score), priorityScore: score }),
      ...(embedding ? { embedding } : {}),
      enrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  await recordEvent(task.userId, "task.enriched", taskId, { enrichment });
  publish(task.userId, { type: "task.upserted", task: serializeTask(row!) });
}
