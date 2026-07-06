import type { Task } from "@focus/shared";
import type { schema } from "../db/index.js";

type TaskRow = typeof schema.tasks.$inferSelect;

export function serializeTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.userId,
    rawInput: row.rawInput,
    title: row.title,
    sphere: row.sphere,
    sphereOverridden: row.sphereOverridden,
    tags: row.tags,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueAtOverridden: row.dueAtOverridden,
    priority: row.priority,
    priorityScore: row.priorityScore,
    priorityOverridden: row.priorityOverridden,
    enrichedAt: row.enrichedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
