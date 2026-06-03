import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

type Status = JobStatus | "none";

const CONFIG: Record<Status, { label: string; variant: "success" | "info" | "warning" | "destructive" | "muted" }> = {
  done: { label: "Reviewed", variant: "success" },
  running: { label: "Reviewing", variant: "info" },
  queued: { label: "Queued", variant: "muted" },
  failed: { label: "Failed", variant: "destructive" },
  none: { label: "Not reviewed", variant: "muted" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, variant } = CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
}
