"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import type { PrRow } from "@/lib/dashboard";
import type { JobStatus } from "@/lib/types";
import { Loader2 } from "lucide-react";

type Status = JobStatus | "none";

interface RowState extends PrRow {
  pending: boolean;
}

const ACTIVE: Status[] = ["queued", "running"];

export function PrTable({ initialRows }: { initialRows: PrRow[] }) {
  const [rows, setRows] = useState<RowState[]>(
    initialRows.map((r) => ({ ...r, pending: false }))
  );

  const hasActive = rows.some((r) => ACTIVE.includes(r.status));

  // Poll job statuses while any review is queued/running.
  const refresh = useCallback(async () => {
    const ids = rows.filter((r) => r.jobId).map((r) => r.jobId);
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/jobs?ids=${ids.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: {
        jobs: Record<string, { status: JobStatus; comment_id: number | null; error: string | null }>;
      } = await res.json();
      setRows((prev) =>
        prev.map((r) => {
          const j = r.jobId ? data.jobs[r.jobId] : undefined;
          if (!j) return r;
          return {
            ...r,
            status: j.status,
            commentId: j.comment_id,
            error: j.status === "failed" ? j.error ?? "Review failed" : null,
          };
        })
      );
    } catch {
      /* transient — try again next tick */
    }
  }, [rows]);

  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [hasActive, refresh]);

  async function reviewNow(row: RowState) {
    setRows((prev) =>
      prev.map((r) => (rowId(r) === rowId(row) ? { ...r, pending: true, error: null } : r))
    );
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: row.installationId,
          repoFullName: row.repoFullName,
          prNumber: row.number,
          headSha: row.headSha,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRows((prev) =>
          prev.map((r) =>
            rowId(r) === rowId(row)
              ? { ...r, pending: false, error: data.error ?? "Failed to queue" }
              : r
          )
        );
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          rowId(r) === rowId(row)
            ? { ...r, pending: false, status: "queued", jobId: data.jobId, error: null }
            : r
        )
      );
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          rowId(r) === rowId(row) ? { ...r, pending: false, error: "Network error" } : r
        )
      );
    }
  }

  if (rows.length === 0) {
    return (
      <p className="gloss rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No open pull requests in your installed repositories.
      </p>
    );
  }

  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <div key={rowId(row)} className="gloss rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <PrLink row={row} />
              <StatusBadge status={row.status} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{row.title}</p>
            {row.error && <p className="mt-1 text-xs text-destructive">{row.error}</p>}
            <div className="mt-3 flex items-center justify-end gap-3">
              <RowActions row={row} onReview={reviewNow} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="gloss hidden overflow-hidden rounded-lg border border-border bg-card sm:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Pull request</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowId(row)} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <PrLink row={row} />
                  <div className="truncate text-xs text-muted-foreground">{row.title}</div>
                  {row.error && <div className="text-xs text-destructive">{row.error}</div>}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <RowActions row={row} onReview={reviewNow} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PrLink({ row }: { row: RowState }) {
  return (
    <a
      href={row.htmlUrl}
      target="_blank"
      rel="noreferrer"
      className="font-medium hover:underline"
    >
      {row.repoFullName} #{row.number}
    </a>
  );
}

function RowActions({ row, onReview }: { row: RowState; onReview: (r: RowState) => void }) {
  const busy = row.pending || ACTIVE.includes(row.status);
  return (
    <>
      {row.status === "done" && row.commentId && (
        <a
          href={`${row.htmlUrl}#issuecomment-${row.commentId}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          View comment
        </a>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(row)}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {row.status === "failed" ? "Try again" : "Review now"}
      </Button>
    </>
  );
}

const rowId = (r: PrRow) => `${r.repoFullName}#${r.number}`;
