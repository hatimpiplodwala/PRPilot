import { drainOnce, type DrainResult } from "@/lib/worker";
import { log, newRequestId } from "@/lib/log";

/**
 * AWS Lambda entry point for the background review worker.
 *
 * Triggered on a schedule by EventBridge (Phase 3): one invocation drains one
 * batch of queued jobs — the same work the Vercel cron route does, minus the
 * HTTP/bearer layer (Lambda invocations are authorized by IAM, not a shared
 * secret). Postgres stays the queue + audit log, and claim_review_jobs'
 * FOR UPDATE SKIP LOCKED keeps this worker and the Vercel route from ever
 * claiming the same job if both run during a migration.
 *
 * Packaged as a container image (see Phase 3): the image CMD points here, e.g.
 * `worker/handler.handler`.
 */
export async function handler(): Promise<DrainResult> {
  const l = log.child({ kind: "worker", runtime: "lambda", requestId: newRequestId() });
  return drainOnce(l);
}
