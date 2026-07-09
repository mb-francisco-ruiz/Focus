/**
 * Prompt v2 for the enrich capability (classification + due date + priority +
 * next step). Re-runs whenever context is added to a task, so `contextItems`
 * carries the task's activity feed. Versioned in-repo per PLAN.md §3.3;
 * memory-layer context is injected as `memoryContext` once retrieval exists
 * (Phase 3).
 */
export function enrichPrompt(input: {
  rawInput: string;
  now: string; // ISO datetime, user's timezone
  /** The user's own category list; sphere MUST be one of these. */
  spheres: string[];
  contextItems?: string[];
  memoryContext?: string;
}): string {
  const context = input.contextItems?.length
    ? `\nUpdates and context the user attached to this task, oldest first:\n${input.contextItems
        .map((c) => `- ${c}`)
        .join("\n")}\n`
    : "";
  return `You classify and enrich tasks for a personal productivity tool.

Current datetime (user timezone): ${input.now}

${input.memoryContext ? `What you know about this user:\n${input.memoryContext}\n` : ""}\
The user captured this task in natural language:

"""
${input.rawInput}
"""
${context}
Produce the structured enrichment, weighing the attached context as much as the
original text — new context may raise or lower urgency or change the deadline.
IMPORTANT: keep the user's original language throughout — if the task is in
Spanish, the title and tags must be in Spanish. Never translate, and never add
notes or parentheticals in another language.
- title: short imperative phrasing of the task itself, in the task's own language
- sphere: exactly one of: ${input.spheres.join(" | ")} — the user's own categories; \
pick the best fit, never invent a new one
- tags: up to 5 lowercase topical tags
- dueAt: explicit or strongly implied deadline as ISO datetime, else null. \
"before Friday" means the upcoming Friday end of day. The current datetime above \
is the user's LOCAL time — express dueAt with the matching UTC offset, never "Z", \
so "end of day" stays on the right calendar day.
- priority + priorityScore (0-100): urgency from deadline proximity and \
importance signals in the text and context (who is asking, what it blocks). \
P1 >= 70 high (today/tomorrow or blocking others), P2 >= 40 medium (this week), \
P3 otherwise (low).
- reasoning: one sentence.`;
}
