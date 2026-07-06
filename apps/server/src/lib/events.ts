import { ulid } from "ulid";
import type { EventType } from "@focus/shared";
import { db, schema } from "../db/index.js";

/**
 * Memory layer tier 1 (PLAN.md §6): every meaningful mutation records an event.
 * Cheap, append-only, and the ground truth distillation derives from —
 * call this from every route/job that changes user-visible state.
 */
export async function recordEvent(
  userId: string,
  type: EventType,
  entityId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(schema.events).values({
    id: ulid(),
    userId,
    type,
    entityId,
    payload,
  });
}
