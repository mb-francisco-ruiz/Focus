import { Queue, Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { enrichTask } from "./enrich.js";
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

export type JobName = "enrich" | "recompute-task" | "recompute-all";
interface JobData {
  taskId?: string;
}

export const jobs = new Queue(QUEUE_NAME, {
  connection: connection(),
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
      }
    },
    { connection: connection(), concurrency: 5 },
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
