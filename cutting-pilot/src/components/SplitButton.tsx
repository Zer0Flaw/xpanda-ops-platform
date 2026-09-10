"use client";
// src/components/SplitButton.tsx
// Reusable split button (platform-generic, not logistics-specific): a primary action button with
// an attached caret that opens a small menu of secondary actions. Closes on Escape or an
// outside-click.
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface Item {
  label: string;
  onClick: () => void;
}

interface Props {
  label: string;
  onClick: () => void;
  items: Item[];
  disabled?: boolean;
}

export default function SplitButton({ label, onClick, items, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="min-h-[44px] px-4 rounded-l-md bg-[var(--brand)] text-white text-sm font-medium hover:bg-[var(--brand-hover)] disabled:opacity-50 cursor-pointer"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} — more options`}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-r-md border-l border-[var(--brand-hover)] bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)] disabled:opacity-50 cursor-pointer"
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[13rem] rounded-md border border-[var(--card-border)] bg-surface shadow-[var(--shadow-md)] py-1 z-10"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="w-full text-left min-h-[44px] px-4 text-sm text-text hover:bg-[var(--surface-2)] cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
