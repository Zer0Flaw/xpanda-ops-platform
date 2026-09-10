"use client";
// src/components/InfoTip.tsx
// Reusable info-tooltip primitive (platform-generic, not logistics-specific). Desktop: hover or
// focus reveals the tip. Touch: tap toggles it (no hover event on touch devices). Closes on
// Escape or an outside tap.
import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

interface Props {
  label: string;
  className?: string;
}

export default function InfoTip({ label, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label="More info"
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-text rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute z-10 top-full left-0 mt-1 w-64 max-w-[16rem] rounded-lg border border-[var(--card-border)] bg-surface text-text text-xs leading-snug p-3 shadow-[var(--shadow-md)]"
        >
          {label}
        </span>
      )}
    </span>
  );
}
