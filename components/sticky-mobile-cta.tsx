"use client";

import { useEffect, useState } from "react";

/**
 * Mobile-only sticky CTA. Appears after the user scrolls past the hero (~240px)
 * so the primary action is always one tap away on a phone, without crowding the
 * initial paint or interfering with laptop layout. Hidden on `sm` and up.
 */
export function StickyMobileCta({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-4 z-40 sm:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <div className="gloss rounded-xl border border-border bg-card/95 p-2 backdrop-blur">
        {children}
      </div>
    </div>
  );
}
