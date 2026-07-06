/**
 * Prompt v1 for the suggest capability: decide whether an incoming
 * email/message contains a concrete action for the user (PLAN.md §5.3).
 * Precision over recall — a noisy review queue kills trust in day-one
 * auto-suggest. Accept/dismiss history feeds back via memory in Phase 3.
 */
export function suggestPrompt(input: {
  source: "gmail" | "slack";
  from: string;
  subject?: string;
  body: string;
  userEmail: string;
  /** Learned preferences from the memory layer (Phase 3). */
  memoryContext?: string[];
}): string {
  return `You screen incoming ${input.source === "gmail" ? "email" : "Slack messages"} for a \
productivity tool. Decide if this creates a CONCRETE action for the user (${input.userEmail}).
${
  input.memoryContext?.length
    ? `\nWhat you have learned about this user's preferences:\n${input.memoryContext
        .map((m) => `- ${m}`)
        .join("\n")}\n`
    : ""
}
From: ${input.from}
${input.subject ? `Subject: ${input.subject}\n` : ""}\
Content:
"""
${input.body.slice(0, 3000)}
"""

isTask = true ONLY when the user personally needs to do something: reply with a \
decision, review something, pay, sign, book, prepare, attend to a request aimed at them.
isTask = false for: newsletters, promotions, notifications, receipts, FYI/status \
updates, automated reports, things already done, and anything addressed to a group \
with no specific ask of the user.
Set confidence accordingly (0-1). Title: short imperative phrasing of the action.`;
}
