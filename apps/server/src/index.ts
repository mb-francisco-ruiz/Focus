import { buildApp } from "./app.js";
import { env } from "./config.js";
import { closeDb, ensureExtensions } from "./db/index.js";
import {
  jobs,
  scheduleGmailPoll,
  scheduleNightlyRecompute,
  scheduleProactivity,
  startWorker,
} from "./lib/queue.js";

const app = await buildApp();

await ensureExtensions();

// Worker runs in-process while we're a single service (PLAN.md §3.2).
const worker = startWorker(app.log);
await scheduleNightlyRecompute();
await scheduleGmailPoll();
await scheduleProactivity();

await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await worker.close();
    await jobs.close();
    await closeDb();
    process.exit(0);
  });
}
