import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { listUserInstallations } from "@/lib/users";
import { consumeRateLimit } from "@/lib/ratelimit";
import { enqueueJob } from "@/lib/jobs";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const Body = z.object({
  installationId: z.number().int().positive(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(7),
});

/** Manual "Review now": rate-limited, ownership-checked, enqueues a job. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { installationId, repoFullName, prNumber, headSha } = parsed.data;

  // Ownership: the installation must belong to the logged-in user.
  const installations = await listUserInstallations(session.user.id);
  if (!installations.some((i) => i.github_installation_id === installationId)) {
    return NextResponse.json({ error: "Installation not found" }, { status: 403 });
  }

  // Per-user rate limit.
  const rl = await consumeRateLimit(`user:${session.user.id}`, env.rateLimitPerHour);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Rate limit reached (${rl.limit}/hour). Try again later.` },
      { status: 429 }
    );
  }

  const { job } = await enqueueJob({
    installationId,
    repoFullName,
    prNumber,
    headSha,
    trigger: "manual",
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
