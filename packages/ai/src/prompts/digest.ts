/**
 * Prompt v1 for the digest capability: the morning summary notification.
 */
export function digestPrompt(input: {
  now: string;
  openTasks: string[]; // "High | Review contract | due today | work"
  dueToday: number;
  overdue: number;
}): string {
  return `Write the user's morning digest for a productivity app notification.
Current datetime: ${input.now}

Open tasks (priority | title | due | sphere):
${input.openTasks.map((t) => `- ${t}`).join("\n")}

Counts: ${input.dueToday} due today, ${input.overdue} overdue.

2-3 short sentences, direct and concrete: lead with what matters most today,
mention anything overdue, no greetings, no emoji, no bullet points.`;
}
