import { asc, eq } from "drizzle-orm";
import { embedText, enrichPrompt, generateStructured } from "@focus/ai";
import { Enrichment } from "@focus/shared";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { recordEvent } from "./events.js";
import { recallMemory } from "./memory.js";
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

  // Context items feed re-enrichment: notes verbatim, attachments by name.
  const context = await db.query.contextItems.findMany({
    where: eq(schema.contextItems.taskId, taskId),
    orderBy: [asc(schema.contextItems.createdAt)],
  });
  const contextItems = context.map((c) =>
    c.kind === "text" || c.kind === "link"
      ? c.body ?? ""
      : `[${c.kind}${c.body ? `: ${c.body}` : ""}]`,
  );

  // Learned memory sharpens classification (entity glossary, preferences).
  const memory = await recallMemory(task.userId, task.rawInput);

  const enrichment = await generateStructured(
    "enrich",
    Enrichment,
    enrichPrompt({
      rawInput: task.rawInput,
      now,
      contextItems,
      memoryContext: memory.length ? memory.map((m) => `- ${m}`).join("\n") : undefined,
    }),
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
      tags: enrichment.tags,
      aiImportance: enrichment.priorityScore,
      aiSuggestion: enrichment.nextStep,
      ...(task.titleOverridden ? {} : { title: enrichment.title }),
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
