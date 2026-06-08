import { describe, it, expect } from "vitest";
import { renderReviewMarkdown, renderFailureMarkdown, sanitizeForPublic } from "@/lib/review";
import type { Review } from "@/lib/types";

const base: Review = {
  summary: "Looks solid overall.",
  potential_bugs: [],
  suggestions: [],
};

describe("renderReviewMarkdown", () => {
  it("shows the summary and clean-bill messages when empty", () => {
    const md = renderReviewMarkdown(base);
    expect(md).toContain("Looks solid overall.");
    expect(md).toContain("No likely bugs identified");
    expect(md).toContain("No additional suggestions");
  });

  it("contains no emoji (professional output)", () => {
    const md = renderReviewMarkdown({
      ...base,
      potential_bugs: [{ file: "a.ts", description: "x", severity: "high" }],
      suggestions: [{ file: "b.ts", description: "y" }],
    });
    // Match any emoji / pictographic code point.
    expect(/\p{Extended_Pictographic}/u.test(md)).toBe(false);
  });

  it("renders bugs with severity labels inside a collapsible section", () => {
    const md = renderReviewMarkdown({
      ...base,
      potential_bugs: [
        { file: "a.ts", description: "off-by-one", severity: "high" },
        { file: "b.ts", description: "unchecked null", severity: "low" },
      ],
    });
    expect(md).toContain("<details open>");
    expect(md).toContain("Potential bugs (2)");
    expect(md).toContain("**High**");
    expect(md).toContain("**Low**");
    expect(md).toContain("`a.ts`");
    expect(md).toContain("off-by-one");
  });

  it("sorts bugs by severity (high first)", () => {
    const md = renderReviewMarkdown({
      ...base,
      potential_bugs: [
        { file: "a.ts", description: "low one", severity: "low" },
        { file: "b.ts", description: "high one", severity: "high" },
      ],
    });
    expect(md.indexOf("high one")).toBeLessThan(md.indexOf("low one"));
  });

  it("renders suggestions in a collapsible section", () => {
    const md = renderReviewMarkdown({
      ...base,
      suggestions: [{ file: "c.ts", description: "extract helper" }],
    });
    expect(md).toContain("Suggestions (1)");
    expect(md).toContain("extract helper");
  });

  it("includes a truncation note when provided", () => {
    const md = renderReviewMarkdown(base, { truncatedNote: "Reviewed 20 of 40 files." });
    expect(md).toContain("Reviewed 20 of 40 files.");
  });

  it("always includes the PRPilot footer", () => {
    expect(renderReviewMarkdown(base)).toContain("Automated review by PRPilot");
  });
});

describe("renderFailureMarkdown", () => {
  it("explains the failure reason", () => {
    const md = renderFailureMarkdown("Gemini timed out");
    expect(md).toContain("could not be completed");
    expect(md).toContain("Gemini timed out");
  });

  it("redacts secret-shaped patterns before they reach the PR", () => {
    const md = renderFailureMarkdown(
      "Auth error: Authorization: Bearer ghs_abcdefghijklmnopqrstuvwxyz0123456789"
    );
    expect(md).not.toMatch(/ghs_[A-Za-z0-9]/);
    expect(md).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(md).toContain("[redacted");
  });
});

describe("sanitizeForPublic", () => {
  it("redacts GitHub installation tokens", () => {
    expect(sanitizeForPublic("token=ghs_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[redacted-token]");
  });

  it("redacts GitHub PATs / OAuth tokens", () => {
    expect(sanitizeForPublic("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[redacted-token]");
    expect(sanitizeForPublic("gho_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[redacted-token]");
  });

  it("redacts Bearer tokens and Authorization headers", () => {
    expect(sanitizeForPublic("Bearer eyJabc.def.ghi-jkl_mno")).toContain("Bearer [redacted]");
    expect(sanitizeForPublic("Authorization: deadbeef-token")).toContain("Authorization: [redacted]");
  });

  it("redacts the credential portion of multi-word Authorization schemes (Basic, Digest, etc.)", () => {
    const out = sanitizeForPublic("Authorization: Basic YWRtaW46aHVudGVyMg==");
    expect(out).toContain("Authorization: [redacted]");
    expect(out).not.toContain("YWRtaW46aHVudGVyMg==");
  });

  it("redacts URL embedded credentials", () => {
    expect(sanitizeForPublic("https://user:secret@example.com")).toContain("https://[redacted]@example.com");
  });

  it("redacts env-shaped key/secret lines", () => {
    expect(sanitizeForPublic("GEMINI_API_KEY=abc123")).toContain("GEMINI_API_KEY=[redacted]");
    expect(sanitizeForPublic("DB_PASSWORD: hunter2")).toContain("DB_PASSWORD=[redacted]");
  });

  it("redacts JWT-shaped triples", () => {
    const jwt = "a".repeat(40) + "." + "b".repeat(40) + "." + "c".repeat(40);
    expect(sanitizeForPublic(jwt)).toBe("[redacted]");
  });

  it("caps very long messages", () => {
    const huge = "x".repeat(2000);
    const out = sanitizeForPublic(huge);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short, harmless text alone", () => {
    expect(sanitizeForPublic("Gemini timed out after 25s")).toBe("Gemini timed out after 25s");
  });
});
