import { describe, it, expect } from "vitest";
import { hourWindowStart, isWithinLimit } from "@/lib/ratelimit";

describe("hourWindowStart", () => {
  it("floors to the start of the UTC hour", () => {
    const start = hourWindowStart(new Date("2026-06-02T14:37:21.500Z"));
    expect(start).toBe("2026-06-02T14:00:00.000Z");
  });

  it("returns the same bucket for two times in the same hour", () => {
    const a = hourWindowStart(new Date("2026-06-02T14:00:00Z"));
    const b = hourWindowStart(new Date("2026-06-02T14:59:59Z"));
    expect(a).toBe(b);
  });

  it("returns different buckets across an hour boundary", () => {
    const a = hourWindowStart(new Date("2026-06-02T14:59:59Z"));
    const b = hourWindowStart(new Date("2026-06-02T15:00:00Z"));
    expect(a).not.toBe(b);
  });
});

describe("isWithinLimit", () => {
  it("allows when the prior count is below the limit", () => {
    expect(isWithinLimit(0, 15)).toBe(true);
    expect(isWithinLimit(14, 15)).toBe(true);
  });

  it("blocks at and beyond the limit", () => {
    expect(isWithinLimit(15, 15)).toBe(false);
    expect(isWithinLimit(20, 15)).toBe(false);
  });
});
