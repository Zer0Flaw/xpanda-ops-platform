"use client";
// src/components/logistics/InvoiceResultToolbar.tsx
// Print + XLSX export toolbar, reused above both the upload results view and the History
// (monthly) results view (PXXX-k) — avoids duplicating markup and a double-MatchRateBanner
// anchor problem across InvoiceAnalytics.tsx.
import { useState } from "react";
import { Printer, Download } from "lucide-react";
import SplitButton from "@/components/SplitButton";
import { buildMonthWorkbook, buildAnnualWorkbook, type InvoiceResult } from "@/lib/logistics/invoiceExport";

interface Props {
  result: InvoiceResult;
  label: string;
  showAnnual?: boolean;
  year?: string;
}

export default function InvoiceResultToolbar({ result, label, showAnnual, year }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadAnnual() {
    if (!year) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/logistics/annual?year=${encodeURIComponent(year)}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.error || "Could not build the annual report.");
        return;
      }
      buildAnnualWorkbook(body, year);
    } catch (e: any) {
      setError(e?.message || "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center justify-end gap-2">
      {error && <span className="text-xs text-[var(--warn-text)]">{error}</span>}
      {busy && <span className="text-xs text-muted">Building annual report…</span>}
      <button
        type="button"
        onClick={() => window.print()}
        className="min-h-[44px] px-4 rounded-md border border-[var(--card-border)] bg-surface text-text text-sm font-medium hover:bg-[var(--surface-2)] inline-flex items-center gap-2 cursor-pointer"
      >
        <Printer size={16} aria-hidden="true" />
        Print
      </button>
      {showAnnual ? (
        <SplitButton
          label="Export (.xlsx)"
          onClick={() => buildMonthWorkbook(result, label)}
          items={[{ label: "Annual report (.xlsx)", onClick: downloadAnnual }]}
          disabled={busy}
        />
      ) : (
        <button
          type="button"
          onClick={() => buildMonthWorkbook(result, label)}
          className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-medium hover:bg-[var(--brand-hover)] inline-flex items-center gap-2 cursor-pointer"
        >
          <Download size={16} aria-hidden="true" />
          Export (.xlsx)
        </button>
      )}
    </div>
  );
}
