import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/db";
import { listUserInstallations } from "@/lib/users";
import type { CommentKind } from "@/lib/types";

export const runtime = "nodejs";

// Per-user data; never let a CDN, browser, or shared proxy cache it.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}

interface JobPayload {
  status: string;
  comment_id: number | null;
  comment_kind: CommentKind | null;
  error: string | null;
  updated_at: string;
  /** Present only when ?details=summary is set and the row has a stored review. */
  summary?: string;
}

/**
 * Status polling for the dashboard. Returns status + comment_id for the
 * requested job ids: GET /api/jobs?ids=uuid1,uuid2.
 *
 * Pass ?details=summary to additionally include the review summary text for
 * done jobs. The dashboard uses this for lazy "expand row" reads so the regular
 * 4s polling payload stays small.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonNoStore({ error: "Not authenticated" }, { status: 401 });
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  // Drop any token that isn't a UUID — otherwise Supabase rejects the whole
  // .in() query with 22P02 and we'd return zero results for the valid ones too.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
  if (ids.length === 0) {
    return jsonNoStore({ jobs: {} });
  }
  const wantSummary = req.nextUrl.searchParams.get("details") === "summary";

  // Authorization: only return jobs that belong to the user's own installations.
  const installations = await listUserInstallations(session.user.id);
  const installationIds = installations.map((i) => i.github_installation_id);
  if (installationIds.length === 0) {
    return jsonNoStore({ jobs: {} });
  }

  // We always try with comment_kind first. If the column hasn't been added to
  // the database yet (deploy ordered before the migration), Supabase returns
  // 42703 and we fall back to the pre-migration shape so polling stays alive.
  //
  // For summary reads we use a jsonb path expression (`result_json->>summary`)
  // so Postgres ships only the summary text, not the entire review jsonb.
  const withKind = wantSummary
    ? "id,status,comment_id,comment_kind,error,updated_at,summary:result_json->>summary"
    : "id,status,comment_id,comment_kind,error,updated_at";
  const withoutKind = wantSummary
    ? "id,status,comment_id,error,updated_at,summary:result_json->>summary"
    : "id,status,comment_id,error,updated_at";

  const supabase = getServiceSupabase();
  let { data, error } = await supabase
    .from("review_jobs")
    .select(withKind)
    .in("id", ids.slice(0, 200))
    .in("installation_id", installationIds);
  if (error?.code === "42703") {
    ({ data } = await supabase
      .from("review_jobs")
      .select(withoutKind)
      .in("id", ids.slice(0, 200))
      .in("installation_id", installationIds));
  }

  const jobs: Record<string, JobPayload> = {};
  // Supabase's typed query builder doesn't infer well on a dynamic column list,
  // so widen to a hand-typed row shape via `unknown`.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    status: string;
    comment_id: number | null;
    comment_kind: CommentKind | null;
    error: string | null;
    updated_at: string;
    summary?: string | null;
  }>;
  for (const row of rows) {
    const payload: JobPayload = {
      status: row.status,
      comment_id: row.comment_id,
      comment_kind: row.comment_kind ?? null,
      error: row.error,
      updated_at: row.updated_at,
    };
    if (wantSummary && row.summary) {
      payload.summary = row.summary;
    }
    jobs[row.id] = payload;
  }
  return jsonNoStore({ jobs });
}
