import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "info" | "warning" | "destructive" | "muted";

const VARIANTS: Record<Variant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  info: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  destructive: "border-red-500/25 bg-red-500/10 text-red-300",
  muted: "border-border bg-muted text-muted-foreground",
};

const base =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <div className={cn(base, VARIANTS[variant], className)} {...props} />;
}
