import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDashboardData } from "@/lib/dashboard";
import { env } from "@/lib/env";
import { PrTable } from "@/components/pr-table";
import { Button } from "@/components/ui/button";
import { LogoMark, Wordmark } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const { hasInstallations, prs, rateLimit } = await getDashboardData(session.user.id);
  const installUrl = `https://github.com/apps/${env.githubAppSlug}/installations/new`;

  const login = session.user.login ?? session.user.name;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <Wordmark />
          </div>
          <div className="flex items-center gap-4">
            {login && <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{login}</span>}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {!hasInstallations ? (
          <div className="gloss rounded-lg border border-border bg-card p-10 text-center">
            <h2 className="text-base font-medium">Install PRPilot on your repositories</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Grant access to the repos you want reviewed. PRPilot will review pull requests as
              they open and let you trigger reviews manually here.
            </p>
            <a href={installUrl} className="mt-6 inline-block">
              <Button>Install GitHub App</Button>
            </a>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Open pull requests ({prs.length})
              </h2>
              <a href={installUrl} className="text-xs text-muted-foreground hover:underline">
                Manage repositories
              </a>
            </div>
            <PrTable initialRows={prs} rateLimit={rateLimit} />
          </>
        )}
      </main>
    </div>
  );
}
