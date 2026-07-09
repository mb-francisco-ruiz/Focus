/**
 * Day-planning prompt: slot the user's open tasks into the free gaps around
 * today's calendar events. Precision over ambition — leave buffers, respect
 * meetings, don't cram.
 */
export function planDayPrompt(input: {
  now: string; // ISO, user's local time
  events: { title: string; start: string; end: string }[];
  tasks: { id: string; title: string; priority: string; dueAt: string | null }[];
}): string {
  return `Plan ${input.now.slice(0, 10)} for the user. It is currently ${input.now} (local).
Schedule focus blocks for their tasks into the FREE time around today's meetings,
between roughly 09:00 and 18:00 local. Rules:
- Never overlap a calendar event; leave short buffers around meetings.
- Highest priority (P1) and due-today tasks first; don't schedule more than fits.
- Blocks 30–90 min; only schedule from the current time onward.
- start/end as ISO datetimes with the same local offset as "now". Use the task's id.
- Return an empty list if there's no meaningful free time.

Today's calendar:
${input.events.length ? input.events.map((e) => `- ${e.start}–${e.end} ${e.title}`).join("\n") : "(no meetings)"}

Open tasks (id | priority | due | title):
${input.tasks.map((t) => `- ${t.id} | ${t.priority} | ${t.dueAt ?? "no due"} | ${t.title}`).join("\n")}`;
}
