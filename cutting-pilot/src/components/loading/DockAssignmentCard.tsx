"use client";
// src/components/loading/DockAssignmentCard.tsx
// One interactive load card on the dock dashboard. Built new rather than force-fitting the wall
// board's presentational LoadCard.tsx (board-shaped, no handlers, minimal props) -- this card
// needs the full field set (trailer editing, notes, photo/BOL counts, per-status action buttons)
// and per-card permission-aware handlers the wall component was never meant to carry. Reuses
// components/loading/status.ts's statusVariant AS-IS for color/label, per doctrine.
import { useEffect, useState } from "react";
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
  teamView?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
  onCardDragStart?: (e: React.DragEvent) => void;
  onCardDragEnd?: () => void;
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
  teamView = false,
  isDragging = false,
  draggable: isDraggable = false,
  onCardDragStart,
  onCardDragEnd,
}: DockAssignmentCardProps) {
  const variant = statusVariant(a.loading_status);
  const next = nextLoadingStatus(a.loading_status);
  const showLoadCount = (a.load_count ?? 1) > 1;

  const trailerEditable =
    canManage && !!a.bay_id && ["not_started", "loading", "loaded"].includes(a.loading_status);
  const [trailerDraft, setTrailerDraft] = useState(a.trailer_number ?? "");
  // The card stays mounted across a refetch (same key={a.id}), so without this the input would
  // keep showing a rejected edit after a failed PUT, or a stale value after another operator's
  // change. Safe because there's no polling here -- `a` only changes on our own load() calls,
  // never mid-keystroke.
  useEffect(() => {
    setTrailerDraft(a.trailer_number ?? "");
  }, [a.trailer_number]);

  if (teamView) {
    return (
      <div
        className="rounded-md border px-3 py-3 space-y-3 text-left w-full transition-shadow"
        style={{
          background: `linear-gradient(0deg, ${variant.border}1a, ${variant.border}1a), var(--surface)`,
          borderColor: variant.border,
          borderLeftWidth: 4,
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="font-mono tabular-nums text-sm font-bold truncate" style={{ color: variant.text }}>
              {a.invoice_number ? `INV# ${a.invoice_number}` : "No INV#"}
            </span>
            {showLoadCount && (
              <span className="font-mono tabular-nums text-xs font-bold text-[#6366f1] px-1 bg-[#e0e7ff] rounded">
                {a.load_number ?? 1} of {a.load_count}
              </span>
            )}
          </div>
          <span
            className="shrink-0 text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ backgroundColor: variant.bg, color: variant.text, border: `1px solid ${variant.border}` }}
          >
            {variant.label}
          </span>
        </div>
        <div
          className="text-sm text-text font-medium leading-tight"
          title={a.customer ?? "Unknown customer"}
        >
          {a.customer || "Unknown customer"}
        </div>
        <div className="pt-1">
          {a.loading_status === "not_started" && (
            <button
              type="button"
              onClick={() => onAdvance(a, "loading")}
              className="h-12 w-full rounded-lg border-none bg-[var(--primary-bg)] text-base font-bold text-[var(--primary-text)] cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center"
            >
              Start Loading
            </button>
          )}
          {a.loading_status === "loading" && (
            <button
              type="button"
              onClick={() => onAdvance(a, "loaded")}
              className="h-12 w-full rounded-lg border border-[#f59e0b] bg-[#fef3c7] text-base font-bold text-[#92400e] cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center"
            >
              Mark Loaded
            </button>
          )}
          {a.loading_status === "loaded" && (
            <div className="h-12 w-full rounded-lg border border-[#10b981] bg-[#d1fae5] text-base font-bold text-[#065f46] flex items-center justify-center">
              Ready ✓
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      draggable={isDraggable}
      onDragStart={onCardDragStart}
      onDragEnd={onCardDragEnd}
      className="rounded-md border px-2 py-1.5 space-y-1 text-left w-full transition-shadow"
      style={{
        background: `linear-gradient(0deg, ${variant.border}1a, ${variant.border}1a), var(--surface)`,
        borderColor: variant.border,
        borderLeftWidth: 4,
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'scale(0.95)' : 'none',
        cursor: isDraggable ? 'grab' : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="font-mono tabular-nums font-bold text-xs truncate" style={{ color: variant.text }}>
            {a.invoice_number ? `INV# ${a.invoice_number}` : "No INV#"}
          </span>
          {showLoadCount && (
            <span className="font-mono tabular-nums text-[11px] font-bold text-[#6366f1]">
              {a.load_number ?? 1} of {a.load_count}
            </span>
          )}
          {a.load_ship_date && (
            <span
              className="inline-flex items-center gap-0.5 font-mono tabular-nums text-[10px] font-semibold text-muted"
            >
              <Calendar size={10} aria-hidden="true" />
              {formatShipDay(a.load_ship_date)}
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: variant.border }}
        >
          {variant.label}
        </span>
      </div>

      <div
        className="text-[10px] text-muted truncate leading-tight"
        title={a.customer ?? "Unknown customer"}
      >
        {a.customer || "Unknown customer"}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted">
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
            className="h-5 px-1.5 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-[11px] w-24"
          />
        ) : a.trailer_number ? (
          <span className="inline-flex items-center gap-1 font-mono tabular-nums font-semibold text-text">
            <Truck size={11} aria-hidden="true" />
            {a.trailer_number}
          </span>
        ) : null}
        {a.ship_to_city && (
          <span className="truncate max-w-[120px]">
            {a.ship_to_city}
            {a.ship_to_state ? `, ${a.ship_to_state}` : ""}
          </span>
        )}
        {a.photo_count > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono tabular-nums font-semibold">
            <Camera size={11} aria-hidden="true" />
            {a.photo_count}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 pt-0.5">
        {a.loading_status === "awaiting" && canManage && (
          <button type="button" onClick={() => onAssignBay(a)} className={ACTION_BTN_ASSIGN}>
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
            <FileText size={11} aria-hidden="true" />
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
  "h-6 px-2 rounded border border-[var(--line)] bg-[var(--surface)] text-[11px] font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_PRIMARY =
  "h-6 px-2.5 rounded border-none bg-[var(--primary-bg)] text-[11px] font-semibold text-[var(--primary-text)] cursor-pointer hover:opacity-90 transition-opacity";
const ACTION_BTN_ASSIGN =
  "h-6 px-2.5 rounded border border-[var(--line)] bg-[var(--accent-soft)] text-[11px] font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_WARN =
  "h-6 px-2 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[11px] font-semibold text-[var(--warn-text)] cursor-pointer hover:opacity-90 transition-opacity";
