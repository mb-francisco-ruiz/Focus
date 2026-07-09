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

isTask = true ONLY when a real person needs THIS user to personally do something: \
reply with a decision, review/sign/pay something addressed to them, prepare for or \
attend a specific commitment.

isTask = false — be strict — for anything automated or one-to-many, even when it uses \
urgent or personal-sounding wording ("for you", "your search", "action needed", \
"don't miss"): marketing and advertising, promotions, price-drop / listing / deal \
alerts, newsletters, digests, social notifications, receipts, order/shipping updates, \
calendar invites from tools, FYI/status/automated reports, and no-reply senders. \
A machine-generated notification is NEVER a task, however relevant its topic. \
When unsure, prefer false.

Set confidence accordingly (0-1). Title: short imperative phrasing of the action, \
in the same language as the email/message.`;
}
