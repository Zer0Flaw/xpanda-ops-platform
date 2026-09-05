// src/components/logistics/BolActions.tsx
// Build Load + Generate/View BOL — the two per-shipment actions ported from legacy's
// buildActionButtons() (logistics/index.html). Build Load stays a plain link to the LEGACY
// load builder (`logistics/load-builder.html?job_id=`) — porting Load Builder itself is its own
// later unit (see prompt's "Out of scope"). Generate/View toggles on `bol_count`, refreshed by
// the dashboard after every generate (Bug 2 fix) so this never reads stale in-memory state.
import { FileText, Truck } from "lucide-react";
import type { ShipmentListItem } from "./types";

const HIDDEN_STATUSES = ["delivered", "cancelled"];

interface BolActionsProps {
  shipment: ShipmentListItem;
  onViewBol: (jobId: string) => void;
  onGenerateBol: (jobId: string) => void;
}

export default function BolActions({ shipment, onViewBol, onGenerateBol }: BolActionsProps) {
  if (!shipment.job_id || HIDDEN_STATUSES.includes(shipment.status)) return null;

  const hasBol = Number(shipment.bol_count || 0) > 0;
  const jobId = shipment.job_id;

  return (
    <div className="flex items-center justify-end gap-2">
      <a
        href={`/logistics/load-builder.html?job_id=${jobId}`}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text no-underline hover:bg-[var(--ghost-bg)] cursor-pointer"
      >
        <Truck size={14} aria-hidden="true" />
        Build Load
      </a>
      <button
        type="button"
        onClick={() => (hasBol ? onViewBol(jobId) : onGenerateBol(jobId))}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md bg-[var(--brand)] text-white text-xs font-semibold cursor-pointer hover:opacity-90"
      >
        <FileText size={14} aria-hidden="true" />
        {hasBol ? "View BOL" : "Generate BOL"}
      </button>
    </div>
  );
}
