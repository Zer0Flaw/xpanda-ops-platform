"use client";
// src/app/logistics/ShipmentDashboard.tsx
// Design read: building this as a shipment dashboard for logistics/office staff on desktop
// (tablet-capable), cockpit-dense, flat table + per-row actions + three drill-down modals
// (Viewer / Generate / Editor) — a master-detail list, not a marketing-style card grid.
//
// Ports logistics/index.html's outbound shipment list (buildOutboundRow/renderOutbound) as real
// React components rather than a 1:1 transliteration: legacy's date-grouped calendar/inbound-tab
// dashboard is reduced to the flat, live "what ships next" queue this unit's locked scope
// actually asks for (rows + Build Load + Generate/View BOL) — inbound tracking, the bay-
// assignment cell, and the week/calendar filters are legacy-only concerns out of scope here.
//
// Bug 2 fix (Generate<->View toggle): every action that can change a shipment's `bol_count`
// (closing the Generate modal after a successful generate) triggers `load()` here, so the row's
// button always reflects a fresh fetch — never the in-memory list from before the action.
import { useCallback, useEffect, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import ShipmentRow from "@/components/logistics/ShipmentRow";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import BolGenerateModal from "@/components/logistics/BolGenerateModal";
import BolEditorModal, { type EditorTarget } from "@/components/logistics/BolEditorModal";
import type { ShipmentListItem } from "@/components/logistics/types";
import type { BolRecord } from "@/lib/bolShared";

interface ShipmentDashboardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

export default function ShipmentDashboard({ userName, isAdmin, permissions }: ShipmentDashboardProps) {
  const [rows, setRows] = useState<ShipmentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [viewerJobId, setViewerJobId] = useState<string | null>(null);
  const [generateJobId, setGenerateJobId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/shipments?direction=outbound");
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Couldn't load the shipment list.");
        return;
      }
      setError(null);
      setRows(json.data ?? []);
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleEditFromViewer(bols: BolRecord[], jobId: string, index: number) {
    setViewerJobId(null);
    setEditorTarget({ jobId, bols, index });
  }

  function handleEditorCancel() {
    if (editorTarget) setViewerJobId(editorTarget.jobId);
    setEditorTarget(null);
  }

  function handleEditorSaved() {
    if (editorTarget) setViewerJobId(editorTarget.jobId);
    setEditorTarget(null);
    load();
  }

  function handleGenerateDone(generated: boolean) {
    setGenerateJobId(null);
    if (generated) load(); // Bug 2 fix — refresh bol_count so the row flips to "View BOL"
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Logistics · v2"
        currentPath="/v2/logistics"
      />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold text-text">Shipment dashboard</h1>

        {error && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {error}
            <button type="button" onClick={load} className="ml-3 underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {loading && !rows && <p className="text-sm text-muted">Loading shipments…</p>}

        {rows && (
          <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Ship date</th>
                  <th className="px-3 py-2">Method / Carrier</th>
                  <th className="px-3 py-2">Trailer</th>
                  <th className="px-3 py-2">BDFT</th>
                  <th className="px-3 py-2">BOL #</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">
                      No outbound shipments scheduled.
                    </td>
                  </tr>
                ) : (
                  rows.map((s) => (
                    <ShipmentRow key={s.id} shipment={s} onViewBol={setViewerJobId} onGenerateBol={setGenerateJobId} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BolViewerModal
        jobId={viewerJobId}
        onClose={() => setViewerJobId(null)}
        onEdit={handleEditFromViewer}
      />

      <BolGenerateModal
        jobId={generateJobId}
        onClose={handleGenerateDone}
      />

      <BolEditorModal
        target={editorTarget}
        onCancel={handleEditorCancel}
        onSaved={handleEditorSaved}
      />
    </div>
  );
}
