import { NextResponse, type NextRequest } from "next/server";
import { verify } from "@octokit/webhooks-methods";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs";
import { consumeRateLimit } from "@/lib/ratelimit";
import { upsertInstallation, removeInstallation } from "@/lib/users";

export const runtime = "nodejs";

// Auto-review when a PR opens, reopens, or receives new commits (synchronize).
// New commits change head_sha, so enqueueJob dedup naturally yields a fresh review.
const REVIEW_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

/**
 * GitHub App webhook receiver. Verifies the HMAC signature, handles the event,
 * and returns fast (2xx). Heavy work is enqueued; the cron processor runs it.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";

  const valid = await verify(env.githubWebhookSecret, raw, signature).catch(() => false);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  const payload = JSON.parse(raw);

  try {
    if (event === "installation") {
      await handleInstallation(payload);
      return NextResponse.json({ ok: true });
    }

    if (event === "pull_request" && REVIEW_ACTIONS.has(payload.action)) {
      await handlePullRequest(payload);
      return NextResponse.json({ ok: true }, { status: 202 });
    }
  } catch (err) {
    // Log and still 202 so GitHub doesn't hammer retries for our internal errors.
    console.error("webhook handler error:", err);
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  // Event we don't act on.
  return NextResponse.json({ ignored: event }, { status: 202 });
}

async function handleInstallation(payload: any) {
  const installationId = payload.installation?.id;
  const accountLogin = payload.installation?.account?.login ?? "unknown";
  if (!installationId) return;

  if (payload.action === "deleted") {
    await removeInstallation(installationId);
  } else {
    // created / new_permissions_accepted / etc. — keep a record.
    await upsertInstallation({ githubInstallationId: installationId, accountLogin });
  }
}

async function handlePullRequest(payload: any) {
  const installationId = payload.installation?.id;
  const repoFullName = payload.repository?.full_name;
  const prNumber = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;
  if (!installationId || !repoFullName || !prNumber || !headSha) return;

  // Per-installation rate limit guards quota for webhook-driven reviews.
  const rl = await consumeRateLimit(`install:${installationId}`, env.rateLimitPerHour);
  if (!rl.allowed) {
    console.warn(`rate limit hit for installation ${installationId}; skipping ${repoFullName}#${prNumber}`);
    return;
  }

  // Deduped on (repo, pr, head_sha) inside enqueueJob.
  await enqueueJob({ installationId, repoFullName, prNumber, headSha, trigger: "webhook" });
}
