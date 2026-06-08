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

let appClient: Octokit | null = null;
// Bounded LRU so a long-lived process serving many installations doesn't grow
// the client map forever. Map keeps insertion order; on hit we re-insert to
// move-to-back, and on overflow we evict from the front (oldest).
const INSTALLATION_CLIENT_CACHE_LIMIT = 64;
const installationClients = new Map<number, Octokit>();

// Fingerprint of the (appId, privateKey) pair the current cache was built
// from. On private-key rotation, the env getter returns a new value; we
// observe the mismatch here and drop the cached clients so subsequent calls
// mint fresh ones. Without this, a warm Vercel lambda after a key rotation
// would keep serving 401s with the old cached client until process recycle.
let cachedAuthFingerprint: string | null = null;
function currentAuthFingerprint(): string {
  return `${env.githubAppId}::${env.githubPrivateKey}`;
}
function invalidateIfAuthRotated(): void {
  const fp = currentAuthFingerprint();
  if (cachedAuthFingerprint !== fp) {
    appClient = null;
    installationClients.clear();
    cachedAuthFingerprint = fp;
  }
}

// Per-request budget for every GitHub API call. The processor route's
// maxDuration is 60s and we drain up to PROCESS_BATCH_SIZE jobs in parallel; a
// single hung GitHub call (anywhere in paginate, postReview, etc.) must not
// burn the whole window. Each request gets its own AbortSignal.timeout — so
// paginate doesn't share one budget across N calls.
const GITHUB_TIMEOUT_MS = 20_000;

/**
 * fetch wrapper that attaches a per-request timeout. Composed with any signal
 * Octokit itself passes in via init.signal (e.g. for paginate cancellation), so
 * neither party silently loses its abort source.
 */
function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(GITHUB_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

export function getAppOctokit(): Octokit {
  invalidateIfAuthRotated();
  if (appClient) return appClient;
  appClient = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.githubAppId,
      privateKey: env.githubPrivateKey,
    },
    request: { fetch: timedFetch },
  });
  return appClient;
}

/**
 * Returns a cached, installation-scoped Octokit. createAppAuth caches the
 * underlying installation access token (1h lifetime) on the auth strategy
 * instance, so caching the Octokit means we mint one token per installation per
 * process — instead of one per call. Within a single dashboard load that turns
 * dozens of token mints into one.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  invalidateIfAuthRotated();
  const cached = installationClients.get(installationId);
  if (cached) {
    // Move-to-back for LRU order.
    installationClients.delete(installationId);
    installationClients.set(installationId, cached);
    return cached;
  }
  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.githubAppId,
      privateKey: env.githubPrivateKey,
      installationId,
    },
    request: { fetch: timedFetch },
  });
  installationClients.set(installationId, client);
  if (installationClients.size > INSTALLATION_CLIENT_CACHE_LIMIT) {
    const oldest = installationClients.keys().next().value;
    if (oldest !== undefined) installationClients.delete(oldest);
  }
  return client;
}

/** Drop cached state (Octokit + open-PR list) for an installation, e.g. after
 *  uninstall. Safe to call for an installation we never saw. */
export function evictInstallation(installationId: number): void {
  installationClients.delete(installationId);
  openPrsCache.delete(installationId);
  openPrsInflight.delete(installationId);
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

/**
 * Dismiss a previously-submitted PR review. GitHub doesn't allow deleting a
 * submitted review or editing its inline comments wholesale; dismissal is the
 * closest thing — the prior review is collapsed with a dismissal note so the
 * fresh review takes precedence in the PR timeline.
 */
export async function dismissReview(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number,
  reviewId: number,
  message: string
): Promise<void> {
  const { owner, repo } = splitRepo(repoFullName);
  await octokit.rest.pulls.dismissReview({
    owner,
    repo,
    pull_number: prNumber,
    review_id: reviewId,
    message,
  });
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

export interface OpenPullRequest {
  repoFullName: string;
  number: number;
  title: string;
  headSha: string;
  htmlUrl: string;
  updatedAt: string;
}

// In-process TTL cache + in-flight dedupe for the dashboard's per-installation
// PR fan-out. The expensive part is the per-repo `pulls.list` paginate (one
// roundtrip per repo). Two dashboard loads within OPEN_PRS_TTL_MS share the
// cached value; concurrent loads share a single in-flight promise so we never
// fan-out twice for the same installation at the same time.
//
// Per-process, so multi-instance Vercel doesn't share, but a single instance
// serving the user's reloads/multiple tabs gets the win.
const OPEN_PRS_TTL_MS = 30_000;
const openPrsCache = new Map<number, { expiry: number; data: OpenPullRequest[] }>();
const openPrsInflight = new Map<number, Promise<OpenPullRequest[]>>();

/** List open PRs across all repos accessible to an installation. */
export async function listOpenPullRequests(installationId: number): Promise<OpenPullRequest[]> {
  const now = Date.now();
  const cached = openPrsCache.get(installationId);
  if (cached && cached.expiry > now) return cached.data;

  const inflight = openPrsInflight.get(installationId);
  if (inflight) return inflight;

  const promise = fetchOpenPullRequests(installationId)
    .then((data) => {
      openPrsCache.set(installationId, { expiry: Date.now() + OPEN_PRS_TTL_MS, data });
      return data;
    })
    .finally(() => {
      openPrsInflight.delete(installationId);
    });
  openPrsInflight.set(installationId, promise);
  return promise;
}

async function fetchOpenPullRequests(installationId: number): Promise<OpenPullRequest[]> {
  const octokit = getInstallationOctokit(installationId);
  const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });

  // Fetch each repo's open PRs in parallel rather than one round trip at a time.
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const prs = await octokit.paginate(octokit.rest.pulls.list, {
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 100,
      });
      return prs.map((pr) => ({
        repoFullName: repo.full_name,
        number: pr.number,
        title: pr.title,
        headSha: pr.head.sha,
        htmlUrl: pr.html_url,
        updatedAt: pr.updated_at,
      }));
    })
  );
  return perRepo.flat();
}

/**
 * Drop cached open-PR lists for an installation. Call after we've mutated a
 * PR's state so the next dashboard load reflects reality immediately rather
 * than waiting out the TTL.
 */
export function invalidateOpenPullRequestsCache(installationId: number): void {
  openPrsCache.delete(installationId);
}
