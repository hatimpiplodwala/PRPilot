import { describe, it, expect } from "vitest";
import {
  isReviewableFile,
  fileScore,
  selectFilesForReview,
  buildDiffText,
} from "@/lib/diff";
import type { ChangedFile } from "@/lib/types";

function file(partial: Partial<ChangedFile>): ChangedFile {
  return {
    filename: "src/index.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@\n-old\n+new",
    ...partial,
  };
}

describe("isReviewableFile", () => {
  it("accepts a normal modified source file with a patch", () => {
    expect(isReviewableFile(file({}))).toBe(true);
  });

  it("rejects removed files", () => {
    expect(isReviewableFile(file({ status: "removed" }))).toBe(false);
  });

  it("rejects files without a patch (binary/too large)", () => {
    expect(isReviewableFile(file({ patch: undefined }))).toBe(false);
  });

  it("rejects lockfiles regardless of directory", () => {
    expect(isReviewableFile(file({ filename: "frontend/package-lock.json" }))).toBe(false);
    expect(isReviewableFile(file({ filename: "pnpm-lock.yaml" }))).toBe(false);
  });

  it("rejects images and minified assets", () => {
    expect(isReviewableFile(file({ filename: "public/logo.png" }))).toBe(false);
    expect(isReviewableFile(file({ filename: "static/app.min.js" }))).toBe(false);
  });

  it("rejects vendored/build directories", () => {
    expect(isReviewableFile(file({ filename: "dist/bundle.js" }))).toBe(false);
    expect(isReviewableFile(file({ filename: "node_modules/x/index.js" }))).toBe(false);
  });
});

describe("fileScore", () => {
  it("sums additions and deletions", () => {
    expect(fileScore(file({ additions: 3, deletions: 4 }))).toBe(7);
  });
});

describe("selectFilesForReview", () => {
  it("filters non-reviewable files and reports truncation", () => {
    const files = [
      file({ filename: "a.ts", additions: 1 }),
      file({ filename: "yarn.lock", additions: 999 }),
    ];
    const result = selectFilesForReview(files, 10);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("a.ts");
    expect(result.truncated).toBe(true); // a non-reviewable file was excluded
  });

  it("ranks by significance and caps to maxFiles", () => {
    const files = [
      file({ filename: "small.ts", additions: 1, deletions: 0 }),
      file({ filename: "big.ts", additions: 50, deletions: 10 }),
      file({ filename: "mid.ts", additions: 5, deletions: 5 }),
    ];
    const result = selectFilesForReview(files, 2);
    expect(result.files.map((f) => f.filename)).toEqual(["big.ts", "mid.ts"]);
    expect(result.skipped).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when everything fits and is reviewable", () => {
    const files = [file({ filename: "a.ts" }), file({ filename: "b.ts" })];
    const result = selectFilesForReview(files, 10);
    expect(result.truncated).toBe(false);
    expect(result.skipped).toBe(0);
  });

  it("returns no files when maxFiles is zero", () => {
    const result = selectFilesForReview([file({})], 0);
    expect(result.files).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });
});

describe("buildDiffText", () => {
  it("includes filename, stats, and patch in a fenced block", () => {
    const text = buildDiffText([file({ filename: "x.ts", additions: 2, deletions: 1 })]);
    expect(text).toContain("### x.ts (modified, +2/-1)");
    expect(text).toContain("```diff");
    expect(text).toContain("+new");
  });
});
