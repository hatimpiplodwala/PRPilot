import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost";
type Size = "default" | "sm" | "lg";

const VARIANTS: Record<Variant, string> = {
  default:
    "gloss-primary bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px",
  outline: "gloss border border-border bg-card hover:border-primary/40 hover:text-primary",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};

const SIZES: Record<Size, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-10 rounded-md px-8",
};

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button className={cn(base, VARIANTS[variant], SIZES[size], className)} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button };
