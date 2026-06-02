import { getServiceSupabase } from "./db";

/**
 * Per-subject fixed-window rate limiting.
 *
 * The window math is pure and unit-tested; the counter increment uses an
 * atomic upsert against the `rate_limits` table.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Start of the hour bucket containing `now` (UTC), as an ISO string. */
export function hourWindowStart(now: Date = new Date()): string {
  const ms = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return new Date(ms).toISOString();
}

/** Pure check: is `count` (the count BEFORE this request) under the limit? */
export function isWithinLimit(countBeforeRequest: number, limit: number): boolean {
  return countBeforeRequest < limit;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Atomically record one request for `subject` in the current hour window and
 * report whether it was within `limit`. Relies on the Postgres function
 * `increment_rate_limit` (see supabase/schema-rpc.sql) for atomicity.
 */
export async function consumeRateLimit(subject: string, limit: number): Promise<RateLimitResult> {
  const supabase = getServiceSupabase();
  const windowStart = hourWindowStart();

  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_subject: subject,
    p_window_start: windowStart,
  });

  if (error) {
    // Fail open is risky for quota; fail closed but surface the error upstream.
    throw new Error(`rate limit check failed: ${error.message}`);
  }

  const countAfter = (data as number) ?? 1;
  const countBefore = countAfter - 1;
  return {
    allowed: isWithinLimit(countBefore, limit),
    remaining: Math.max(0, limit - countAfter),
    limit,
  };
}
