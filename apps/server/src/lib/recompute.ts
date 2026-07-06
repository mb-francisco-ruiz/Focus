import { and, eq, inArray, not } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { bucketFor, computePriorityScore } from "./priority.js";
import { serializeTask } from "./serialize.js";

type TaskRow = typeof schema.tasks.$inferSelect;

async function applyPriority(task: TaskRow): Promise<void> {
  const score = computePriorityScore({
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    aiScore: task.aiImportance,
  });
  const bucket = bucketFor(score);
  if (score === task.priorityScore && bucket === task.priority) return;

  const [row] = await db
    .update(schema.tasks)
    .set({ priorityScore: score, priority: bucket, updatedAt: new Date() })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  publish(task.userId, { type: "task.upserted", task: serializeTask(row!) });
}

export async function recomputeTaskPriority(taskId: string): Promise<void> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task || task.priorityOverridden) return;
  await applyPriority(task);
}

export async function recomputeAllPriorities(): Promise<void> {
  const open = await db.query.tasks.findMany({
    where: and(
      not(schema.tasks.priorityOverridden),
      inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
    ),
  });
  for (const task of open) {
    await applyPriority(task);
  }
}
