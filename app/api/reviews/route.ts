import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { listUserInstallations } from "@/lib/users";
import { consumeRateLimit } from "@/lib/ratelimit";
import { enqueueJob } from "@/lib/jobs";
import { getInstallationOctokit, getPullRequest } from "@/lib/github";
import { jsonNoStore } from "@/lib/http";
import { env } from "@/lib/env";
import { log, newRequestId } from "@/lib/log";

export const runtime = "nodejs";

const Body = z.object({
  installationId: z.number().int().positive(),
  // GitHub owner/repo charset: keeps arbitrary characters out of Octokit path params.
  repoFullName: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(7).max(64),
});

/** Manual "Review now": rate-limited, ownership-checked, enqueues a job. */
export async function POST(req: NextRequest) {
  const reqLog = log.child({ kind: "manual-review", requestId: newRequestId() });
  const session = await auth();
  if (!session?.user?.id) {
    return jsonNoStore({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid request" }, { status: 400 });
  }
  const { installationId, repoFullName, prNumber, headSha } = parsed.data;
  const l = reqLog.child({
    userId: session.user.id,
    installationId,
    repo: repoFullName,
    pr: prNumber,
  });

  // Ownership: the installation must belong to the logged-in user.
  const installations = await listUserInstallations(session.user.id);
  if (!installations.some((i) => i.github_installation_id === installationId)) {
    l.warn("installation ownership rejected");
    return jsonNoStore({ error: "Installation not found" }, { status: 403 });
  }

  // Verify the PR exists, is open, and the supplied SHA matches the current head.
  // Without this the client could enqueue a review of any repo+PR the installation
  // can see (including closed PRs or arbitrary SHAs).
  try {
    const octokit = getInstallationOctokit(installationId);
    const pr = await getPullRequest(octokit, repoFullName, prNumber);
    if (pr.state !== "open") {
      return jsonNoStore({ error: "Pull request is not open" }, { status: 409 });
    }
    if (pr.headSha !== headSha) {
      return jsonNoStore({ error: "Head SHA is stale; refresh and retry" }, { status: 409 });
    }
  } catch {
    return jsonNoStore({ error: "Pull request not found" }, { status: 404 });
  }

  // Per-user rate limit.
  const rl = await consumeRateLimit(`user:${session.user.id}`, env.rateLimitPerHour);
  if (!rl.allowed) {
    return jsonNoStore(
      {
        error: `Hourly limit reached (${rl.limit} reviews). Try again later.`,
        rateLimit: { remaining: 0, limit: rl.limit },
      },
      { status: 429 }
    );
  }

  const { job } = await enqueueJob({
    installationId,
    repoFullName,
    prNumber,
    headSha,
    trigger: "manual",
  });

  // Kick the processor right away so a manual review starts in ~1s instead of
  // waiting up to a minute for the next cron tick. `after` runs once the response
  // has been sent; the cron drain remains the fallback if this kick is missed.
  //
  // Origin source:
  //   * In production: env (APP_URL / VERCEL_URL) only. A spoofed Host header
  //     on this request must not redirect the cron secret to attacker DNS.
  //   * In dev (NODE_ENV !== "production"): fall back to req.nextUrl.origin so
  //     `npm run dev` without APP_URL/VERCEL_URL set still kicks immediately.
  //     The Host-header attack vector doesn't apply to localhost.
  if (job.status === "queued") {
    const origin =
      env.appUrl ??
      (process.env.NODE_ENV !== "production" ? req.nextUrl.origin : null);
    if (origin) {
      after(async () => {
        try {
          await fetch(`${origin}/api/internal/process`, {
            method: "POST",
            headers: { Authorization: `Bearer ${env.cronSecret}` },
          });
          l.debug("processor kicked", { jobId: job.id });
        } catch (err) {
          // Swallowed for the response, but logged: cron will drain on next
          // tick, but a persistent failure here is worth knowing about.
          l.warn("processor kick failed", { jobId: job.id, err });
        }
      });
    } else {
      l.debug("no appUrl configured; relying on cron drain", { jobId: job.id });
    }
  }

  l.info("review queued", { jobId: job.id, rateLimitRemaining: rl.remaining });
  return jsonNoStore({
    jobId: job.id,
    status: job.status,
    rateLimit: { remaining: rl.remaining, limit: rl.limit },
  });
}
