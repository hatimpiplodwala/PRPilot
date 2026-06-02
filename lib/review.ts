import type { Review, Severity } from "./types";

/**
 * Pure rendering of a structured Review into the Markdown posted as a PR
 * comment. Plain and professional — no emoji. Uses collapsible <details>
 * sections so it stays compact in the PR timeline. No I/O — unit-tested.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

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

/** Short comment used when an automated review could not be completed. */
export function renderFailureMarkdown(reason: string): string {
  return `## PRPilot Review\n\nThe automated review could not be completed: ${reason}${FOOTER}`;
}
