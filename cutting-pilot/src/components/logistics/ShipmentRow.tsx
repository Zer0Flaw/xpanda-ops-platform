// src/components/logistics/ShipmentRow.tsx
// One outbound shipment row for the /v2/logistics dashboard table. Presentational only —
// ShipmentDashboard owns data + refetch, BolActions owns the Build Load / Generate-View BOL
// buttons (kept separate so it can also be reused wherever else BOL actions get surfaced).
import BolActions from "./BolActions";
import type { ShipmentListItem } from "./types";

const badgeBase = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap";

// Tokenized per xpanda-ops-agents.md §9b — status is color + text, never color alone.
const STATUS_VARIANTS: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  in_production: { label: "In production", cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]" },
  ready_to_ship: { label: "Ready to ship", cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]" },
  loading: { label: "Loading", cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]" },
  loaded: { label: "Loaded", cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]" },
  in_transit: { label: "In transit", cls: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  delivered: { label: "Delivered", cls: "bg-[var(--ghost-bg)] text-[var(--text-muted)] border border-[var(--border)]" },
  cancelled: { label: "Cancelled", cls: "bg-[var(--danger-bg)] text-[var(--danger-text)]" },
  scheduled: { label: "Scheduled", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  awaiting: { label: "Awaiting", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
};

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, cls: "border border-[var(--border)] text-[var(--text-hint)]" };
  return <span className={`${badgeBase} ${v.cls}`}>{v.label}</span>;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtNum(n: number | string | null): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!v) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

interface ShipmentRowProps {
  shipment: ShipmentListItem;
  onViewBol: (jobId: string) => void;
  onGenerateBol: (jobId: string) => void;
}

export default function ShipmentRow({ shipment: s, onViewBol, onGenerateBol }: ShipmentRowProps) {
  const methodCarrier = [s.method, s.carrier].filter(Boolean).join(" · ") || "—";

  return (
    <tr className="border-b border-[var(--line)] last:border-0">
      <td className="px-3 py-2 align-top">
        <div className="font-mono tabular-nums text-sm font-semibold text-text">
          {s.invoice_number ? `INV# ${s.invoice_number}` : "—"}
          {(s.load_count ?? 1) > 1 && (
            <span className="ml-2 font-sans text-[11px] font-bold text-[var(--brand)]">
              {s.load_count} loads
            </span>
          )}
        </div>
        <div className="text-xs text-muted truncate max-w-[220px]" title={s.customer || ""}>
          {s.customer || "Unknown"}
        </div>
        {s.job_id && (
          <a
            href={`/jobs/?job_id=${s.job_id}`}
            className="text-xs text-[var(--brand)] no-underline hover:underline"
          >
            View job →
          </a>
        )}
      </td>
      <td className="px-3 py-2 align-top text-sm text-text">{fmtDate(s.ship_date)}</td>
      <td className="px-3 py-2 align-top text-sm text-text">{methodCarrier}</td>
      <td className="px-3 py-2 align-top text-sm font-mono tabular-nums text-text">{s.trailer_number || "—"}</td>
      <td className="px-3 py-2 align-top text-sm font-mono tabular-nums text-text">{fmtNum(s.total_bdft)}</td>
      <td className="px-3 py-2 align-top text-sm font-mono tabular-nums text-text">{s.bol_number || "—"}</td>
      <td className="px-3 py-2 align-top">
        <StatusBadge status={s.status} />
      </td>
      <td className="px-3 py-2 align-top text-right">
        <BolActions shipment={s} onViewBol={onViewBol} onGenerateBol={onGenerateBol} />
      </td>
    </tr>
  );
}
