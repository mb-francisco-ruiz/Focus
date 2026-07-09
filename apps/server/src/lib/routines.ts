import { and, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import type { Cadence, Routine } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { publish } from "./bus.js";
import { recordEvent } from "./events.js";
import { serializeTask } from "./serialize.js";

type RoutineRow = typeof schema.routines.$inferSelect;

const SCORE: Record<"P1" | "P2" | "P3", number> = { P1: 85, P2: 55, P3: 20 };

export function serializeRoutine(r: RoutineRow): Routine {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    sphere: r.sphere,
    priority: r.priority,
    cadence: r.cadence,
    interval: r.interval,
    weekday: r.weekday,
    dayOfMonth: r.dayOfMonth,
    active: r.active,
    nextRunAt: r.nextRunAt.toISOString(),
    lastSpawnedAt: r.lastSpawnedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Next fire time after `from`, at ~07:00 UTC on the target day. Timezone-simple
 * by design — spawning a routine an hour off is harmless.
 */
export function computeNextRun(
  cadence: Cadence,
  interval: number,
  weekday: number | null,
  dayOfMonth: number | null,
  from: Date,
): Date {
  const base = new Date(from);
  const at = (d: Date) => {
    d.setUTCHours(7, 0, 0, 0);
    return d;
  };
  if (cadence === "daily") {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + interval);
    return at(d);
  }
  if (cadence === "weekly") {
    // 0=Mon..6=Sun → JS getUTCDay 0=Sun..6=Sat
    const target = weekday ?? 0;
    const d = new Date(base);
    for (let i = 1; i <= 7 * interval + 7; i++) {
      d.setUTCDate(base.getUTCDate() + i);
      const jsDow = (d.getUTCDay() + 6) % 7; // Mon-first
      if (jsDow === target && i >= 7 * (interval - 1) + 1) return at(d);
    }
    return at(d);
  }
  // monthly
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + interval, Math.min(dayOfMonth ?? 1, 28));
  return at(d);
}

/** Spawn a task from a routine (fields pre-set, not re-classified by AI). */
async function spawn(routine: RoutineRow): Promise<void> {
  const [task] = await db
    .insert(schema.tasks)
    .values({
      id: ulid(),
      userId: routine.userId,
      rawInput: routine.title,
      title: routine.title,
      titleOverridden: true,
      sphere: routine.sphere,
      sphereOverridden: true,
      priority: routine.priority,
      priorityScore: SCORE[routine.priority],
      priorityOverridden: true,
      enrichedAt: new Date(), // pre-classified — skip the "classifying…" state
    })
    .returning();
  await recordEvent(routine.userId, "task.captured", task!.id, { via: "routine", routineId: routine.id });
  publish(routine.userId, { type: "task.upserted", task: serializeTask(task!) });
}

/** Hourly job: fire every due active routine and advance its schedule. */
export async function runDueRoutines(): Promise<void> {
  const now = new Date();
  const due = await db.query.routines.findMany({
    where: and(eq(schema.routines.active, true), lte(schema.routines.nextRunAt, now)),
  });
  for (const routine of due) {
    try {
      await spawn(routine);
      await db
        .update(schema.routines)
        .set({
          lastSpawnedAt: now,
          nextRunAt: computeNextRun(
            routine.cadence,
            routine.interval,
            routine.weekday,
            routine.dayOfMonth,
            now,
          ),
        })
        .where(eq(schema.routines.id, routine.id));
    } catch (err) {
      console.error(`routine spawn failed for ${routine.id}`, err);
    }
  }
}
