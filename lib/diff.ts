import type { ChangedFile } from "./types";

/**
 * Pure diff-handling helpers. No I/O — fully unit-tested.
 *
 * GitHub's "list pull request files" API returns one entry per changed file
 * with a `patch` (unified-diff hunk). We decide which files are worth sending
 * to the LLM, rank them by significance, cap the count, and render a compact
 * text block for the prompt.
 */

/** Files we never want to spend LLM tokens on. */
const SKIP_EXACT = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "Gemfile.lock",
]);

const SKIP_EXTENSIONS = [
  // images / binaries / media
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
  ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov",
  // maps / minified
  ".map", ".min.js", ".min.css",
];

const SKIP_DIR_SEGMENTS = ["node_modules/", "dist/", "build/", ".next/", "vendor/"];

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** True if a changed file is worth reviewing. */
export function isReviewableFile(file: ChangedFile): boolean {
  if (file.status === "removed") return false; // nothing to review in deleted files
  if (!file.patch) return false; // binary / too large — GitHub omits the patch

  const name = file.filename.toLowerCase();
  if (SKIP_EXACT.has(basename(name))) return false;
  if (SKIP_EXTENSIONS.some((ext) => name.endsWith(ext))) return false;
  if (SKIP_DIR_SEGMENTS.some((seg) => name.includes(seg))) return false;

  return true;
}

/** Significance score: more changed lines = more worth reviewing. */
export function fileScore(file: ChangedFile): number {
  return (file.additions ?? 0) + (file.deletions ?? 0);
}

export interface SelectedFiles {
  files: ChangedFile[];
  /** Count of reviewable files left out because of the cap. */
  skipped: number;
  /** True if anything (cap or non-reviewable) was excluded. */
  truncated: boolean;
}

/**
 * Filter to reviewable files, rank by significance, and keep at most `maxFiles`.
 * Reports whether anything was left out so the summary can say so.
 */
export function selectFilesForReview(files: ChangedFile[], maxFiles: number): SelectedFiles {
  const reviewable = files.filter(isReviewableFile);
  const ranked = [...reviewable].sort((a, b) => fileScore(b) - fileScore(a));
  const kept = ranked.slice(0, Math.max(0, maxFiles));
  const skipped = ranked.length - kept.length;
  const truncated = skipped > 0 || reviewable.length < files.length;
  return { files: kept, skipped, truncated };
}

/** Render selected files into a compact diff block for the LLM prompt. */
export function buildDiffText(files: ChangedFile[]): string {
  return files
    .map((f) => {
      const header = `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`;
      return `${header}\n\`\`\`diff\n${f.patch ?? ""}\n\`\`\``;
    })
    .join("\n\n");
}
