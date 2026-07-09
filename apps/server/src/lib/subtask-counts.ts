import { inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export type SubtaskCounts = Map<string, { total: number; done: number }>;

/** Aggregated per-task subtask progress for list/WS serialization. */
export async function subtaskCounts(taskIds: string[]): Promise<SubtaskCounts> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({
      taskId: schema.subtasks.taskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${schema.subtasks.done})::int`,
    })
    .from(schema.subtasks)
    .where(inArray(schema.subtasks.taskId, taskIds))
    .groupBy(schema.subtasks.taskId);
  return new Map(rows.map((r) => [r.taskId, { total: r.total, done: r.done }]));
}

export async function countsFor(taskId: string): Promise<{ total: number; done: number }> {
  return (await subtaskCounts([taskId])).get(taskId) ?? { total: 0, done: 0 };
}
