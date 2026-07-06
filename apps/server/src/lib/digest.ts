import { and, inArray } from "drizzle-orm";
import { digestPrompt, generateStructured } from "@focus/ai";
import { z } from "zod";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { notify } from "./notify.js";
import { PRIORITY_ORDER } from "./serialize.js";

const DigestText = z.object({ text: z.string() });

/** Morning digest (PLAN.md §5.4): one AI-written notification per user. */
export async function sendMorningDigests(): Promise<void> {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return;

  const users = await db.query.users.findMany();
  for (const user of users) {
    const open = await db.query.tasks.findMany({
      where: and(
        inArray(schema.tasks.status, ["inbox", "active", "waiting"]),
      ),
    });
    const mine = open
      .filter((t) => t.userId === user.id)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    if (mine.length === 0) continue;

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const now = new Date();
    const dueToday = mine.filter((t) => t.dueAt && t.dueAt <= endOfToday && t.dueAt >= now).length;
    const overdue = mine.filter((t) => t.dueAt && t.dueAt < now).length;

    const { text } = await generateStructured(
      "digest",
      DigestText,
      digestPrompt({
        now: now.toLocaleString("sv-SE", { timeZone: user.timezone }),
        openTasks: mine
          .slice(0, 15)
          .map(
            (t) =>
              `${t.priority} | ${t.title} | ${t.dueAt ? t.dueAt.toISOString().slice(0, 10) : "no due date"} | ${t.sphere}`,
          ),
        dueToday,
        overdue,
      }),
    );
    await notify(user.id, "digest", "Your day ahead", text);
  }
}
