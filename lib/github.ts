import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { env } from "./env";
import type { ChangedFile } from "./types";

/**
 * GitHub access. Two kinds of clients:
 *  - app-level (JWT) for installation management
 *  - installation-scoped (short-lived token) for reading diffs + posting comments
 *
 * Tokens are minted per call and never persisted.
 */

export function getAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.githubAppId,
      privateKey: env.githubPrivateKey,
    },
  });
}

export function getInstallationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.githubAppId,
      privateKey: env.githubPrivateKey,
      installationId,
    },
  });
}

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}

/** List the changed files (with patches) for a PR. Paginates fully. */
export async function listPullRequestFiles(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number
): Promise<ChangedFile[]> {
  const { owner, repo } = splitRepo(repoFullName);
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}

export interface PullRequestMeta {
  title: string;
  body: string | null;
  headSha: string;
  state: string;
}

export async function getPullRequest(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number
): Promise<PullRequestMeta> {
  const { owner, repo } = splitRepo(repoFullName);
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  return { title: data.title, body: data.body, headSha: data.head.sha, state: data.state };
}

/** Post a review as an issue comment on the PR; returns the comment id. */
export async function postPrComment(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number,
  body: string
): Promise<number> {
  const { owner, repo } = splitRepo(repoFullName);
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return data.id;
}

export interface InlineComment {
  path: string;
  /** Line number in the new file (RIGHT side of the diff). */
  line: number;
  body: string;
}

/**
 * Post a PR review with inline comments anchored to specific lines. The caller
 * must ensure every `line` is within the diff (see commentableLines) — GitHub
 * rejects the whole review otherwise. Returns the review id.
 */
export async function postReview(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number,
  commitId: string,
  body: string,
  comments: InlineComment[]
): Promise<number> {
  const { owner, repo } = splitRepo(repoFullName);
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitId,
    body,
    event: "COMMENT",
    comments: comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body })),
  });
  return data.id;
}

/** Update an existing PR/issue comment in place. */
export async function updatePrComment(
  octokit: Octokit,
  repoFullName: string,
  commentId: number,
  body: string
): Promise<number> {
  const { owner, repo } = splitRepo(repoFullName);
  const { data } = await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
  return data.id;
}

/** List open PRs across all repos accessible to an installation. */
export async function listOpenPullRequests(installationId: number): Promise<
  Array<{
    repoFullName: string;
    number: number;
    title: string;
    headSha: string;
    htmlUrl: string;
    updatedAt: string;
  }>
> {
  const octokit = getInstallationOctokit(installationId);
  const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });

  const results: Awaited<ReturnType<typeof listOpenPullRequests>> = [];
  for (const repo of repos) {
    const prs = await octokit.paginate(octokit.rest.pulls.list, {
      owner: repo.owner.login,
      repo: repo.name,
      state: "open",
      per_page: 100,
    });
    for (const pr of prs) {
      results.push({
        repoFullName: repo.full_name,
        number: pr.number,
        title: pr.title,
        headSha: pr.head.sha,
        htmlUrl: pr.html_url,
        updatedAt: pr.updated_at,
      });
    }
  }
  return results;
}
