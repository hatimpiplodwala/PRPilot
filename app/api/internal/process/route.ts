import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { claimQueuedJobs } from "@/lib/jobs";
import { processJob } from "@/lib/processor";
import { log, newRequestId } from "@/lib/log";

/** Constant-time string compare so the cron secret can't be probed by timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const runtime = "nodejs";
// Give the review pipeline more headroom than the default. On Vercel Hobby this
// may still be capped lower; keep PROCESS_BATCH_SIZE small so each tick fits.
export const maxDuration = 60;

/**
 * Internal queue drain, invoked by the Supabase cron Edge Function (or any
 * scheduler) with a shared-secret bearer token. Claims a small batch of queued
 * jobs and runs each through the review pipeline.
 */
export async function POST(req: NextRequest) {
  const reqLog = log.child({ kind: "process", requestId: newRequestId() });
  const authz = req.headers.get("authorization") ?? "";
  if (!safeEqual(authz, `Bearer ${env.cronSecret}`)) {
    reqLog.warn("unauthorized process call");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await claimQueuedJobs(env.processBatchSize);
  if (jobs.length === 0) {
    reqLog.debug("nothing to process");
    return NextResponse.json({ processed: 0 });
  }

  reqLog.info("draining batch", { count: jobs.length, jobIds: jobs.map((j) => j.id) });
  const results = await Promise.allSettled(jobs.map((job) => processJob(job)));

  // Log each rejection with its job id so failures are debuggable in production
  // — `failed` as a bare count buried real errors.
  const failed = results.reduce((acc, r, i) => {
    if (r.status === "rejected") {
      reqLog.error("job failed", { jobId: jobs[i].id, err: r.reason });
      return acc + 1;
    }
    return acc;
  }, 0);

  reqLog.info("batch complete", { processed: jobs.length, failed });
  return NextResponse.json({ processed: jobs.length, failed });
}
