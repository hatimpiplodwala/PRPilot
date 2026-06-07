import { getServiceSupabase } from "./db";
import type { CommentKind, Review, ReviewJob } from "./types";

/**
 * The `review_jobs` table doubles as the work queue. These helpers enqueue,
 * atomically claim, and complete jobs. Claiming uses a Postgres RPC so two
 * concurrent processor runs never grab the same job.
 */

export interface EnqueueInput {
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  trigger: "webhook" | "manual";
}

export interface EnqueueResult {
  job: ReviewJob;
  /** False when a job for this exact (repo, pr, head_sha) already existed. */
  created: boolean;
}

/**
 * Insert a queued job, deduped on (repo, pr, head_sha).
 *
 * Webhook triggers dedupe: a repeat delivery for the same commit is a no-op.
 * Manual triggers ("Review now") force a fresh review even on the same commit —
 * if a finished job exists for that commit it is re-queued in place (keeping its
 * comment id so the processor updates the existing comment instead of posting a
 * duplicate). A job already queued/running is left alone.
 */
export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  const supabase = getServiceSupabase();

  const { data: existing } = await supabase
    .from("review_jobs")
    .select("*")
    .eq("repo_full_name", input.repoFullName)
    .eq("pr_number", input.prNumber)
    .eq("head_sha", input.headSha)
    .maybeSingle();

  if (existing) {
    const job = existing as ReviewJob;
    const isFinished = job.status === "done" || job.status === "failed";
    if (input.trigger === "manual" && isFinished) {
      // Re-queue the same row for a fresh review; keep comment_id to update in place.
      const { data, error } = await supabase
        .from("review_jobs")
        .update({ status: "queued", trigger: "manual", result_json: null, error: null })
        .eq("id", job.id)
        .select("*")
        .single();
      if (error) throw new Error(`enqueueJob re-queue failed: ${error.message}`);
      return { job: data as ReviewJob, created: true };
    }
    // Webhook repeat, or a review already in flight — no-op.
    return { job, created: false };
  }

  const { data, error } = await supabase
    .from("review_jobs")
    .insert({
      installation_id: input.installationId,
      repo_full_name: input.repoFullName,
      pr_number: input.prNumber,
      head_sha: input.headSha,
      trigger: input.trigger,
      status: "queued",
    })
    .select("*")
    .single();

  if (error) {
    // Unique-violation race: another request inserted the same job first.
    if (error.code === "23505") {
      const { data: row } = await supabase
        .from("review_jobs")
        .select("*")
        .eq("repo_full_name", input.repoFullName)
        .eq("pr_number", input.prNumber)
        .eq("head_sha", input.headSha)
        .single();
      return { job: row as ReviewJob, created: false };
    }
    throw new Error(`enqueueJob failed: ${error.message}`);
  }

  return { job: data as ReviewJob, created: true };
}

/** Atomically move up to `limit` jobs from queued -> running and return them. */
export async function claimQueuedJobs(limit: number): Promise<ReviewJob[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("claim_review_jobs", { p_limit: limit });
  if (error) throw new Error(`claimQueuedJobs failed: ${error.message}`);
  return (data as ReviewJob[]) ?? [];
}

export async function completeJob(
  jobId: string,
  result: Review,
  commentId: number | null,
  commentKind: CommentKind | null
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("review_jobs")
    .update({
      status: "done",
      result_json: result,
      comment_id: commentId,
      comment_kind: commentKind,
      error: null,
    })
    .eq("id", jobId);
  if (error) throw new Error(`completeJob failed: ${error.message}`);
}

export async function failJob(jobId: string, message: string): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("review_jobs")
    .update({ status: "failed", error: message })
    .eq("id", jobId);
  if (error) throw new Error(`failJob failed: ${error.message}`);
}

/**
 * Recent jobs, newest first — used to show status in the dashboard. Scoped to
 * the given installations so a user always sees their own jobs (and never pages
 * past them when the global table is large).
 */
export async function listRecentJobs(
  installationIds: number[],
  limit = 200
): Promise<ReviewJob[]> {
  if (installationIds.length === 0) return [];
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("review_jobs")
    .select("*")
    .in("installation_id", installationIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ReviewJob[]) ?? [];
}
