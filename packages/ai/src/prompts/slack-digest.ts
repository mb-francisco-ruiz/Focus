/**
 * Prompt v2 for the Slack daily digest: structured output so each point can
 * carry the source message ts (→ a clickable thread link) and be rendered with
 * per-point controls. Author names and in-text @mentions are pre-resolved
 * before this prompt sees them.
 */
export function slackDigestPrompt(input: {
  date: string;
  userName: string;
  channels: { name: string; messages: string[] }[];
}): string {
  return `Summarise the last 24 hours of Slack for ${input.userName} (${input.date}).

Return:
1. summary — 1-2 sentences on the day overall.
2. sections — one per channel that had real substance, each with 2-5 tight points.
   For every point, set "ts" to the EXACT ts value (from the "(ts:...)" tag) of the
   single message the point most draws from — copy it verbatim; use "" only if the
   point genuinely spans many messages. This links the point back to its thread.
   Skip small talk, greetings, bot noise, and channels with nothing meaningful.
3. actions (REQUIRED array) — concrete things ${input.userName} personally must DO:
   reply to a direct ask/@mention, review/sign-off something addressed to them,
   follow up on a blocker they own. Each: short imperative title, the channel, one
   sentence why. Empty array only if truly nothing needs the user.

Never invent content. Write in the language of the messages.

Messages by channel (each line: "(ts:<id>) [HH:MM] author: text"):
${input.channels
  .map((c) => `## ${c.name}\n${c.messages.map((m) => `  ${m}`).join("\n")}`)
  .join("\n\n")}`;
}
