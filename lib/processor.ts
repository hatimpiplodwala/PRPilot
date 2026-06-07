import { completeJob, failJob } from "./jobs";
import {
  getInstallationOctokit,
  getPullRequest,
  listPullRequestFiles,
  postPrComment,
  postReview,
  updatePrComment,
  type InlineComment,
} from "./github";
import { commentableLines } from "./diff";
import { reviewDiff } from "./llm";
import {
  bugCommentBody,
  renderReviewBody,
  renderReviewMarkdown,
  renderFailureMarkdown,
  suggestionCommentBody,
} from "./review";
import type { Octokit } from "@octokit/rest";
import type { CommentKind, PotentialBug, ReviewJob, Suggestion } from "./types";

/**
 * The full review pipeline for a single claimed job:
 *   fetch diff -> Gemini review -> map findings to diff lines -> post a PR review
 *   with inline comments (falling back to a summary comment) -> mark done.
 *
 * Shared by the cron processor route and any manual drain.
 */
export async function processJob(job: ReviewJob): Promise<void> {
  const octokit = getInstallationOctokit(job.installation_id);

  try {
    const [pr, files] = await Promise.all([
      getPullRequest(octokit, job.repo_full_name, job.pr_number),
      listPullRequestFiles(octokit, job.repo_full_name, job.pr_number),
    ]);

    const { review, truncatedNote } = await reviewDiff(files, {
      repo: job.repo_full_name,
      prNumber: job.pr_number,
      title: pr.title,
      body: pr.body ?? undefined,
    });

    // Which new-file lines are commentable, per file.
    const lineSets = new Map<string, Set<number>>();
    for (const f of files) {
      if (f.patch) lineSets.set(f.filename, commentableLines(f.patch));
    }

    // Split findings into inline-anchored vs. summary-only.
    const inline: InlineComment[] = [];
    const remainingBugs: PotentialBug[] = [];
    const remainingSuggestions: Suggestion[] = [];

    for (const bug of review.potential_bugs) {
      if (bug.line && lineSets.get(bug.file)?.has(bug.line)) {
        inline.push({ path: bug.file, line: bug.line, body: bugCommentBody(bug) });
      } else {
        remainingBugs.push(bug);
      }
    }
    for (const s of review.suggestions) {
      if (s.line && lineSets.get(s.file)?.has(s.line)) {
        inline.push({ path: s.file, line: s.line, body: suggestionCommentBody(s) });
      } else {
        remainingSuggestions.push(s);
      }
    }

    let commentId: number;
    let commentKind: CommentKind;
    if (inline.length > 0) {
      const body = renderReviewBody(review.summary, remainingBugs, remainingSuggestions, {
        truncatedNote,
        inlineCount: inline.length,
      });
      try {
        commentId = await postReview(
          octokit,
          job.repo_full_name,
          job.pr_number,
          pr.headSha,
          body,
          inline
        );
        commentKind = "review";
      } catch {
        // Inline review rejected (e.g. a line drifted out of the diff) — fall back
        // to a single summary comment containing everything.
        commentId = await postSummaryComment(
          octokit,
          job,
          renderReviewMarkdown(review, { truncatedNote })
        );
        commentKind = "issue_comment";
      }
    } else {
      commentId = await postSummaryComment(
        octokit,
        job,
        renderReviewMarkdown(review, { truncatedNote })
      );
      commentKind = "issue_comment";
    }

    await completeJob(job.id, review, commentId, commentKind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort fallback comment; don't let a comment failure mask the error.
    try {
      await postPrComment(
        octokit,
        job.repo_full_name,
        job.pr_number,
        renderFailureMarkdown(message)
      );
    } catch {
      /* ignore */
    }
    await failJob(job.id, message);
  }
}

/**
 * Post (or, for a re-review of the same commit, update in place) the summary
 * issue comment. If the prior comment was deleted, posts a fresh one.
 */
async function postSummaryComment(
  octokit: Octokit,
  job: ReviewJob,
  markdown: string
): Promise<number> {
  if (job.comment_id) {
    try {
      return await updatePrComment(octokit, job.repo_full_name, job.comment_id, markdown);
    } catch {
      return await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
    }
  }
  return await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
}
