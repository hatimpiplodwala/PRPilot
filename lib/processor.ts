import { completeJob, failJob } from "./jobs";
import {
  dismissReview,
  getInstallationOctokit,
  getPullRequest,
  listPullRequestFiles,
  postPrComment,
  postReview,
  updatePrComment,
} from "./github";
import { reviewDiff } from "./llm";
import {
  partitionFindings,
  renderReviewBody,
  renderReviewMarkdown,
  renderFailureMarkdown,
} from "./review";
import type { Octokit } from "@octokit/rest";
import type { CommentKind, ReviewJob } from "./types";
import { log } from "./log";

/**
 * The full review pipeline for a single claimed job:
 *   fetch diff -> Gemini review -> map findings to diff lines -> post a PR review
 *   with inline comments (falling back to a summary comment) -> mark done.
 *
 * Shared by the cron processor route and any manual drain.
 */
export async function processJob(job: ReviewJob): Promise<void> {
  const octokit = getInstallationOctokit(job.installation_id);
  const l = log.child({
    kind: "job",
    jobId: job.id,
    installationId: job.installation_id,
    repo: job.repo_full_name,
    pr: job.pr_number,
    trigger: job.trigger,
  });
  const startedAt = Date.now();

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

    // Split findings into inline-anchored (mapped to a commentable diff line)
    // vs. summary-only. Pure + unit-tested in review.ts.
    const { inline, remainingBugs, remainingSuggestions } = partitionFindings(review, files);

    // Publish first, dismiss-prior after. The previous ordering dismissed the
    // prior PR review BEFORE attempting postReview — so a 422 on the new
    // review (e.g. a line drifted out of the diff) would leave the user with
    // a dismissed prior review and only a plain issue comment, losing the
    // original inline annotations. By dismissing AFTER the new publish
    // succeeds, a failed new attempt leaves the prior review intact and we
    // gracefully degrade to "summary comment alongside the still-visible
    // prior review thread".
    //
    // Dismissal also fires for the summary path when the prior was a
    // 'review' (e.g. the new review had no inline-anchorable findings). Old
    // code only dismissed inside the inline branch — so a re-review with all
    // line=null findings would silently accumulate duplicate threads.
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

    // Dismiss any prior 'review'-kind publication now that the new one is
    // safely in place. commentId !== job.comment_id is belt-and-suspenders:
    // if the prior review's id is somehow reused (shouldn't happen, but),
    // never dismiss the one we just posted.
    if (
      job.comment_id &&
      job.comment_kind === "review" &&
      job.comment_id !== commentId
    ) {
      try {
        await dismissReview(
          octokit,
          job.repo_full_name,
          job.pr_number,
          job.comment_id,
          "Superseded by a newer PRPilot review."
        );
      } catch (err) {
        l.warn("dismiss prior review failed; continuing", { err, priorReviewId: job.comment_id });
      }
    }

    await completeJob(job.id, review, commentId, commentKind);
    l.info("job done", {
      durationMs: Date.now() - startedAt,
      commentKind,
      bugs: review.potential_bugs.length,
      suggestions: review.suggestions.length,
      inline: inline.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    l.error("job failed", { err, durationMs: Date.now() - startedAt });
    // Best-effort fallback comment; don't let a comment failure mask the error.
    try {
      await postPrComment(
        octokit,
        job.repo_full_name,
        job.pr_number,
        renderFailureMarkdown(message)
      );
    } catch (postErr) {
      l.warn("failure-comment post failed", { err: postErr });
    }
    await failJob(job.id, message);
  }
}

/**
 * Post (or, for a re-review of the same commit, update in place) the summary
 * issue comment. If the prior comment was deleted, posts a fresh one.
 *
 * Only attempts in-place update when the stored comment_kind is "issue_comment"
 * — the GitHub issues API can't update a PR-review id, so trying to do so on a
 * prior "review" row would always fail and silently fall through to a fresh
 * post. Posting a fresh issue comment is still correct in the kind="review"
 * case (the inline review remains on /files, the new summary lives in
 * Conversation); skipping the doomed update saves one round-trip.
 */
async function postSummaryComment(
  octokit: Octokit,
  job: ReviewJob,
  markdown: string
): Promise<number> {
  if (job.comment_id && job.comment_kind === "issue_comment") {
    try {
      return await updatePrComment(octokit, job.repo_full_name, job.comment_id, markdown);
    } catch {
      return await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
    }
  }
  return await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
}
