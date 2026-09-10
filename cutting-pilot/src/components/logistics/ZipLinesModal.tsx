"use client";
// src/components/logistics/ZipLinesModal.tsx
// Shared same-ZIP drill-down for Invoice Analytics — reused by the per-invoice flag panel (-e)
// and the History tab's per-ZIP table + flag panels (-f). Shows every stored line for a ZIP so
// Steve can see why prices differ (matched, multi-destination, and unmatched rows alike).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

interface LineRow {
  invoice_number: string;
  invoice_date: string | null;
  line_no: number;
  load_number: string | null;
  bol_number: string | null;
  bol_numbers: string | null;
  po_text: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  miles: number | null;
  amount: number;
  price_per_mile: number | null;
  match_status: string;
}

interface Props {
  zip: string | null;
  onClose: () => void;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function bolLabel(row: LineRow): string {
  if (row.bol_numbers) {
    try {
      const parsed = JSON.parse(row.bol_numbers);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.join(", ");
    } catch {
      // fall through to bol_number
    }
  }
  return row.bol_number || "—";
}

export default function ZipLinesModal({ zip, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);

  useEffect(() => {
    if (zip === null) {
      setLines([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/v2/api/logistics/lines?zip=${encodeURIComponent(zip)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setError(body?.error || "Could not load lines for this ZIP.");
          return;
        }
        setLines(body.lines ?? []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Could not reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zip]);

  return (
    <Modal isOpen={zip !== null} onClose={onClose} title={`Orders in ${zip ?? ""}`} size="xl">
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-[var(--warn-text)]">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-[var(--card-border)]">
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Load #</th>
                <th className="px-3 py-2">BOL(s)</th>
                <th className="px-3 py-2">PO text</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2 text-right">Miles</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">$/mi</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-muted">
                    No stored lines for this ZIP.
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={`${l.invoice_number}-${l.line_no}`} className="border-b border-[var(--border-light)] last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{l.invoice_number}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.invoice_date ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{l.load_number ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{bolLabel(l)}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={l.po_text ?? undefined}>
                      {l.po_text || "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.ship_to_city ? `${l.ship_to_city}, ${l.ship_to_state ?? ""}` : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">{l.miles != null ? miles(l.miles) : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">{money(l.amount)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {l.price_per_mile != null ? `$${l.price_per_mile.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
