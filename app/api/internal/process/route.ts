import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { claimQueuedJobs } from "@/lib/jobs";
import { processJob } from "@/lib/processor";

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
  const authz = req.headers.get("authorization") ?? "";
  if (authz !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await claimQueuedJobs(env.processBatchSize);
  if (jobs.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results = await Promise.allSettled(jobs.map((job) => processJob(job)));
  const failed = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ processed: jobs.length, failed });
}
