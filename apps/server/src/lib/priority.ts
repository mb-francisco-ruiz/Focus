import type { PriorityBucket } from "@focus/shared";

/**
 * Priority engine (PLAN.md §5.2): deterministic base from due-date proximity
 * and staleness, AI importance as an adjustment on top — never the whole score.
 * Callers must skip tasks with priorityOverridden: the override always wins.
 */

const DAY_MS = 86_400_000;

export function computePriorityScore(input: {
  dueAt: Date | null;
  createdAt: Date;
  /** 0-100 importance from enrichment, null before first enrichment. */
  aiScore: number | null;
  now?: Date;
}): number {
  const now = input.now ?? new Date();

  let base: number;
  if (input.dueAt) {
    const hoursLeft = (input.dueAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= 0) base = 95;
    else if (hoursLeft <= 24) base = 85;
    else if (hoursLeft <= 48) base = 72;
    else if (hoursLeft <= 168) base = 55;
    else base = 35;
  } else {
    base = 30;
  }

  // Stale items creep up so nothing rots silently in the inbox.
  const staleDays = Math.floor((now.getTime() - input.createdAt.getTime()) / DAY_MS);
  base += Math.min(10, Math.floor(staleDays / 3));

  if (input.aiScore !== null) {
    base += (input.aiScore - 50) * 0.4;
  }

  return Math.max(0, Math.min(100, Math.round(base)));
}

export function bucketFor(score: number): PriorityBucket {
  if (score >= 70) return "P1";
  if (score >= 40) return "P2";
  return "P3";
}
