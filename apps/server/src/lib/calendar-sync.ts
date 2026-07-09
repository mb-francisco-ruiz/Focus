import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { accessTokenFor, upsertEvent, type EventBound } from "./google.js";

/**
 * One-way task → Google Calendar sync (per-task opt-in). Mirrors a task with a
 * due date onto the user's chosen Google account's primary calendar. Completed
 * tasks keep their event, retitled with a ✓. All failures are swallowed +
 * logged so a calendar problem never breaks a task edit.
 */

const EVENT_MINUTES = 30;

/** yyyy-mm-dd for a Date in the given timezone (en-CA → ISO-ish date). */
function dateInTz(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

export async function syncTaskToCalendar(taskId: string): Promise<void> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task || !task.calendarSync || !task.dueAt) return;

  const accounts = await db.query.integrationAccounts.findMany({
    where: and(
      eq(schema.integrationAccounts.userId, task.userId),
      eq(schema.integrationAccounts.provider, "google"),
    ),
  });
  if (accounts.length === 0) return;

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, task.userId) });
  const account = accounts.find((a) => a.id === user?.calendarAccountId) ?? accounts[0]!;

  const done = task.status === "done" || task.status === "archived";
  const summary = `${done ? "✓ " : ""}${task.title}`;

  let start: EventBound;
  let end: EventBound;
  if (task.dueHasTime) {
    const t = task.dueAt.getTime();
    start = { dateTime: new Date(t).toISOString() };
    end = { dateTime: new Date(t + EVENT_MINUTES * 60_000).toISOString() };
  } else {
    const tz = user?.timezone ?? "UTC";
    start = { date: dateInTz(task.dueAt, tz) };
    // Google all-day end is exclusive → next day.
    end = { date: dateInTz(new Date(task.dueAt.getTime() + 86_400_000), tz) };
  }

  // If the target account changed since we last synced, create a fresh event.
  const eventId = task.gcalAccountId === account.id ? task.gcalEventId : null;

  try {
    const token = await accessTokenFor(account);
    const id = await upsertEvent(token, { eventId, summary, start, end });
    await db
      .update(schema.tasks)
      .set({ gcalEventId: id, gcalAccountId: account.id })
      .where(eq(schema.tasks.id, taskId));
  } catch (err) {
    console.error(`calendar sync failed for task ${taskId}`, err);
  }
}
