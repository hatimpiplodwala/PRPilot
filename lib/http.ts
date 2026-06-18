import { NextResponse } from "next/server";

/**
 * Shared response helpers for the API routes.
 */

// Per-user / mutating API responses must never be cached by a browser, CDN, or
// any shared proxy — they'd leak one user's data to the next.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** NextResponse.json with no-store cache headers attached. */
export function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
