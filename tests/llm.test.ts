import { describe, it, expect } from "vitest";
import { parseReview } from "@/lib/llm";

describe("parseReview", () => {
  it("parses a well-formed review", () => {
    const review = parseReview(
      JSON.stringify({
        summary: "ok",
        potential_bugs: [{ file: "a.ts", description: "bug", severity: "high" }],
        suggestions: [{ file: "b.ts", description: "tidy" }],
      })
    );
    expect(review.summary).toBe("ok");
    expect(review.potential_bugs[0].severity).toBe("high");
    expect(review.suggestions[0].file).toBe("b.ts");
  });

  it("defaults an invalid severity to medium", () => {
    const review = parseReview(
      JSON.stringify({
        summary: "ok",
        potential_bugs: [{ file: "a.ts", description: "bug", severity: "catastrophic" }],
        suggestions: [],
      })
    );
    expect(review.potential_bugs[0].severity).toBe("medium");
  });

  it("coerces missing fields to safe defaults", () => {
    const review = parseReview(
      JSON.stringify({ summary: "ok", potential_bugs: [{}], suggestions: [{}] })
    );
    expect(review.potential_bugs[0].file).toBe("");
    expect(review.potential_bugs[0].severity).toBe("medium");
    expect(review.suggestions[0].description).toBe("");
  });

  it("keeps a valid positive integer line and drops invalid ones", () => {
    const review = parseReview(
      JSON.stringify({
        summary: "ok",
        potential_bugs: [
          { file: "a.ts", description: "bug", severity: "high", line: 42 },
          { file: "b.ts", description: "bug", severity: "low", line: 0 },
          { file: "c.ts", description: "bug", severity: "low", line: 3.5 },
        ],
        suggestions: [{ file: "d.ts", description: "tidy" }],
      })
    );
    expect(review.potential_bugs[0].line).toBe(42);
    expect(review.potential_bugs[1].line).toBeUndefined();
    expect(review.potential_bugs[2].line).toBeUndefined();
    expect(review.suggestions[0].line).toBeUndefined();
  });

  it("throws on non-object JSON", () => {
    expect(() => parseReview("42")).toThrow();
  });

  it("throws when required arrays are missing", () => {
    expect(() => parseReview(JSON.stringify({ summary: "x" }))).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseReview("{not json")).toThrow();
  });
});
