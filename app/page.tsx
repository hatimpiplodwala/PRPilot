import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { LogoMark, Wordmark } from "@/components/logo";
import { ReviewPreview } from "@/components/review-preview";
import { InstallMock } from "@/components/install-mock";
import { StickyMobileCta } from "@/components/sticky-mobile-cta";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <Wordmark />
          </div>
          <a
            href="https://github.com/hatimpiplodwala/PRPilot"
            target="_blank"
            rel="noreferrer"
            className="rounded font-mono text-xs text-muted-foreground underline decoration-transparent underline-offset-4 transition-colors hover:text-foreground hover:decoration-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            github.com/PRPilot
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Automated PR review
            </p>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              A reviewer on every pull request.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              PRPilot reads the diff the moment a PR opens and posts a structured review as a
              comment — likely bugs ranked by severity and concrete suggestions, with none of the
              nitpicks.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo: "/dashboard" });
                }}
              >
                <Button type="submit" size="lg">
                  Continue with GitHub
                </Button>
              </form>
              <span className="font-mono text-xs text-muted-foreground">
                Free · runs on your repos
              </span>
            </div>
          </div>

          {/* The product itself, as the hero visual */}
          <div className="lg:pl-2">
            <ReviewPreview />
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border py-14">
          <div className="mb-10 grid items-center gap-8 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                Install in 30 seconds
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                You stay in control of what PRPilot sees.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                PRPilot installs as a GitHub App, not an OAuth scope. You pick the repositories
                — switch them anytime — and grant only what&apos;s needed to read diffs and
                comment back on PRs.
              </p>
              <ul className="mt-5 space-y-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <li>· Personal account or any org you admin</li>
                <li>· Per-repo, not org-wide</li>
                <li>· Three least-privilege permissions</li>
              </ul>
            </div>
            <div className="lg:pl-2">
              <InstallMock />
            </div>
          </div>

          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <Step n="01" title="Install the app" desc="Grant access to the repositories you want reviewed. Permissions are least-privilege." />
            <Step n="02" title="Open a pull request" desc="PRPilot triggers automatically on open and reopen. No commands, no config." />
            <Step n="03" title="Get the review" desc="A structured comment lands in seconds. Re-run it manually anytime from your dashboard." />
          </div>
        </section>

        {/* What it does — replaces the generic feature-card grid */}
        <section className="border-t border-border py-14">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            What you get
          </h2>
          <dl className="mt-6 divide-y divide-border">
            <Capability term="Likely bugs, ranked" desc="Probable defects and real risks, each labeled High, Medium, or Low — sorted so the important ones lead." />
            <Capability term="Concrete suggestions" desc="Actionable improvements tied to specific files. High-signal, never a wall of style nitpicks." />
            <Capability term="Hands-off automation" desc="Reviews post the moment a PR opens. A manual “Review now” is there for re-runs after fixes." />
          </dl>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark className="h-5 w-5" />
            <Wordmark className="text-foreground" />
            <span className="ml-2">Intended to assist, not replace, human review.</span>
          </div>
          <a
            href="https://github.com/hatimpiplodwala/PRPilot"
            target="_blank"
            rel="noreferrer"
            className="rounded underline decoration-transparent underline-offset-4 transition-colors hover:text-foreground hover:decoration-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            View source
          </a>
        </div>
      </footer>

      <StickyMobileCta>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" size="lg" className="w-full">
            Continue with GitHub
          </Button>
        </form>
      </StickyMobileCta>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="bg-card p-6">
      <span className="font-mono text-sm text-primary">{n}</span>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function Capability({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
      <dt className="font-medium">{term}</dt>
      <dd className="text-sm leading-relaxed text-muted-foreground">{desc}</dd>
    </div>
  );
}
