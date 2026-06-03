import { listUserInstallations } from "./users";
import { listOpenPullRequests } from "./github";
import { listRecentJobs } from "./jobs";
import { getRateLimitStatus, type RateLimitStatus } from "./ratelimit";
import { env } from "./env";
import type { JobStatus } from "./types";

export interface PrRow {
  installationId: number;
  repoFullName: string;
  number: number;
  title: string;
  htmlUrl: string;
  headSha: string;
  updatedAt: string;
  status: JobStatus | "none";
  jobId: string | null;
  commentId: number | null;
  error: string | null;
  reviewedAt: string | null;
}

const jobKey = (repo: string, pr: number) => `${repo}#${pr}`;

/** Gather everything the dashboard needs for the logged-in user. */
export async function getDashboardData(userId: string): Promise<{
  hasInstallations: boolean;
  prs: PrRow[];
  rateLimit: RateLimitStatus;
}> {
  const installations = await listUserInstallations(userId);
  if (installations.length === 0) {
    const rateLimit = await getRateLimitStatus(`user:${userId}`, env.rateLimitPerHour);
    return { hasInstallations: false, prs: [], rateLimit };
  }

  const installationIds = installations.map((i) => i.github_installation_id);

  // Rate limit, recent jobs, and each installation's open PRs are independent —
  // fetch them concurrently.
  const [rateLimit, jobs, prGroups] = await Promise.all([
    getRateLimitStatus(`user:${userId}`, env.rateLimitPerHour),
    listRecentJobs(installationIds),
    Promise.all(
      installations.map(async (inst) => ({
        installationId: inst.github_installation_id,
        prs: await listOpenPullRequests(inst.github_installation_id),
      }))
    ),
  ]);

  // Latest job per (repo, pr) — jobs are already newest-first.
  const latestByPr = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    const key = jobKey(job.repo_full_name, job.pr_number);
    if (!latestByPr.has(key)) latestByPr.set(key, job);
  }

  const prs: PrRow[] = [];
  for (const group of prGroups) {
    for (const pr of group.prs) {
      const job = latestByPr.get(jobKey(pr.repoFullName, pr.number));
      prs.push({
        installationId: group.installationId,
        repoFullName: pr.repoFullName,
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.htmlUrl,
        headSha: pr.headSha,
        updatedAt: pr.updatedAt,
        status: job?.status ?? "none",
        jobId: job?.id ?? null,
        commentId: job?.comment_id ?? null,
        error: job?.status === "failed" ? job?.error ?? null : null,
        reviewedAt: job?.status === "done" ? job?.updated_at ?? null : null,
      });
    }
  }

  prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { hasInstallations: true, prs, rateLimit };
}
