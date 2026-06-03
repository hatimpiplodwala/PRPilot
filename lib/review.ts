import type { PotentialBug, Review, Severity, Suggestion } from "./types";

/**
 * Pure rendering of a structured Review into the Markdown posted as a PR
 * comment. Plain and professional — no emoji. Uses collapsible <details>
 * sections so it stays compact in the PR timeline. No I/O — unit-tested.
 */

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

/** Short comment used when an automated review could not be completed. */
export function renderFailureMarkdown(reason: string): string {
  return `## PRPilot Review\n\nThe automated review could not be completed: ${reason}${FOOTER}`;
}
