import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Github, Bot, Bug, Lightbulb } from "lucide-react";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Bot className="h-7 w-7" />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">PRPilot</h1>
        <p className="max-w-xl text-balance text-muted-foreground">
          Automated, high-signal AI code review on your GitHub pull requests. Install the app,
          open a PR, and get a structured review posted as a comment — bugs and suggestions, no
          nitpicks.
        </p>
      </div>

      <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
        <Feature icon={<Bot className="h-5 w-5" />} title="Auto-review" desc="Triggers on PR open" />
        <Feature icon={<Bug className="h-5 w-5" />} title="Finds bugs" desc="Severity-ranked" />
        <Feature icon={<Lightbulb className="h-5 w-5" />} title="Suggestions" desc="Actionable, brief" />
      </div>

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
    </main>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-card p-4">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
