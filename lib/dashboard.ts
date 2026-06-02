import { listUserInstallations } from "./users";
import { listOpenPullRequests } from "./github";
import { listRecentJobs } from "./jobs";
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
}

const jobKey = (repo: string, pr: number) => `${repo}#${pr}`;

/** Gather everything the dashboard needs for the logged-in user. */
export async function getDashboardData(userId: string): Promise<{
  hasInstallations: boolean;
  prs: PrRow[];
}> {
  const installations = await listUserInstallations(userId);
  if (installations.length === 0) {
    return { hasInstallations: false, prs: [] };
  }

  const jobs = await listRecentJobs(200);
  // Latest job per (repo, pr) — jobs are already newest-first.
  const latestByPr = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    const key = jobKey(job.repo_full_name, job.pr_number);
    if (!latestByPr.has(key)) latestByPr.set(key, job);
  }

  const prs: PrRow[] = [];
  for (const inst of installations) {
    const openPrs = await listOpenPullRequests(inst.github_installation_id);
    for (const pr of openPrs) {
      const job = latestByPr.get(jobKey(pr.repoFullName, pr.number));
      prs.push({
        installationId: inst.github_installation_id,
        repoFullName: pr.repoFullName,
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.htmlUrl,
        headSha: pr.headSha,
        updatedAt: pr.updatedAt,
        status: job?.status ?? "none",
        jobId: job?.id ?? null,
        commentId: job?.comment_id ?? null,
      });
    }
  }

  prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { hasInstallations: true, prs };
}
