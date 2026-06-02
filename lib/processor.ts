import { completeJob, failJob } from "./jobs";
import {
  getInstallationOctokit,
  getPullRequest,
  listPullRequestFiles,
  postPrComment,
  updatePrComment,
} from "./github";
import { reviewDiff } from "./llm";
import { renderReviewMarkdown, renderFailureMarkdown } from "./review";
import type { ReviewJob } from "./types";

/**
 * The full review pipeline for a single claimed job:
 *   fetch diff -> Gemini review -> render Markdown -> post PR comment -> mark done.
 * On failure, marks the job failed and posts a short fallback comment.
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

    const markdown = renderReviewMarkdown(review, { truncatedNote });
    // Re-review of the same commit updates the existing comment in place. If that
    // comment was deleted (404) or is otherwise unreachable, post a fresh one.
    let commentId: number;
    if (job.comment_id) {
      try {
        commentId = await updatePrComment(octokit, job.repo_full_name, job.comment_id, markdown);
      } catch {
        commentId = await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
      }
    } else {
      commentId = await postPrComment(octokit, job.repo_full_name, job.pr_number, markdown);
    }

    await completeJob(job.id, review, commentId);
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
