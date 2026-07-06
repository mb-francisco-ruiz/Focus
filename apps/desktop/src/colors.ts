import type { PriorityBucket } from "@focus/shared";

/** Display names for priority buckets (data model keeps P1-P3). */
export const PRIORITY_LABELS: Record<PriorityBucket, string> = {
  P1: "High",
  P2: "Medium",
  P3: "Low",
};

export const PRIORITIES: PriorityBucket[] = ["P1", "P2", "P3"];

/** Accent colors (mini-mode dots; row chips use the tinted CSS classes). */
export const PRIORITY_COLORS: Record<PriorityBucket, string> = {
  P1: "#ff6961",
  P2: "#ffb224",
  P3: "#8b93a7",
};
