import { claimQueuedJobs } from "./jobs";
import { processJob } from "./processor";
import { env } from "./env";
import { log, type Logger } from "./log";

/**
 * The queue-drain core, shared by the Vercel cron route
 * (/api/internal/process) and the standalone AWS Lambda worker
 * (worker/handler.ts). One call claims a single batch of queued jobs and runs
 * each through the review pipeline.
 *
 * Framework-agnostic on purpose: no Next types, no HTTP — so the exact same
 * logic runs inside a Next route handler or a bare Node/Lambda process.
 */

export interface DrainResult {
  processed: number;
  failed: number;
}

export async function drainOnce(l: Logger = log): Promise<DrainResult> {
  const jobs = await claimQueuedJobs(env.processBatchSize);
  if (jobs.length === 0) {
    l.debug("nothing to process");
    return { processed: 0, failed: 0 };
  }

  l.info("draining batch", { count: jobs.length, jobIds: jobs.map((j) => j.id) });
  const results = await Promise.allSettled(jobs.map((job) => processJob(job)));

  // Log each rejection with its job id so failures are debuggable in production
  // — a bare count buries the real errors.
  const failed = results.reduce((acc, r, i) => {
    if (r.status === "rejected") {
      l.error("job failed", { jobId: jobs[i].id, err: r.reason });
      return acc + 1;
    }
    return acc;
  }, 0);

  l.info("batch complete", { processed: jobs.length, failed });
  return { processed: jobs.length, failed };
}
