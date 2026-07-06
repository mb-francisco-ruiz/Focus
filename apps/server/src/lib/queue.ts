import { Queue, Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { enrichTask } from "./enrich.js";
import { pollGmailForSuggestions } from "./gmail-suggest.js";
import { recomputeAllPriorities, recomputeTaskPriority } from "./recompute.js";

// Options object (not an ioredis instance) so BullMQ builds its own clients;
// maxRetriesPerRequest: null is a BullMQ requirement.
function connection() {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

const QUEUE_NAME = "focus-jobs";

// Local dev and prod share one Railway Redis — without distinct prefixes the
// two workers steal each other's jobs (and WS pushes land on the wrong bus).
// Prod keeps BullMQ's default "bull" prefix so existing schedulers survive.
const PREFIX = env.NODE_ENV === "production" ? undefined : "bull-dev";

export type JobName =
  | "enrich"
  | "recompute-task"
  | "recompute-all"
  | "gmail-poll"
  | "slack-capture"
  | "reminder-scan"
  | "morning-digest"
  | "memory-distill";
interface JobData {
  taskId?: string;
  capture?: { accountId: string; channel: string; ts: string };
}

export const jobs = new Queue(QUEUE_NAME, {
  connection: connection(),
  prefix: PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueue(name: JobName, data: JobData = {}): Promise<void> {
  await jobs.add(name, data);
}

export function startWorker(log: FastifyBaseLogger): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = job.data as JobData;
      switch (job.name as JobName) {
        case "enrich":
          await enrichTask(data.taskId!);
          break;
        case "recompute-task":
          await recomputeTaskPriority(data.taskId!);
          break;
        case "recompute-all":
          await recomputeAllPriorities();
          break;
        case "gmail-poll":
          await pollGmailForSuggestions();
          break;
        case "slack-capture": {
          const { captureFromReaction } = await import("./slack.js");
          await captureFromReaction(data.capture!);
          break;
        }
        case "reminder-scan": {
          const { scanReminders } = await import("./reminders.js");
          await scanReminders();
          break;
        }
        case "morning-digest": {
          const { sendMorningDigests } = await import("./digest.js");
          await sendMorningDigests();
          break;
        }
        case "memory-distill": {
          const { distillMemory } = await import("./memory.js");
          await distillMemory();
          break;
        }
      }
    },
    { connection: connection(), prefix: PREFIX, concurrency: 5 },
  );
  worker.on("failed", (job, err) => {
    log.error({ err, job: job?.name, data: job?.data }, "job failed");
  });
  return worker;
}

/** Nightly pass (PLAN.md §5.2) — staleness creep and due-date proximity shift daily. */
export async function scheduleNightlyRecompute(): Promise<void> {
  await jobs.upsertJobScheduler(
    "nightly-recompute",
    { pattern: "0 4 * * *" },
    { name: "recompute-all" },
  );
}

/** Gmail auto-suggest poll — every 5 minutes (PLAN.md §5.3). */
export async function scheduleGmailPoll(): Promise<void> {
  await jobs.upsertJobScheduler("gmail-poll", { every: 5 * 60 * 1000 }, { name: "gmail-poll" });
}

/** Phase 3 proactivity: reminders every minute, digest 08:00 Paris (06:00 UTC),
 *  memory distillation nightly before the 04:00 recompute. */
export async function scheduleProactivity(): Promise<void> {
  await jobs.upsertJobScheduler("reminder-scan", { every: 60 * 1000 }, { name: "reminder-scan" });
  await jobs.upsertJobScheduler("morning-digest", { pattern: "0 6 * * *" }, { name: "morning-digest" });
  await jobs.upsertJobScheduler("memory-distill", { pattern: "30 2 * * *" }, { name: "memory-distill" });
}
