import { NextResponse, type NextRequest } from "next/server";
import { verify } from "@octokit/webhooks-methods";
import { z } from "zod";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs";
import { consumeRateLimit, getRateLimitStatus } from "@/lib/ratelimit";
import { findInstallation, upsertInstallation, removeInstallation } from "@/lib/users";
import { evictInstallation } from "@/lib/github";
import { hasDelivery, recordDelivery } from "@/lib/deliveries";
import { log, newRequestId } from "@/lib/log";

export const runtime = "nodejs";

// Auto-review when a PR opens, reopens, or receives new commits (synchronize).
// New commits change head_sha, so enqueueJob dedup naturally yields a fresh review.
const REVIEW_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

// We only trust signed payloads, but still pin the fields we touch so missing
// or wrong-typed properties surface as a 4xx rather than crashing the handler
// or, worse, writing garbage into the DB.
const InstallationEvent = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int().positive(),
    account: z.object({ login: z.string().max(64) }).partial().optional(),
  }),
});

const PullRequestEvent = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    full_name: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
    // Used to upsert the installation row if a PR event arrives before (or
    // without) the matching `installation` event — keeps the FK from
    // review_jobs.installation_id → installations satisfied.
    owner: z.object({ login: z.string().max(64) }),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().min(7).max(64) }),
  }),
});

/**
 * GitHub App webhook receiver. Verifies the HMAC signature, handles the event,
 * and returns fast (2xx). Heavy work is enqueued; the cron processor runs it.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  // Real deliveries always carry x-github-delivery. The fallback is just for
  // synthetic / non-GitHub probes — the dedupe is skipped for those (we have
  // nothing stable to key on).
  const deliveryHeader = req.headers.get("x-github-delivery");
  const delivery = deliveryHeader ?? newRequestId();
  const reqLog = log.child({ kind: "webhook", event, delivery });

  const valid = await verify(env.githubWebhookSecret, raw, signature).catch(() => false);
  if (!valid) {
    reqLog.warn("invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // At-most-once on the X-GitHub-Delivery UUID.
  //
  // The previous design recorded the delivery BEFORE running the handler.
  // Combined with the catch-all "log and 202" below, a transient handler
  // failure permanently buried the event: GitHub stopped retrying (2xx) and
  // any manual redelivery short-circuited as a duplicate.
  //
  // Now: check (read-only) for an existing delivery row up front; only RECORD
  // after the handler succeeds (or after a non-retryable validation
  // rejection). Handler-internal failures throw to the outer catch, which
  // returns 500 so GitHub will retry — and the absence of a delivery row
  // means the retry won't be deduped away.
  if (deliveryHeader) {
    try {
      if (await hasDelivery(deliveryHeader)) {
        reqLog.info("duplicate delivery; skipping");
        return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
      }
    } catch (err) {
      // DB hiccup on the dedupe read shouldn't drop the event — proceed
      // without dedupe; downstream operations are idempotent on (repo, pr,
      // head_sha) via the enqueue_review_job RPC.
      reqLog.warn("delivery dedupe check failed; proceeding without dedupe", { err });
    }
  }

  /**
   * Record successful handling so future retries of the same delivery id
   * short-circuit. Safe to skip when no delivery header was supplied (we have
   * nothing stable to key on) and on any RPC failure (worst case we
   * re-process; underlying writes are idempotent).
   */
  const markProcessed = async () => {
    if (!deliveryHeader) return;
    try {
      await recordDelivery(deliveryHeader, event);
    } catch (err) {
      reqLog.warn("recordDelivery failed; future retries may re-process", { err });
    }
  };

  try {
    const payload: unknown = JSON.parse(raw);

    if (event === "installation") {
      const parsed = InstallationEvent.safeParse(payload);
      if (!parsed.success) {
        reqLog.warn("bad installation payload", { issues: parsed.error.issues });
        // Validation failures are non-retryable: record so GitHub's retries
        // don't loop forever on a payload we'll never accept.
        await markProcessed();
        return NextResponse.json({ ok: false, error: "Bad installation payload" }, { status: 202 });
      }
      await handleInstallation(parsed.data, reqLog);
      await markProcessed();
      return NextResponse.json({ ok: true });
    }

    if (event === "pull_request") {
      const parsed = PullRequestEvent.safeParse(payload);
      if (!parsed.success) {
        reqLog.warn("bad pull_request payload", { issues: parsed.error.issues });
        await markProcessed();
        return NextResponse.json({ ok: false, error: "Bad pull_request payload" }, { status: 202 });
      }
      if (!REVIEW_ACTIONS.has(parsed.data.action)) {
        await markProcessed();
        return NextResponse.json({ ignored: parsed.data.action }, { status: 202 });
      }
      await handlePullRequest(parsed.data, reqLog);
      await markProcessed();
      return NextResponse.json({ ok: true }, { status: 202 });
    }
  } catch (err) {
    // Transient/internal failure — return 5xx so GitHub will retry, and DO
    // NOT record the delivery so the retry isn't deduped away.
    reqLog.error("handler threw; returning 500 for GitHub retry", { err });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Event we don't act on. Record so GitHub's automatic retry of the same
  // delivery id (uncommon but possible) doesn't repeat the no-op.
  await markProcessed();
  return NextResponse.json({ ignored: event }, { status: 202 });
}

