import { LogoMark, Wordmark } from "@/components/logo";

/**
 * Shown while the dashboard's GitHub fan-out (open PRs across every installation)
 * is in flight. Matches the real dashboard chrome and row geometry exactly so
 * there's no layout shift when the data arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <Wordmark />
          </div>
          <Pulse className="h-7 w-16" />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="sticky top-14 z-30 -mx-6 mb-4 flex items-center justify-between border-b border-border bg-background/85 px-6 py-3 backdrop-blur">
          <Pulse className="h-4 w-44" />
          <Pulse className="h-4 w-32" />
        </div>

        <Pulse className="mb-3 h-1.5 w-28 rounded-full" />

        <div className="gloss overflow-hidden rounded-lg border border-border bg-card">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-48" />
                <Pulse className="h-3 w-3/4" />
              </div>
              <Pulse className="h-5 w-16" />
              <Pulse className="h-8 w-24" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}
