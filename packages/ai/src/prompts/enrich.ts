/**
 * Prompt v1 for the enrich capability (classification + due date + priority).
 * Versioned in-repo per PLAN.md §3.3; memory-layer context is injected as
 * `memoryContext` once retrieval exists (Phase 3).
 */
export function enrichPrompt(input: {
  rawInput: string;
  now: string; // ISO datetime, user's timezone
  memoryContext?: string;
}): string {
  return `You classify and enrich tasks for a personal productivity tool.

Current datetime (user timezone): ${input.now}

${input.memoryContext ? `What you know about this user:\n${input.memoryContext}\n` : ""}\
The user captured this task in natural language:

"""
${input.rawInput}
"""

Produce the structured enrichment:
- title: short imperative phrasing of the task itself
- sphere: work | personal | family | other
- tags: up to 5 lowercase topical tags
- dueAt: explicit or strongly implied deadline as ISO datetime, else null. \
"before Friday" means the upcoming Friday end of day.
- priority + priorityScore (0-100): urgency from deadline proximity and \
importance signals in the text (who is asking, what it blocks). \
P0 >= 90 drop-everything, P1 >= 70 today/tomorrow, P2 >= 40 this week, P3 otherwise.
- reasoning: one sentence.`;
}
