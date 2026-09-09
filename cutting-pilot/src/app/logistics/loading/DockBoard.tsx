"use client";
// src/app/logistics/loading/DockBoard.tsx
// Design read: building this as the interactive dock loading board for loading-team operators
// and managers on a floor tablet, cockpit-dense, bays-as-columns + status queues -- an
// operational port of logistics/loading.html's Overview mode, not a redesign (kanban/master-
// detail would fight the real bay-assignment data model the same way it does in the legacy
// board's own design notes).
//
// Client component: fetches board data (GET /v2/api/loading-bays + /v2/api/loading-assignments)
// and refetches after every mutation (recompute, don't replay -- same rule as unit 2's dashboard
// and the v2 cutting boards).
//
// Deliberate scope cuts from legacy/loading.html (documented in CHANGELOG.md/BACKLOG.md):
//   - "Loading Team View" (single-bay drill-down, mobile-first bay list) -- this single
//     responsive board serves both roles; permission just hides manager-only actions.
//   - Drag-and-drop (mouse + touch) for bay/queue moves -- every drag target already has an
//     equivalent action button (Assign to bay / Move to yard / etc.), so no capability is lost,
//     only a redundant interaction mode. Floor-grade ≥44px buttons are the primary path anyway.
//   - INV#/customer/PO search, sort order picker, per-section collapse+localStorage persistence,
//     notification deep-linking (?assignment=/?shipment=), the Shipping Info modal, and the
//     "+ Pull Job" search-and-onboard flow (needs a job-search endpoint that doesn't exist in v2
//     yet -- POST /v2/api/loading-assignments is still implemented server-side per the prompt's
//     explicit ask, just with no UI trigger in this pass).
//   - The photo gallery lightbox (view already-uploaded photos) -- capture/upload during the
//     Loaded checklist is in scope; browsing prior uploads is not. A photo-count badge shows how
//     many exist.
// The This Week / Show All toggle IS kept (not decorative -- without it Delivered/Awaiting grow
// unbounded at any real data volume).
import { useCallback, useEffect, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import DockAssignmentCard from "@/components/loading/DockAssignmentCard";
import AssignBayModal from "@/components/loading/AssignBayModal";
import LoadedChecklistModal from "@/components/loading/LoadedChecklistModal";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import { inCurrentWeek, type DockAssignment, type DockBay } from "@/components/loading/dockTypes";

interface DockBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

const BAY_ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

export default function DockBoard({ userName, isAdmin, permissions }: DockBoardProps) {
  const canManage = isAdmin || permissions?.["logistics.loading.manage"]?.edit === true;

  const [bays, setBays] = useState<DockBay[]>([]);
  const [assignments, setAssignments] = useState<DockAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [bayModalTarget, setBayModalTarget] = useState<DockAssignment | null>(null);
  const [checklistTarget, setChecklistTarget] = useState<DockAssignment | null>(null);
  const [viewerTarget, setViewerTarget] = useState<{ jobId: string; loadNumber: number | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [baysRes, assignRes] = await Promise.all([
        fetch("/v2/api/loading-bays").then((r) => r.json()),
        fetch("/v2/api/loading-assignments").then((r) => r.json()),
      ]);
      if (!baysRes.ok || !assignRes.ok) {
        setLoadError(baysRes.error || assignRes.error || "Couldn't load the loading board.");
        return;
      }
      setLoadError(null);
      setBays(baysRes.bays ?? []);
      setAssignments(assignRes.assignments ?? []);
    } catch {
      setLoadError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function putAssignment(id: string, body: Record<string, unknown>): Promise<boolean> {
    setActionError(null);
    try {
      const res = await fetch("/v2/api/loading-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setActionError(json.error || "That update failed.");
        return false;
      }
      return true;
    } catch {
      setActionError("Network error — couldn't reach the server.");
      return false;
    }
  }

  async function handleAdvance(a: DockAssignment, next: string) {
    if (next === "loaded") {
      setChecklistTarget(a);
      return;
    }
    if (await putAssignment(a.id, { loading_status: next })) load();
  }

  function handleAssignBay(a: DockAssignment) {
    setBayModalTarget(a);
  }

  async function confirmAssignBay(bayId: string) {
    if (!bayModalTarget) return;
    if (await putAssignment(bayModalTarget.id, { bay_id: bayId, loading_status: "not_started" })) {
      setBayModalTarget(null);
      load();
    }
  }

  async function handleMoveToYard(a: DockAssignment) {
    if (await putAssignment(a.id, { location: "yard", bay_id: null })) load();
  }

  async function handleRevertToBay(a: DockAssignment) {
    if (!window.confirm("Move this trailer back to its bay?")) return;
    if (await putAssignment(a.id, { loading_status: "loaded", location: "bay" })) load();
  }

  async function handleRevertYardToBay(a: DockAssignment) {
    if (!window.confirm("Move this trailer back to the bay queue?")) return;
    if (await putAssignment(a.id, { location: "bay", bay_id: null, loading_status: "awaiting" })) load();
  }

  async function handleSendBackToQueue(a: DockAssignment) {
    if (!window.confirm("Send this delivered load back to the awaiting queue?")) return;
    if (await putAssignment(a.id, { location: "bay", bay_id: null, loading_status: "awaiting" })) load();
  }

  async function handleArchive(a: DockAssignment) {
    if (await putAssignment(a.id, { loading_status: "archived" })) load();
  }

  async function handleTrailerChange(a: DockAssignment, value: string) {
    // Refetch either way: on success to reflect the saved value everywhere it's rendered, on
    // failure to discard the optimistic input and show the real last-saved value.
    await putAssignment(a.id, { trailer_number: value });
    load();
  }

  function handleViewBol(a: DockAssignment) {
    setViewerTarget({ jobId: a.job_id, loadNumber: a.load_number });
  }

  const set = showAll ? assignments : assignments.filter((a) => inCurrentWeek(a.ship_date));

  const awaiting = set.filter((a) => a.loading_status === "awaiting");
  const yard = set.filter(
    (a) => a.location === "yard" && a.loading_status !== "in_transit" && a.loading_status !== "delivered"
  );
  const transit = set.filter((a) => a.loading_status === "in_transit");
  const delivered = set.filter((a) => a.loading_status === "delivered");

  const cardHandlers = {
    canManage,
    onAdvance: handleAdvance,
    onAssignBay: handleAssignBay,
    onMoveToYard: handleMoveToYard,
    onRevertToBay: handleRevertToBay,
    onRevertYardToBay: handleRevertYardToBay,
    onSendBackToQueue: handleSendBackToQueue,
    onArchive: handleArchive,
    onTrailerChange: handleTrailerChange,
    onViewBol: handleViewBol,
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Loading dashboard · v2"
        currentPath="/v2/logistics/loading"
      />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-text">Loading dashboard</h1>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="h-8 px-3 rounded-md border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
          >
            {showAll ? "Show all" : "This week"}
          </button>
        </div>

        {loadError && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {loadError}
            <button type="button" onClick={load} className="ml-3 underline cursor-pointer">
              Retry
            </button>
          </div>
        )}
        {actionError && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {actionError}
          </div>
        )}

        {loading && !loadError && <p className="text-sm text-muted">Loading dock board…</p>}

        {!loading && !loadError && (
          <>
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Awaiting trailer assignment
              </h2>
              {awaiting.length === 0 ? (
                <p className="text-sm text-text-faint italic px-1">Nothing waiting on a bay.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {awaiting.map((a) => (
                    <div key={a.id} className="w-[230px] max-w-full shrink-0">
                      <DockAssignmentCard a={a} {...cardHandlers} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Bays</h2>
              {bays.length === 0 ? (
                <p className="text-sm text-text-faint italic px-1">No bays configured.</p>
              ) : (
                <div className="overflow-x-auto pb-2">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3 min-w-0 md:min-w-[1080px]">
                    {bays.map((bay) => {
                      const bayAssignments = set.filter(
                        (a) => a.bay_id === bay.id && BAY_ACTIVE_STATUSES.includes(a.loading_status)
                      );
                      return (
                        <div key={bay.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] flex flex-col min-w-0">
                          <div className="p-2 border-b border-[var(--line)] text-center font-bold text-sm text-text">
                            Bay {bay.bay_number}
                          </div>
                          <div className="p-2 space-y-1.5 min-h-[150px]">
                            {bayAssignments.length === 0 ? (
                              <p className="text-xs text-text-faint italic text-center py-6">Empty</p>
                            ) : (
                              bayAssignments.map((a) => <DockAssignmentCard key={a.id} a={a} {...cardHandlers} />)
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Yard</h2>
              {yard.length === 0 ? (
                <p className="text-sm text-text-faint italic px-1">No trailers in the yard.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {yard.map((a) => (
                    <div key={a.id} className="w-[230px] max-w-full shrink-0">
                      <DockAssignmentCard a={a} {...cardHandlers} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">In transit</h2>
              {transit.length === 0 ? (
                <p className="text-sm text-text-faint italic px-1">Nothing in transit.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {transit.map((a) => (
                    <div key={a.id} className="w-[230px] max-w-full shrink-0">
                      <DockAssignmentCard a={a} {...cardHandlers} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Delivered</h2>
              {delivered.length === 0 ? (
                <p className="text-sm text-text-faint italic px-1">Nothing delivered yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {delivered.map((a) => (
                    <div key={a.id} className="w-[230px] max-w-full shrink-0">
                      <DockAssignmentCard a={a} {...cardHandlers} showArchive />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {bayModalTarget && (
        <AssignBayModal bays={bays} onClose={() => setBayModalTarget(null)} onConfirm={confirmAssignBay} />
      )}

      <LoadedChecklistModal
        assignment={checklistTarget}
        onClose={() => setChecklistTarget(null)}
        onDone={() => {
          setChecklistTarget(null);
          load();
        }}
      />

      <BolViewerModal
        jobId={viewerTarget?.jobId ?? null}
        loadNumber={viewerTarget?.loadNumber ?? null}
        viewOnly
        onClose={() => setViewerTarget(null)}
        onEdit={() => {
          /* view-only on the dock dashboard -- Edit is unreachable (viewOnly hides the button) */
        }}
      />
    </div>
  );
}
