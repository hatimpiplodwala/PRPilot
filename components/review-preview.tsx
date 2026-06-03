import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";

/**
 * A static, faithful preview of a review comment PRPilot posts on a PR — used as
 * the landing-page hero artifact. Mirrors the real rendered output: a summary,
 * severity-ranked bugs, suggestions, and the assist-not-replace footer.
 */
export function ReviewPreview() {
  return (
    <div className="gloss overflow-hidden rounded-xl border border-border bg-card">
      {/* Comment header, GitHub-comment style */}
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/30 px-4 py-3">
        <LogoMark className="h-6 w-6" />
        <span className="text-sm">
          <span className="font-medium">PRPilot</span>
          <span className="text-muted-foreground"> reviewed </span>
          <span className="font-mono text-foreground">hatim/review-assist#42</span>
        </span>
        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          bot
        </span>
      </div>

      <div className="space-y-5 p-5 text-sm leading-relaxed">
        <p>
          <span className="font-medium">Summary. </span>
          Adds retry-with-backoff to the file uploader and tightens signature handling on the
          webhook route. Changes are focused; two issues worth a look before merge.
        </p>

        <Section title="Potential bugs" count={2}>
          <Finding severity="high" file="lib/upload.ts">
            The retry timer isn&apos;t cleared on a successful upload, so a late retry can
            double-send the same file.
          </Finding>
          <Finding severity="medium" file="app/api/webhooks/github/route.ts">
            Signature is compared with <code className="font-mono text-xs">===</code>; use a
            constant-time comparison to avoid a timing side-channel.
          </Finding>
        </Section>

        <Section title="Suggestions" count={2}>
          <Finding file="lib/upload.ts">
            Extract the backoff calculation into a pure helper so it can be unit-tested in
            isolation.
          </Finding>
          <Finding file="lib/db.ts">
            Reuse a single client instance instead of constructing one per call.
          </Finding>
        </Section>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Automated review by PRPilot. Intended to assist, not replace, human review.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{title}</span>
        <span className="font-mono text-xs text-muted-foreground">({count})</span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Finding({
  severity,
  file,
  children,
}: {
  severity?: "high" | "medium" | "low";
  file: string;
  children: React.ReactNode;
}) {
  const sevVariant =
    severity === "high" ? "destructive" : severity === "medium" ? "warning" : "muted";
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-1 flex items-center gap-2">
        {severity && (
          <Badge variant={sevVariant} className="text-[10px] uppercase">
            {severity}
          </Badge>
        )}
        <code className="font-mono text-xs text-muted-foreground">{file}</code>
      </div>
      <p className="text-sm text-foreground/90">{children}</p>
    </div>
  );
}
