import type { ChangedFile, InlineComment, PotentialBug, Review, Severity, Suggestion } from "./types";
import { commentableLines } from "./diff";

/**
 * Pure rendering of a structured Review into the Markdown posted as a PR
 * comment. Plain and professional — no emoji. Uses collapsible <details>
 * sections so it stays compact in the PR timeline. No I/O — unit-tested.
 */

export interface PartitionedFindings {
  /** Findings anchorable to a commentable diff line — posted as inline comments. */
  inline: InlineComment[];
  /** Bugs that couldn't be anchored — folded into the summary body instead. */
  remainingBugs: PotentialBug[];
  /** Suggestions that couldn't be anchored — folded into the summary body. */
  remainingSuggestions: Suggestion[];
}

/**
 * Split a review's findings into those that map to a commentable new-file line
 * (posted inline on the diff) and those that don't (kept for the summary so
 * nothing is lost). Pure — extracted from the processor so it can be unit-tested.
 */
export function partitionFindings(review: Review, files: ChangedFile[]): PartitionedFindings {
  // Which new-file lines are commentable, per file.
  const lineSets = new Map<string, Set<number>>();
  for (const f of files) {
    if (f.patch) lineSets.set(f.filename, commentableLines(f.patch));
  }

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

  return { inline, remainingBugs, remainingSuggestions };
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Body for an inline review comment on a bug. */
export function bugCommentBody(bug: PotentialBug): string {
  return `**Potential bug — ${SEVERITY_LABEL[bug.severity]}.** ${bug.description.trim()}`;
}

/** Body for an inline review comment on a suggestion. */
export function suggestionCommentBody(s: Suggestion): string {
  return `**Suggestion.** ${s.description.trim()}`;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const FOOTER = `\n\n---\n<sub>Automated review by PRPilot. Intended to assist, not replace, human review.</sub>`;

export function renderReviewMarkdown(review: Review, opts?: { truncatedNote?: string }): string {
  const bugs = [...review.potential_bugs].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  const suggestionCount = review.suggestions.length;

  const lines: string[] = [];
  lines.push(`## PRPilot Review`);
  lines.push("");
  lines.push(review.summary.trim() || "No summary provided.");

  if (opts?.truncatedNote) {
    lines.push("");
    lines.push(`> Note: ${opts.truncatedNote}`);
  }

  // Potential bugs
  lines.push("");
  if (bugs.length === 0) {
    lines.push("**Potential bugs**");
    lines.push("");
    lines.push("No likely bugs identified.");
  } else {
    lines.push(`<details open>`);
    lines.push(`<summary><strong>Potential bugs (${bugs.length})</strong></summary>`);
    lines.push("");
    for (const bug of bugs) {
      lines.push(`- **${SEVERITY_LABEL[bug.severity]}** &middot; \`${bug.file}\` — ${bug.description.trim()}`);
    }
    lines.push("");
    lines.push(`</details>`);
  }

  // Suggestions
  lines.push("");
  if (suggestionCount === 0) {
    lines.push("**Suggestions**");
    lines.push("");
    lines.push("No additional suggestions.");
  } else {
    lines.push(`<details>`);
    lines.push(`<summary><strong>Suggestions (${suggestionCount})</strong></summary>`);
    lines.push("");
    for (const s of review.suggestions) {
      lines.push(`- \`${s.file}\` — ${s.description.trim()}`);
    }
    lines.push("");
    lines.push(`</details>`);
  }

  return lines.join("\n") + FOOTER;
}

/**
 * Body for a PR review that carries inline comments. The summary leads, then any
 * findings that could NOT be anchored to a diff line are listed (so nothing is
 * lost), with a note pointing to the inline comments.
 */
export function renderReviewBody(
  summary: string,
  remainingBugs: PotentialBug[],
  remainingSuggestions: Suggestion[],
  opts: { truncatedNote?: string; inlineCount: number }
): string {
  const bugs = [...remainingBugs].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );

  const lines: string[] = [];
  lines.push(`## PRPilot Review`);
  lines.push("");
  lines.push(summary.trim() || "No summary provided.");

  if (opts.truncatedNote) {
    lines.push("");
    lines.push(`> Note: ${opts.truncatedNote}`);
  }

  if (opts.inlineCount > 0) {
    lines.push("");
    lines.push(
      `Left ${opts.inlineCount} inline comment${opts.inlineCount === 1 ? "" : "s"} on the relevant line${opts.inlineCount === 1 ? "" : "s"} below.`
    );
  }

  if (bugs.length > 0) {
    lines.push("");
    lines.push(`**Other potential bugs (${bugs.length})**`);
    lines.push("");
    for (const bug of bugs) {
      lines.push(`- **${SEVERITY_LABEL[bug.severity]}** &middot; \`${bug.file}\` — ${bug.description.trim()}`);
    }
  }

  if (remainingSuggestions.length > 0) {
    lines.push("");
    lines.push(`**Other suggestions (${remainingSuggestions.length})**`);
    lines.push("");
    for (const s of remainingSuggestions) {
      lines.push(`- \`${s.file}\` — ${s.description.trim()}`);
    }
  }

  return lines.join("\n") + FOOTER;
}

/**
 * Short comment used when an automated review could not be completed.
 *
 * The raw error message is posted publicly on the PR, so we run it through a
 * conservative sanitizer first. Library/HTTP errors occasionally embed tokens,
 * URLs with credentials, or env-shaped lines — those should never reach a
 * collaborator's eyes.
 */
export function renderFailureMarkdown(reason: string): string {
  return `## PRPilot Review\n\nThe automated review could not be completed: ${sanitizeForPublic(reason)}${FOOTER}`;
}

/** Exported for tests. */
export function sanitizeForPublic(message: string): string {
  let out = message;
  // GitHub installation tokens.
  out = out.replace(/ghs_[A-Za-z0-9]{20,}/g, "[redacted-token]");
  // GitHub PATs / OAuth tokens.
  out = out.replace(/gh[oprsu]_[A-Za-z0-9]{20,}/g, "[redacted-token]");
  // Bearer/Authorization headers.
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]");
  // Consume the rest of the line (or up to a comma) after `Authorization:` —
  // the previous pattern (`[^\s,]+`) stopped at the first whitespace, so
  // `Authorization: Basic <base64>` only redacted "Basic" and left the
  // base64 credential exposed.
  out = out.replace(/Authorization:\s*[^,\n\r]+/gi, "Authorization: [redacted]");
  // URL credentials (https://user:pass@host).
  out = out.replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[redacted]@");
  // Long base64-ish blobs (likely keys/JWTs); leave shorter ids alone.
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}(?:\.[A-Za-z0-9_-]+)?\b/g, "[redacted]");
  // Anything looking like SECRET=value / API_KEY: value.
  out = out.replace(/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*\S+/g, "$1=[redacted]");

  // Cap so a huge stack trace can't dominate the PR conversation.
  const MAX = 500;
  if (out.length > MAX) out = out.slice(0, MAX) + "…";
  return out;
}
