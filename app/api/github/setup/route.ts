import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAppOctokit } from "@/lib/github";
import { upsertInstallation } from "@/lib/users";

/**
 * GitHub redirects here after a user installs (or updates) the App
 * ("Setup URL" in the App settings), with ?installation_id=...&setup_action=...
 * We link the installation to the logged-in user so it shows on their dashboard.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const installationId = req.nextUrl.searchParams.get("installation_id");

  if (!session?.user?.id) {
    // Not logged in — send to sign-in, then back here.
    const callback = encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/api/auth/signin?callbackUrl=${callback}`, req.url));
  }

  if (installationId) {
    try {
      const app = getAppOctokit();
      const { data } = await app.rest.apps.getInstallation({
        installation_id: Number(installationId),
      });
      const accountLogin =
        data.account && "login" in data.account ? data.account.login : null;

      // Only link the installation to this user if its GitHub account matches the
      // signed-in user. Installation ids are guessable, so without this check a
      // user could claim someone else's installation by visiting this URL. This
      // covers personal-account installs (the target use case); org installs are
      // left to be recorded (unlinked) by the installation webhook.
      const owns =
        !!accountLogin &&
        !!session.user.login &&
        accountLogin.toLowerCase() === session.user.login.toLowerCase();

      if (owns) {
        await upsertInstallation({
          githubInstallationId: Number(installationId),
          accountLogin,
          userId: session.user.id,
        });
      }
    } catch {
      // Non-fatal: the installation webhook will also record it.
    }
  }

  return NextResponse.redirect(new URL("/dashboard", req.url));
}
