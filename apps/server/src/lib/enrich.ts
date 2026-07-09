import { asc, eq } from "drizzle-orm";
import { embedText, enrichPrompt, generateStructured } from "@focus/ai";
import { Enrichment } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { aiKeyFor } from "./ai-key.js";
import { publish } from "./bus.js";
import { recordEvent } from "./events.js";
import { recallMemory } from "./memory.js";
import { bucketFor, computePriorityScore } from "./priority.js";
import { serializeTask } from "./serialize.js";
import { countsFor } from "./subtask-counts.js";

/**
 * Build the enrichment prompt for a task (classification context: user prefs,
 * recalled memory, attached context). Shared by the server path (below) and the
 * local path (`GET /tasks/:id/enrich-request`). `forLocal` appends an explicit
 * JSON-output contract since local execution can't rely on generateObject's
 * schema enforcement. Returns null if the task no longer exists.
 */
export async function buildEnrichPrompt(
  taskId: string,
  opts: { forLocal?: boolean } = {},
): Promise<{ prompt: string; userId: string } | null> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) return null;

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

  // Learned memory + user behaviour instructions sharpen classification.
  const memory = await recallMemory(task.userId, task.rawInput);
  const prefs = user?.preferences ?? {};
  const memoryLines = [
    ...Object.entries(prefs)
      .filter(([, text]) => text)
      .map(([sphere, text]) => `${sphere} instructions from the user: ${text}`),
    ...memory,
  ];

  const spheres = user?.spheres?.length ? user.spheres : ["work", "personal"];
  let prompt = enrichPrompt({
    rawInput: task.rawInput,
    now,
    spheres,
    contextItems,
    memoryContext: memoryLines.length ? memoryLines.map((m) => `- ${m}`).join("\n") : undefined,
  });

  if (opts.forLocal) {
    prompt += `\n\nRespond with ONLY a JSON object — no prose, no markdown fences — of exactly this shape:
{"title": string, "sphere": one of [${spheres.join(", ")}], "tags": string[] (max 5), "dueAt": ISO 8601 datetime with UTC offset (not "Z") or null, "priority": "P1" | "P2" | "P3", "priorityScore": number 0-100, "reasoning": string}`;
  }

  return { prompt, userId: task.userId };
}

/**
 * Apply a validated Enrichment to a task: honor user overrides, rescore, embed
 * (best-effort), persist, and broadcast. Shared by the server and local paths.
 */
export async function applyEnrichment(taskId: string, enrichment: Enrichment): Promise<void> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) return;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, task.userId) });
  const spheres = user?.spheres?.length ? user.spheres : ["work", "personal"];

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

  // Embedding needs the Gemini API (local Claude can't embed) — best-effort via
  // whatever key the user has; skipped silently when none, degrading recall to recency.
  const embedKey = await aiKeyFor(task.userId);
  const embedding = embedKey
    ? await embedText(`${enrichment.title}\n${task.rawInput}`, embedKey).catch(() => null)
    : null;

  const [row] = await db
    .update(schema.tasks)
    .set({
      tags: enrichment.tags,
      aiImportance: enrichment.priorityScore,
      // suggestions disabled — clear any stale ones as tasks re-enrich
      aiSuggestion: null,
      aiSuggestionDetail: null,
      ...(task.titleOverridden ? {} : { title: enrichment.title }),
      // model must pick from the user's categories; fall back to the first
      ...(task.sphereOverridden
        ? {}
        : { sphere: spheres.includes(enrichment.sphere) ? enrichment.sphere : spheres[0]! }),
      ...(task.dueAtOverridden ? {} : { dueAt }),
      ...(task.priorityOverridden ? {} : { priority: bucketFor(score), priorityScore: score }),
      ...(embedding ? { embedding } : {}),
      enrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  await recordEvent(task.userId, "task.enriched", taskId, { enrichment });
  publish(task.userId, {
    type: "task.upserted",
    task: serializeTask(row!, await countsFor(taskId)),
  });
}

/**
 * Server-side enrichment (PLAN.md §5.1): the queue path. Builds the prompt,
 * runs the model on the user's key, applies the result. No-ops when the task
 * is gone, already enriched, or the user has no AI configured.
 */
export async function enrichTask(taskId: string): Promise<void> {
  const built = await buildEnrichPrompt(taskId);
  if (!built) return;

  const apiKey = await aiKeyFor(built.userId);
  if (!apiKey) return; // AI not configured for this user

  const enrichment = await generateStructured("enrich", Enrichment, built.prompt, { apiKey });
  await applyEnrichment(taskId, enrichment);
}
