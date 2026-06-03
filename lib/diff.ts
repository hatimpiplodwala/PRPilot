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

interface PatchLine {
  /** Line number in the new file; null for removed/meta lines. */
  newLine: number | null;
  type: "add" | "del" | "context" | "meta";
  text: string; // raw patch line, including its leading +/-/space
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified-diff patch into lines tagged with their new-file line number.
 * Pure and total — unknown lines are treated as context.
 */
export function parsePatch(patch: string): PatchLine[] {
  const out: PatchLine[] = [];
  let newLine = 0; // 0 = not inside a hunk yet
  for (const text of patch.split("\n")) {
    const hunk = text.match(HUNK_HEADER);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      out.push({ newLine: null, type: "meta", text });
      continue;
    }
    // Anything before the first hunk header (or a "\ No newline" marker) is meta.
    if (newLine === 0 || text.startsWith("\\")) {
      out.push({ newLine: null, type: "meta", text });
      continue;
    }
    if (text.startsWith("+")) {
      out.push({ newLine, type: "add", text });
      newLine++;
    } else if (text.startsWith("-")) {
      out.push({ newLine: null, type: "del", text });
    } else {
      out.push({ newLine, type: "context", text });
      newLine++;
    }
  }
  return out;
}

/**
 * New-file line numbers that can carry an inline review comment on the RIGHT
 * side — i.e. added and context lines that are part of the diff. GitHub rejects
 * a review whose comments fall outside the diff, so we validate against this.
 */
export function commentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  for (const l of parsePatch(patch)) {
    if (l.newLine !== null && (l.type === "add" || l.type === "context")) {
      lines.add(l.newLine);
    }
  }
  return lines;
}

/**
 * Render selected files into a compact diff block for the LLM prompt. Each
 * added/context line is prefixed with its new-file line number so the model can
 * cite exact lines, which we then map to inline review comments.
 */
export function buildDiffText(files: ChangedFile[]): string {
  return files
    .map((f) => {
      const header = `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`;
      const body = parsePatch(f.patch ?? "")
        .map((l) => (l.newLine !== null ? `${l.newLine}: ${l.text}` : l.text))
        .join("\n");
      return `${header}\n\`\`\`diff\n${body}\n\`\`\``;
    })
    .join("\n\n");
}
