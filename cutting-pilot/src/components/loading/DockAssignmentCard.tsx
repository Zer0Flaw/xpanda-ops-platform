"use client";
// src/components/loading/DockAssignmentCard.tsx
// One interactive load card on the dock dashboard. Built new rather than force-fitting the wall
// board's presentational LoadCard.tsx (board-shaped, no handlers, minimal props) -- this card
// needs the full field set (trailer editing, notes, photo/BOL counts, per-status action buttons)
// and per-card permission-aware handlers the wall component was never meant to carry. Reuses
// components/loading/status.ts's statusVariant AS-IS for color/label, per doctrine.
import { useState } from "react";
import { Camera, FileText, Truck, Calendar } from "lucide-react";
import { statusVariant } from "./status";
import { advanceLabel, nextLoadingStatus, type DockAssignment } from "./dockTypes";

interface DockAssignmentCardProps {
  a: DockAssignment;
  canManage: boolean;
  onAdvance: (a: DockAssignment, next: string) => void;
  onAssignBay: (a: DockAssignment) => void;
  onMoveToYard: (a: DockAssignment) => void;
  onRevertToBay: (a: DockAssignment) => void;
  onRevertYardToBay: (a: DockAssignment) => void;
  onSendBackToQueue: (a: DockAssignment) => void;
  onArchive: (a: DockAssignment) => void;
  onTrailerChange: (a: DockAssignment, value: string) => void;
  onViewBol: (a: DockAssignment) => void;
  showArchive?: boolean;
}

function formatShipDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

export default function DockAssignmentCard({
  a,
  canManage,
  onAdvance,
  onAssignBay,
  onMoveToYard,
  onRevertToBay,
  onRevertYardToBay,
  onSendBackToQueue,
  onArchive,
  onTrailerChange,
  onViewBol,
  showArchive = false,
}: DockAssignmentCardProps) {
  const variant = statusVariant(a.loading_status);
  const next = nextLoadingStatus(a.loading_status);
  const showLoadCount = (a.load_count ?? 1) > 1;

  const trailerEditable =
    canManage && !!a.bay_id && ["not_started", "loading", "loaded"].includes(a.loading_status);
  const [trailerDraft, setTrailerDraft] = useState(a.trailer_number ?? "");

  return (
    <div
      className="rounded-lg border px-3 py-2 space-y-1.5"
      style={{ background: variant.bg, borderColor: variant.border, borderLeftWidth: 4 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono tabular-nums font-semibold text-sm truncate" style={{ color: variant.text }}>
            {a.invoice_number ? `INV# ${a.invoice_number}` : "No INV#"}
          </span>
          {showLoadCount && (
            <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--info-text)]">
              {a.load_number ?? 1} of {a.load_count}
            </span>
          )}
          {a.load_ship_date && (
            <span
              className="inline-flex items-center gap-1 font-mono tabular-nums text-[11px] font-medium"
              style={{ color: variant.text }}
            >
              <Calendar size={11} aria-hidden="true" />
              {formatShipDay(a.load_ship_date)}
            </span>
          )}
        </div>
        <span
          className="shrink-0 font-mono tabular-nums text-[10px] font-semibold px-1.5 py-[1px] rounded"
          style={{ background: variant.border, color: "var(--primary-text)" }}
        >
          {variant.label}
        </span>
      </div>

      <div className="text-xs truncate" style={{ color: variant.text }} title={a.customer ?? "Unknown customer"}>
        {a.customer || "Unknown customer"}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: variant.text }}>
        {trailerEditable ? (
          <input
            type="text"
            value={trailerDraft}
            onChange={(e) => setTrailerDraft(e.target.value)}
            onBlur={() => {
              const trimmed = trailerDraft.trim();
              if (trimmed !== (a.trailer_number ?? "")) onTrailerChange(a, trimmed);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Trailer #"
            className="min-h-[44px] px-2 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-xs w-28"
          />
        ) : a.trailer_number ? (
          <span className="inline-flex items-center gap-1 font-mono tabular-nums font-semibold">
            <Truck size={12} aria-hidden="true" />
            {a.trailer_number}
          </span>
        ) : null}
        {a.ship_to_city && (
          <span>
            {a.ship_to_city}
            {a.ship_to_state ? `, ${a.ship_to_state}` : ""}
          </span>
        )}
        {a.photo_count > 0 && (
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <Camera size={12} aria-hidden="true" />
            {a.photo_count}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {a.loading_status === "awaiting" && canManage && (
          <button type="button" onClick={() => onAssignBay(a)} className={ACTION_BTN}>
            Assign to bay
          </button>
        )}
        {next && a.loading_status !== "awaiting" && (next !== "in_transit" || canManage) && (
          <button type="button" onClick={() => onAdvance(a, next)} className={ACTION_BTN_PRIMARY}>
            {advanceLabel(next)}
          </button>
        )}
        {a.loading_status !== "awaiting" && (
          <button
            type="button"
            onClick={() => a.bol_count > 0 && onViewBol(a)}
            disabled={a.bol_count === 0}
            title={a.bol_count === 0 ? "No BOL generated for this load yet" : undefined}
            className={`${ACTION_BTN} disabled:opacity-40 disabled:cursor-default inline-flex items-center gap-1`}
          >
            <FileText size={12} aria-hidden="true" />
            View BOL
          </button>
        )}
        {canManage && a.bay_id && ["not_started", "loading", "loaded"].includes(a.loading_status) && (
          <button type="button" onClick={() => onMoveToYard(a)} className={ACTION_BTN_WARN}>
            Move to yard
          </button>
        )}
        {canManage && a.loading_status === "in_transit" && (
          <button type="button" onClick={() => onRevertToBay(a)} className={ACTION_BTN_WARN}>
            Move back to bay
          </button>
        )}
        {canManage && a.location === "yard" && !["in_transit", "delivered", "archived"].includes(a.loading_status) && (
          <button type="button" onClick={() => onRevertYardToBay(a)} className={ACTION_BTN_WARN}>
            Move back to bay
          </button>
        )}
        {canManage && a.loading_status === "delivered" && (
          <button type="button" onClick={() => onSendBackToQueue(a)} className={ACTION_BTN_WARN}>
            Send back to queue
          </button>
        )}
        {showArchive && (
          <button type="button" onClick={() => onArchive(a)} className={ACTION_BTN}>
            Archive
          </button>
        )}
      </div>
    </div>
  );
}

const ACTION_BTN =
  "min-h-[44px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[11px] font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const ACTION_BTN_PRIMARY =
  "min-h-[44px] px-2.5 rounded-md border-none bg-[var(--primary-bg)] text-[11px] font-semibold text-[var(--primary-text)] cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const ACTION_BTN_WARN =
  "min-h-[44px] px-2.5 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[11px] font-semibold text-[var(--warn-text)] cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
