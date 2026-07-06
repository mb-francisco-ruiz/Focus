import { publish } from "./bus.js";
import { recordEvent } from "./events.js";

/**
 * Notification delivery (PLAN.md §5.4). WS → native notification when a client
 * is connected; clients that are offline miss it (email fallback needs an SMTP
 * provider — deferred). Every notification is also an event, so the memory
 * layer sees what we nudged about.
 */
export async function notify(
  userId: string,
  kind: string,
  title: string,
  body: string,
  taskId?: string,
): Promise<void> {
  await recordEvent(userId, "reminder.fired", taskId ?? null, { kind, title, body });
  publish(userId, { type: "notification", title, body, taskId });
}
