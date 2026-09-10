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
import { advanceLabel, nextLoadingStatus, type CardActionHandlers, type DockAssignment } from "./dockTypes";

interface DockAssignmentCardProps extends CardActionHandlers {
  a: DockAssignment;
  showArchive?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
  highlighted?: boolean;
  onCardDragStart?: (e: React.DragEvent) => void;
  onCardDragEnd?: () => void;
  onCardTouchStart?: (e: React.TouchEvent) => void;
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
  onShowShippingInfo,
  showArchive = false,
  isDragging = false,
  draggable: isDraggable = false,
  highlighted = false,
  onCardDragStart,
  onCardDragEnd,
  onCardTouchStart,
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

  return (
    <div
      data-assignment-id={a.id}
      draggable={isDraggable}
      onDragStart={onCardDragStart}
      onDragEnd={onCardDragEnd}
      onTouchStart={onCardTouchStart}
      className="rounded-md border px-2.5 py-2 space-y-1.5 text-left w-full transition-shadow"
      style={{
        background: `linear-gradient(0deg, ${variant.border}1a, ${variant.border}1a), var(--surface)`,
        borderColor: variant.border,
        borderLeftWidth: 4,
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'scale(0.95)' : 'none',
        cursor: isDraggable ? 'grab' : undefined,
        boxShadow: highlighted ? '0 0 0 3px var(--accent)' : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {a.invoice_number ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowShippingInfo(a);
              }}
              className="font-mono tabular-nums font-bold text-xs truncate underline decoration-dotted cursor-pointer"
              style={{ color: variant.text }}
            >
              INV# {a.invoice_number}
            </button>
          ) : (
            <span className="font-mono tabular-nums font-bold text-xs truncate" style={{ color: variant.text }}>
              No INV#
            </span>
          )}
          {showLoadCount && (
            <span className="font-mono tabular-nums text-xs font-bold text-[#6366f1]">
              {a.load_number ?? 1} of {a.load_count}
            </span>
          )}
          {a.load_ship_date && (
            <span
              className="inline-flex items-center gap-0.5 font-mono tabular-nums text-xs font-semibold text-muted"
            >
              <Calendar size={11} aria-hidden="true" />
              {formatShipDay(a.load_ship_date)}
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-xs font-bold uppercase tracking-wider"
          style={{ color: variant.border }}
        >
          {variant.label}
        </span>
      </div>

      <div
        className="text-sm text-muted truncate leading-tight"
        title={a.customer ?? "Unknown customer"}
      >
        {a.customer || "Unknown customer"}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
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
            className="min-h-[44px] px-2 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-sm w-28"
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
  "min-h-[44px] px-3 rounded border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_PRIMARY =
  "min-h-[44px] px-3 rounded border-none bg-[var(--primary-bg)] text-xs font-semibold text-[var(--primary-text)] cursor-pointer hover:opacity-90 transition-opacity";
const ACTION_BTN_ASSIGN =
  "min-h-[44px] px-3 rounded border border-[var(--line)] bg-[var(--accent-soft)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_WARN =
  "min-h-[44px] px-3 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-xs font-semibold text-[var(--warn-text)] cursor-pointer hover:opacity-90 transition-opacity";
