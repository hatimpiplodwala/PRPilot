import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { LogoMark, Wordmark } from "@/components/logo";
import { Github } from "lucide-react";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-8 w-8" />
          <Wordmark className="text-lg" />
        </div>
        <a
          href="https://github.com/hatimpiplodwala/PRPilot"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          GitHub
        </a>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Automated AI code review
          </span>
          <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            High-signal reviews on every pull request
          </h1>
          <p className="max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            Install the app, open a PR, and get a structured review posted as a comment — likely
            bugs and concrete suggestions, ranked by severity, with no nitpicks.
          </p>
          <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/dashboard" });
              }}
            >
              <Button type="submit" size="lg">
                <Github className="h-5 w-5" />
                Continue with GitHub
              </Button>
            </form>
            <a href="#how-it-works">
              <Button variant="outline" size="lg" type="button">
                How it works
              </Button>
            </a>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-border py-16">
          <h2 className="text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
            How it works
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Step
              n="1"
              title="Install the app"
              desc="Grant access to the repositories you want reviewed. Permissions are least-privilege."
            />
            <Step
              n="2"
              title="Open a pull request"
              desc="PRPilot triggers automatically when a PR is opened or reopened — no extra steps."
            />
            <Step
              n="3"
              title="Get a review"
              desc="A structured review is posted as a PR comment in seconds. Re-run it anytime."
            />
          </div>
        </section>

        {/* Features */}
        <section className="grid grid-cols-1 gap-4 border-t border-border py-16 sm:grid-cols-3">
          <Feature
            title="Auto-review"
            desc="Runs the moment a pull request opens, so feedback is waiting when you are."
          />
          <Feature
            title="Finds likely bugs"
            desc="Surfaces probable defects and real risks, each labeled by severity."
          />
          <Feature
            title="Actionable suggestions"
            desc="Concise, concrete improvements — high-signal, never a wall of nitpicks."
          />
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark className="h-5 w-5" />
            <span>Intended to assist, not replace, human review.</span>
          </div>
          <a
            href="https://github.com/hatimpiplodwala/PRPilot"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            View source
          </a>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="gloss rounded-lg border border-border bg-card p-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
        {n}
      </div>
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="gloss rounded-lg border border-border bg-card p-6">
      <div className="h-1 w-8 rounded-full bg-primary" />
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
