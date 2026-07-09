import type { PriorityBucket, Task } from "@focus/shared";
import type { schema } from "../db/index.js";

export const PRIORITY_ORDER: Record<PriorityBucket, number> = { P1: 0, P2: 1, P3: 2 };

type TaskRow = typeof schema.tasks.$inferSelect;

export function serializeTask(
  row: TaskRow,
  subtasks: { total: number; done: number } = { total: 0, done: 0 },
): Task {
  return {
    id: row.id,
    userId: row.userId,
    rawInput: row.rawInput,
    title: row.title,
    titleOverridden: row.titleOverridden,
    sphere: row.sphere,
    sphereOverridden: row.sphereOverridden,
    tags: row.tags,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueAtOverridden: row.dueAtOverridden,
    dueHasTime: row.dueHasTime,
    calendarSync: row.calendarSync,
    priority: row.priority,
    priorityScore: row.priorityScore,
    priorityOverridden: row.priorityOverridden,
    blocked: row.blocked,
    enrichedAt: row.enrichedAt?.toISOString() ?? null,
    aiSuggestion: row.aiSuggestion,
    aiSuggestionDetail: row.aiSuggestionDetail ?? null,
    subtaskCount: subtasks.total,
    subtaskDone: subtasks.done,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
