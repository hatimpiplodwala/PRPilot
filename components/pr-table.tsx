"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import type { PrRow } from "@/lib/dashboard";
import type { RateLimitStatus } from "@/lib/ratelimit";
import type { CommentKind, JobStatus } from "@/lib/types";
import { ChevronRight, Loader2 } from "lucide-react";

type Status = JobStatus | "none";
type Filter = "all" | "needs" | "queued" | "running" | "done" | "failed";

interface RowState extends PrRow {
  pending: boolean;
}

const ACTIVE: Status[] = ["queued", "running"];
const NEEDS: Status[] = ["none", "failed"];

/** Priority of statuses for the per-group "attention" dot — higher = more urgent. */
const STATUS_RANK: Record<Status, number> = {
  failed: 5,
  running: 4,
  queued: 3,
  none: 2,
  done: 1,
};

export function PrTable({
  initialRows,
  rateLimit,
}: {
  initialRows: PrRow[];
  rateLimit: RateLimitStatus;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RowState[]>(
    initialRows.map((r) => ({ ...r, pending: false }))
  );
  const [remaining, setRemaining] = useState(rateLimit.remaining);
  const [filter, setFilter] = useState<Filter>("all");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Lazy-loaded review summaries keyed by jobId. Cleared when a job leaves "done".
  const [summaries, setSummaries] = useState<
    Record<string, string | null | "loading">
  >({});
  const limit = rateLimit.limit;
  const atLimit = remaining <= 0;

  const hasActive = rows.some((r) => ACTIVE.includes(r.status));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: rows.length,
      needs: 0,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
    };
    for (const r of rows) {
      if (NEEDS.includes(r.status)) c.needs += 1;
      if (r.status !== "none") c[r.status] += 1;
    }
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "needs") return rows.filter((r) => NEEDS.includes(r.status));
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  /** Group filtered rows by repo, preserving the existing newest-first order. */
  const groups = useMemo(() => groupByRepo(filteredRows), [filteredRows]);

  const canBulk = !bulkRunning && remaining > 0 && counts.needs > 0;

  // `refresh` reads the latest rows via a ref so its identity stays stable
  // across re-renders. Without this, every successful poll would replace `rows`,
  // recreate `refresh`, re-run the polling effect, and reset the 4 s timer —
  // making effective cadence ~(4 s + roundtrip) instead of the intended 4 s.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Poll job statuses while any review is queued/running.
  const refresh = useCallback(async () => {
    const ids = rowsRef.current.filter((r) => r.jobId).map((r) => r.jobId);
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/jobs?ids=${ids.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: {
        jobs: Record<
          string,
          {
            status: JobStatus;
            comment_id: number | null;
            // Absent when the server fell back to the pre-migration shape.
            comment_kind?: CommentKind | null;
            error: string | null;
            updated_at: string;
          }
        >;
      } = await res.json();
      // Track jobs that just left "done" so we can drop stale cached summaries.
      const stale: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          const j = r.jobId ? data.jobs[r.jobId] : undefined;
          if (!j) return r;
          if (r.status === "done" && j.status !== "done" && r.jobId) {
            stale.push(r.jobId);
          }
          return {
            ...r,
            status: j.status,
            commentId: j.comment_id,
            // Preserve existing kind when the server didn't include one (either
            // because the row legitimately has no kind, or because the server
            // fell back to the pre-migration response shape).
            commentKind: j.comment_kind === undefined ? r.commentKind : j.comment_kind,
            error: j.status === "failed" ? j.error ?? "Review failed" : null,
            reviewedAt: j.status === "done" ? j.updated_at : null,
          };
        })
      );
      if (stale.length > 0) {
        setSummaries((prev) => {
          const next = { ...prev };
          for (const id of stale) delete next[id];
          return next;
        });
      }
    } catch {
      /* transient — try again next tick */
    }
  }, []);

  useEffect(() => {
    if (!hasActive) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null && document.visibilityState === "visible") {
        timer = setInterval(refresh, 4000);
      }
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [hasActive, refresh]);

  async function reviewNow(row: RowState) {
    setRows((prev) =>
      prev.map((r) => (rowId(r) === rowId(row) ? { ...r, pending: true } : r))
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
        if (data?.rateLimit) setRemaining(data.rateLimit.remaining);
        setRows((prev) =>
          prev.map((r) => (rowId(r) === rowId(row) ? { ...r, pending: false } : r))
        );
        toast(data?.error ?? "Failed to queue review", "error");
        return;
      }
      if (data?.rateLimit) setRemaining(data.rateLimit.remaining);
      setRows((prev) =>
        prev.map((r) =>
          rowId(r) === rowId(row)
            ? { ...r, pending: false, status: "queued", jobId: data.jobId, error: null }
            : r
        )
      );
    } catch {
      setRows((prev) =>
        prev.map((r) => (rowId(r) === rowId(row) ? { ...r, pending: false } : r))
      );
      toast("Network error — please try again", "error");
    }
  }

  async function reviewAllNeeds() {
    if (!canBulk) return;
    setBulkRunning(true);
    const candidates = rows.filter((r) => NEEDS.includes(r.status));
    const cap = Math.min(remaining, candidates.length);
    for (let i = 0; i < cap; i++) {
      await reviewNow(candidates[i]);
    }
    setBulkRunning(false);
    if (cap > 0) {
      toast(`Queued ${cap} review${cap === 1 ? "" : "s"}`);
    }
  }

  /**
   * Fetch a review summary lazily on first expand. The in-flight set drops a
   * second call for the same job (e.g. fast double-click on the chevron) so we
   * don't fire duplicate requests against the same row.
   */
  const inFlightSummaries = useRef<Set<string>>(new Set());
  const loadSummary = useCallback(async (jobId: string) => {
    if (inFlightSummaries.current.has(jobId)) return;
    inFlightSummaries.current.add(jobId);
    setSummaries((prev) =>
      prev[jobId] !== undefined ? prev : { ...prev, [jobId]: "loading" }
    );
    try {
      const res = await fetch(`/api/jobs?ids=${jobId}&details=summary`, { cache: "no-store" });
      if (!res.ok) {
        setSummaries((prev) => ({ ...prev, [jobId]: null }));
        return;
      }
      const data: { jobs: Record<string, { summary?: string }> } = await res.json();
      const s = data.jobs?.[jobId]?.summary ?? null;
      setSummaries((prev) => ({ ...prev, [jobId]: s }));
    } catch {
      setSummaries((prev) => ({ ...prev, [jobId]: null }));
    } finally {
      inFlightSummaries.current.delete(jobId);
    }
  }, []);

  function toggleExpand(row: RowState) {
    const id = rowId(row);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (row.status === "done" && row.jobId && summaries[row.jobId] === undefined) {
      loadSummary(row.jobId);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <RateLimitMeter remaining={remaining} limit={limit} />
        {rows.length > 0 && counts.needs > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canBulk}
            title={
              atLimit
                ? "Hourly review limit reached"
                : counts.needs === 0
                ? "No PRs need a review"
                : undefined
            }
            onClick={reviewAllNeeds}
          >
            {bulkRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {bulkRunning
              ? "Queuing…"
              : `Review needing review (${Math.min(remaining, counts.needs)})`}
          </Button>
        )}
      </div>

      {rows.length > 0 && (
        <FilterPills filter={filter} setFilter={setFilter} counts={counts} />
      )}

      {rows.length === 0 ? (
        <p className="gloss rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No open pull requests in your installed repositories.
        </p>
      ) : groups.length === 0 ? (
        <p className="gloss rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No pull requests match this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <RepoGroup
              key={g.repo}
              repo={g.repo}
              prs={g.prs}
              expanded={expanded}
              summaries={summaries}
              onReview={reviewNow}
              onToggle={toggleExpand}
              atLimit={atLimit}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RepoGroup({
  repo,
  prs,
  expanded,
  summaries,
  onReview,
  onToggle,
  atLimit,
}: {
  repo: string;
  prs: RowState[];
  expanded: Set<string>;
  summaries: Record<string, string | null | "loading">;
  onReview: (r: RowState) => void;
  onToggle: (r: RowState) => void;
  atLimit: boolean;
}) {
  const worst = prs.reduce<Status>((acc, r) => (STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc), "done");
  return (
    <details
      open
      className="gloss group overflow-hidden rounded-lg border border-border bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-mono text-[13px] font-medium">{repo}</span>
        <span className="font-mono text-xs text-muted-foreground">
          ({prs.length})
        </span>
        <StatusDot worst={worst} className="ml-auto" />
      </summary>
      <div className="divide-y divide-border">
        {prs.map((row) => (
          <Row
            key={rowId(row)}
            row={row}
            expanded={expanded.has(rowId(row))}
            summary={row.jobId ? summaries[row.jobId] : undefined}
            onReview={onReview}
            onToggle={onToggle}
            atLimit={atLimit}
          />
        ))}
      </div>
    </details>
  );
}

function Row({
  row,
  expanded,
  summary,
  onReview,
  onToggle,
  atLimit,
}: {
  row: RowState;
  expanded: boolean;
  summary: string | null | "loading" | undefined;
  onReview: (r: RowState) => void;
  onToggle: (r: RowState) => void;
  atLimit: boolean;
}) {
  const canExpand = row.status === "done" && !!row.jobId;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {canExpand ? (
        <button
          type="button"
          onClick={() => onToggle(row)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide review summary" : "Show review summary"}
          className="mt-0.5 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        <span className="mt-0.5 inline-block h-4 w-4" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <PrLink row={row} />
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.title}</p>
        {row.error && <p className="mt-1 text-xs text-destructive">{row.error}</p>}
        {expanded && canExpand && (
          <ExpandedSummary row={row} summary={summary} />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
        <StatusCell row={row} />
        <RowActions row={row} onReview={onReview} atLimit={atLimit} />
      </div>
    </div>
  );
}

function ExpandedSummary({
  row,
  summary,
}: {
  row: RowState;
  summary: string | null | "loading" | undefined;
}) {
  return (
    <div className="mt-2 rounded-md border border-border bg-background/40 p-3 text-xs leading-relaxed text-foreground/90 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
      {summary === undefined || summary === "loading" ? (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading summary…
        </span>
      ) : summary ? (
        <>
          <p className="whitespace-pre-line">{summary}</p>
          {row.commentId && (
            <a
              href={reviewHref(row)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block rounded text-[11px] font-mono uppercase tracking-wide text-muted-foreground underline decoration-transparent underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              View full review on GitHub →
            </a>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">No summary stored for this review.</span>
      )}
    </div>
  );
}

function StatusDot({ worst, className = "" }: { worst: Status; className?: string }) {
  const color =
    worst === "failed"
      ? "bg-destructive"
      : worst === "running"
      ? "bg-amber-500"
      : worst === "queued"
      ? "bg-primary"
      : worst === "none"
      ? "bg-muted-foreground/40"
      : "bg-emerald-500/70";
  const label =
    worst === "failed"
      ? "Has failed reviews"
      : worst === "running"
      ? "Has reviews running"
      : worst === "queued"
      ? "Has reviews queued"
      : worst === "none"
      ? "Has PRs with no review"
      : "All reviews complete";
  return (
    <span
      className={`h-2 w-2 rounded-full ${color} ${className}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function FilterPills({
  filter,
  setFilter,
  counts,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const order: Filter[] = ["all", "needs", "queued", "running", "done", "failed"];
  const labels: Record<Filter, string> = {
    all: "All",
    needs: "Needs review",
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
  };
  const visible = order.filter((f) => f === "all" || counts[f] > 0);
  if (visible.length <= 1) return null;
  return (
    <div className="-mx-6 mb-3 overflow-x-auto px-6 sm:mx-0 sm:px-0">
      <div className="flex gap-2 whitespace-nowrap">
        {visible.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                active
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {labels[f]}
              <span className={active ? "text-primary/80" : "text-muted-foreground/70"}>
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PrLink({ row }: { row: RowState }) {
  return (
    <a
      href={row.htmlUrl}
      target="_blank"
      rel="noreferrer"
      className="block truncate rounded font-mono text-[13px] font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      #{row.number}
    </a>
  );
}

function RateLimitMeter({ remaining, limit }: { remaining: number; limit: number }) {
  const used = Math.max(0, limit - remaining);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const low = remaining > 0 && remaining / limit <= 0.2;
  const empty = remaining <= 0;
  const fill = empty
    ? "bg-destructive"
    : low
    ? "bg-amber-500"
    : "bg-primary";
  return (
    <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
      <div
        className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label="Manual reviews used this hour"
      >
        <div
          className={`h-full ${fill} transition-[width] duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono">
        {remaining} of {limit} left this hour
      </span>
    </div>
  );
}

function StatusCell({ row }: { row: RowState }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <StatusBadge status={row.status} />
      {row.status === "done" && row.reviewedAt && (
        <span className="text-xs text-muted-foreground">
          <TimeAgo iso={row.reviewedAt} />
        </span>
      )}
    </span>
  );
}

/**
 * Deep-link to the bot's PR comment using the right anchor. The processor
 * records which API minted the id (review vs issue_comment); we recreate the
 * matching fragment so the browser scrolls straight to it.
 *
 * For old rows where the kind wasn't captured, we fall back to /files — the
 * inline review is rendered on that tab and the summary comment shows in
 * Conversation, which is the next-best landing.
 */
function reviewHref(row: RowState): string {
  if (row.status !== "done" || !row.commentId) return row.htmlUrl;
  if (row.commentKind === "review") {
    return `${row.htmlUrl}#pullrequestreview-${row.commentId}`;
  }
  if (row.commentKind === "issue_comment") {
    return `${row.htmlUrl}#issuecomment-${row.commentId}`;
  }
  return `${row.htmlUrl}/files`;
}

function RowActions({
  row,
  onReview,
  atLimit,
}: {
  row: RowState;
  onReview: (r: RowState) => void;
  atLimit: boolean;
}) {
  const busy = row.pending || ACTIVE.includes(row.status);
  return (
    <>
      {row.status === "done" && row.commentId && (
        <a
          href={reviewHref(row)}
          target="_blank"
          rel="noreferrer"
          className="rounded text-xs text-muted-foreground underline decoration-transparent underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          View review
        </a>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy || atLimit}
        title={atLimit ? "Hourly review limit reached" : undefined}
        onClick={() => onReview(row)}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {row.status === "failed" ? "Try again" : "Review now"}
      </Button>
    </>
  );
}

/** Relative "Xm ago" timestamp. Renders nothing until mounted to avoid a
 *  server/client hydration mismatch, then refreshes once a minute. */
function TimeAgo({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const update = () => setText(formatAgo(iso));
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const rowId = (r: PrRow) => `${r.repoFullName}#${r.number}`;

/**
 * Group rows by repository while preserving the input order both across groups
 * (group order = order of first appearance) and within groups (rows already
 * arrived newest-first from the server). Stable, no extra sort.
 */
function groupByRepo(rows: RowState[]): Array<{ repo: string; prs: RowState[] }> {
  const map = new Map<string, RowState[]>();
  for (const r of rows) {
    const list = map.get(r.repoFullName);
    if (list) list.push(r);
    else map.set(r.repoFullName, [r]);
  }
  return Array.from(map, ([repo, prs]) => ({ repo, prs }));
}

