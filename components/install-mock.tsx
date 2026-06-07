import { Check } from "lucide-react";

/**
 * Visual mock of the GitHub App install screen, themed to PRPilot's palette.
 * Not a real screenshot — it's a labeled rendering of the actual install flow,
 * so a visitor can see exactly what they'll grant access to before clicking
 * through. Mirrors the permissions PRPilot requests in production.
 */
export function InstallMock() {
  return (
    <div className="gloss overflow-hidden rounded-xl border border-border bg-card">
      {/* Browser chrome stripe, GitHub-style */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
        </span>
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          github.com/apps/prpilot/installations/new
        </span>
      </div>

      <div className="space-y-6 p-5 text-sm leading-relaxed sm:p-6">
        <div>
          <h3 className="text-base font-medium">Install PRPilot</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose which repositories PRPilot can review.
          </p>
        </div>

        <Field
          label="Account"
          callout="Personal account or any organization you admin."
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs">
            <span className="h-4 w-4 rounded-full bg-primary/30" aria-hidden />
            your-username
            <span className="ml-auto text-muted-foreground">▾</span>
          </div>
        </Field>

        <Field
          label="Repository access"
          callout="Per-repo: PRPilot only sees what you grant. Revocable anytime."
        >
          <div className="space-y-2">
            <Radio label="All repositories" />
            <Radio label="Only select repositories" checked />
          </div>
          <div className="mt-3 space-y-1.5 rounded-md border border-border bg-background/40 p-3">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Selected (3)
            </div>
            <RepoRow name="your/api-server" />
            <RepoRow name="your/dashboard-ui" />
            <RepoRow name="your/infra-pulumi" />
          </div>
        </Field>

        <Field
          label="Permissions"
          callout="Least-privilege — read code, write PR comments. Nothing else."
        >
          <ul className="divide-y divide-border rounded-md border border-border bg-background/40 text-xs">
            <Permission resource="Pull requests" access="Read &amp; write" />
            <Permission resource="Contents" access="Read" />
            <Permission resource="Metadata" access="Read" />
          </ul>
        </Field>

        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="gloss-primary w-full cursor-default rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Install
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  callout,
  children,
}: {
  label: string;
  callout: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] text-primary">{callout}</span>
      </div>
      {children}
    </div>
  );
}

function Radio({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
          checked ? "border-primary" : "border-border"
        }`}
        aria-hidden
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      <span className={checked ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}

function RepoRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span
        className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-primary bg-primary/20"
        aria-hidden
      >
        <Check className="h-2.5 w-2.5 text-primary" />
      </span>
      {name}
    </div>
  );
}

function Permission({ resource, access }: { resource: string; access: string }) {
  return (
    <li className="flex items-center justify-between px-3 py-2">
      <span>{resource}</span>
      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {access}
      </span>
    </li>
  );
}
