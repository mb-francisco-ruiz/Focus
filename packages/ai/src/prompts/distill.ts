/**
 * Prompt v1 for the distill capability (memory layer tier 3, PLAN.md §6):
 * turn recent raw events into a handful of durable, human-readable facts.
 * Runs nightly; existing records are passed in so it extends rather than repeats.
 */
export function distillPrompt(input: {
  events: string[]; // compact one-line summaries, oldest first
  existingRecords: string[];
}): string {
  return `You maintain the long-term memory of a personal productivity assistant.
Below is the user's recent activity log. Extract durable facts worth remembering —
things that will make future task classification, prioritisation and email/message
screening smarter FOR THIS USER.

Kinds:
- entity: who/what recurring names refer to ("Coni = daughter; school topics are personal")
- preference: how the user wants things handled ("Always bumps tax-related tasks to High",
  "Dismisses suggestions from newsletter senders")
- pattern: behavioural regularities ("Completes Slack-captured tasks same-day")
- outcome: how estimates play out ("'write doc' tasks usually slip several days")

Rules:
- Only facts supported by MULTIPLE events or one unambiguous strong signal.
- Nothing speculative, nothing sensitive (health, politics, relationships) unless
  the user explicitly made a task about it.
- Do not repeat or rephrase existing memory. Return an empty list if nothing new.
- Write each record in the language the user writes their tasks in (match the
  activity below); keep entity names and quoted phrases verbatim.

Existing memory:
${input.existingRecords.length ? input.existingRecords.map((r) => `- ${r}`).join("\n") : "(none)"}

Recent activity (oldest first):
${input.events.map((e) => `- ${e}`).join("\n")}`;
}