async function handleInstallation(
  payload: z.infer<typeof InstallationEvent>,
  parentLog: typeof log
) {
  const installationId = payload.installation.id;
  const accountLogin = payload.installation.account?.login ?? "unknown";
  const l = parentLog.child({ installationId, action: payload.action });

  if (payload.action === "deleted") {
    await removeInstallation(installationId);
    // Drop any cached Octokit + open-PR list — the token strategy would happily
    // keep using a now-revoked installation token, and stale entries waste
    // memory after the install is gone.
    evictInstallation(installationId);
    l.info("installation removed");
  } else {
    // created / new_permissions_accepted / etc. — keep a record. revive=true
    // clears any prior tombstone so a legitimate reinstall actually works.
    await upsertInstallation({
      githubInstallationId: installationId,
      accountLogin,
      revive: true,
    });
    l.info("installation upserted", { accountLogin });
  }
}

async function handlePullRequest(
  payload: z.infer<typeof PullRequestEvent>,
  parentLog: typeof log
) {
  const installationId = payload.installation.id;
  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const headSha = payload.pull_request.head.sha;
  const l = parentLog.child({ installationId, repo: repoFullName, pr: prNumber, action: payload.action });

  // Ensure the installations row exists before enqueueing — the review_jobs FK
  // requires it, and webhook ordering between `installation` and `pull_request`
  // isn't guaranteed (a missed install event would otherwise block every PR
  // for that installation).
  //
  // BUT: this defensive upsert must NOT resurrect a deleted install. Webhook
  // ordering also runs the other way — a `pull_request` event queued before
  // an `installation.deleted` can land after the delete and bring the install
  // back without permission. Pass revive=false; if the row is tombstoned we
  // log and bail. A genuinely new install (no row at all) is upserted fresh.
  const existing = await findInstallation(installationId);
  if (existing?.deleted_at) {
    l.warn("pull_request for tombstoned install; skipping", { deletedAt: existing.deleted_at });
    return;
  }
  await upsertInstallation({
    githubInstallationId: installationId,
    accountLogin: payload.repository.owner.login,
  });

  // Per-installation rate limit guards quota for webhook-driven reviews. Peek
  // first (read-only) to reject when already at the cap; we only *consume* a
  // slot below, and only when enqueue actually creates a new review — so repeat
  // deliveries (e.g. a reopen on the same commit) don't burn quota for work
  // that won't run. Peek+consume isn't atomic, so a burst of concurrent new PRs
  // on one install can overshoot the cap by the concurrency — acceptable slop
  // for a soft free-tier guard.
  const { remaining } = await getRateLimitStatus(`install:${installationId}`, env.rateLimitPerHour);
  if (remaining <= 0) {
    l.warn("install rate limit hit; skipping review");
    return;
  }

  // Deduped on (repo, pr, head_sha) inside enqueueJob.
  const { job, created } = await enqueueJob({
    installationId,
    repoFullName,
    prNumber,
    headSha,
    trigger: "webhook",
  });
  // Charge a slot only for a genuinely new review, not a deduped no-op.
  if (created) {
    await consumeRateLimit(`install:${installationId}`, env.rateLimitPerHour);
  }
  l.info("pr event handled", { jobId: job.id, created });
}
