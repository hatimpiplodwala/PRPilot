import { cn } from "@/lib/utils";

/**
 * PRPilot brand mark: a light-blue rounded tile with a branch/merge glyph and a
 * flat translucent top highlight for gloss (no gradients). Colors come from the
 * theme tokens so it always matches the palette.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("gloss-primary rounded-[11px]", className)}
      role="img"
      aria-label="PRPilot logo"
    >
      <rect width="40" height="40" rx="11" fill="hsl(var(--primary))" />
      <rect width="40" height="19" rx="11" fill="#ffffff" opacity="0.14" />
      <g
        transform="translate(8 8)"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      PR<span className="text-primary">Pilot</span>
    </span>
  );
}
