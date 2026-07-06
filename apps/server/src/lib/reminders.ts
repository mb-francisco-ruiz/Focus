import { and, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { notify } from "./notify.js";

const HOUR_MS = 3_600_000;

/**
 * Runs every minute (PLAN.md §5.4): due-soon reminders one hour before the
 * deadline, overdue nudges once the deadline passes. The *NotifiedAt markers
 * make each fire exactly once per due date (tasks.ts clears them when dueAt moves).
 */
export async function scanReminders(): Promise<void> {
  const now = new Date();

  const dueSoon = await db.query.tasks.findMany({
    where: and(
      inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
      isNotNull(schema.tasks.dueAt),
      lte(schema.tasks.dueAt, new Date(now.getTime() + HOUR_MS)),
      isNull(schema.tasks.dueSoonNotifiedAt),
    ),
  });
  for (const task of dueSoon) {
    const overdue = task.dueAt! <= now;
    await db
      .update(schema.tasks)
      .set(
        overdue
          ? { dueSoonNotifiedAt: now, overdueNotifiedAt: now }
          : { dueSoonNotifiedAt: now },
      )
      .where(sql`${schema.tasks.id} = ${task.id}`);
    await notify(
      task.userId,
      overdue ? "overdue" : "due_soon",
      overdue ? "Overdue" : "Due soon",
      overdue
        ? `"${task.title}" is past its deadline.`
        : `"${task.title}" is due ${task.dueAt!.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
      task.id,
    );
  }

  const overdue = await db.query.tasks.findMany({
    where: and(
      inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
      isNotNull(schema.tasks.dueAt),
      lte(schema.tasks.dueAt, now),
      isNull(schema.tasks.overdueNotifiedAt),
    ),
  });
  for (const task of overdue) {
    await db
      .update(schema.tasks)
      .set({ overdueNotifiedAt: now })
      .where(sql`${schema.tasks.id} = ${task.id}`);
    await notify(
      task.userId,
      "overdue",
      "Overdue",
      `"${task.title}" is past its deadline.`,
      task.id,
    );
  }
}
