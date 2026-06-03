import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/db";
import { listUserInstallations } from "@/lib/users";

export const runtime = "nodejs";

/**
 * Status polling for the dashboard. Returns status + comment_id for the
 * requested job ids: GET /api/jobs?ids=uuid1,uuid2
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  const ids = (idsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ jobs: {} });
  }

  // Authorization: only return jobs that belong to the user's own installations.
  const installations = await listUserInstallations(session.user.id);
  const installationIds = installations.map((i) => i.github_installation_id);
  if (installationIds.length === 0) {
    return NextResponse.json({ jobs: {} });
  }

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("review_jobs")
    .select("id,status,comment_id,error,updated_at")
    .in("id", ids.slice(0, 200))
    .in("installation_id", installationIds);

  const jobs: Record<
    string,
    { status: string; comment_id: number | null; error: string | null; updated_at: string }
  > = {};
  for (const row of data ?? []) {
    jobs[row.id] = {
      status: row.status,
      comment_id: row.comment_id,
      error: row.error,
      updated_at: row.updated_at,
    };
  }
  return NextResponse.json({ jobs });
}
