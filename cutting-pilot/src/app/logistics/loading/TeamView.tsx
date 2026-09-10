"use client";
// src/app/logistics/loading/TeamView.tsx
// Port of legacy logistics/loading.html's Loading Team View (renderBayList + drillIntoBay/
// backToBayList/renderBayView) -- a distinct two-screen stack, not the reduced single-board
// view unit 3b originally shipped (see DockBoard.tsx's header note). Reads `selectedBayId`
// from DockBoard rather than owning it locally: PXXX-a's own bay <select> in the toolbar and
// PXXX-b's notification deep-link both need to drive the same drill-in state from outside this
// component.
import BayListItem from "@/components/loading/BayListItem";
import DockAssignmentCard from "@/components/loading/DockAssignmentCard";
import type { CardActionHandlers, DockAssignment, DockBay } from "@/components/loading/dockTypes";

const BAY_ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

// TODO(PXXX-b): delete once src/components/loading/sortAssignments.ts lands and every list on
// the board (Overview + Team View) routes through the real shared helper. Duplicated here only
// so PXXX-a's bay groups/Yard list aren't left unsorted in the meantime -- same inv_asc algorithm
// PXXX-b's helper will formalize, ported from loading.html's sortAssignments.
function sortInvAsc(arr: DockAssignment[]): DockAssignment[] {
  const out = [...arr];
  out.sort((a, b) => {
    const ai = a.invoice_number || "";
    const bi = b.invoice_number || "";
    if (!ai && !bi) return 0;
    if (!ai) return 1;
    if (!bi) return -1;
    return ai.localeCompare(bi, undefined, { numeric: true, sensitivity: "base" });
  });
  return out;
}

interface TeamViewProps {
  bays: DockBay[];
  assignments: DockAssignment[];
  selectedBayId: string | null;
  onSelectBay: (bayId: string | null) => void;
  cardHandlers: CardActionHandlers;
}

export default function TeamView({ bays, assignments, selectedBayId, onSelectBay, cardHandlers }: TeamViewProps) {
  const yard = sortInvAsc(
    assignments.filter(
      (a) => a.location === "yard" && a.loading_status !== "in_transit" && a.loading_status !== "delivered"
    )
  );

  if (selectedBayId === null) {
    return (
      <div>
        <div>
          {bays.length === 0 ? (
            <p className="text-sm text-text-faint italic px-1">No bays configured.</p>
          ) : (
            bays.map((bay) => (
              <BayListItem key={bay.id} bay={bay} assignments={assignments} onSelect={onSelectBay} />
            ))
          )}
        </div>
        <section className="space-y-2" style={{ marginTop: 16 }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted px-1">Yard</h2>
          {yard.length === 0 ? (
            <p className="text-sm text-text-faint italic px-1">No trailers in the yard.</p>
          ) : (
            <div className="space-y-2">
              {yard.map((a) => (
                <DockAssignmentCard key={a.id} a={a} {...cardHandlers} draggable={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  const bay = bays.find((b) => b.id === selectedBayId);
  if (!bay) return null;

  const bayAssignments = assignments.filter(
    (a) => a.bay_id === selectedBayId && BAY_ACTIVE_STATUSES.includes(a.loading_status)
  );
  const activeJob = bayAssignments.find((a) => a.loading_status === "loading") ?? bayAssignments[0] ?? null;

  const groups: { status: string; label: string }[] = [
    { status: "not_started", label: "Not Started" },
    { status: "loading", label: "Loading" },
    { status: "loaded", label: "Loaded" },
  ];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => onSelectBay(null)}
        className="cursor-pointer"
        style={{ color: "#3b82f6", fontSize: 14, fontWeight: 600 }}
      >
        ← All bays
      </button>
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="font-bold text-text" style={{ fontSize: 26, margin: 0 }}>
          Bay {bay.bay_number}
        </h2>
        {activeJob?.trailer_number && (
          <span
            className="font-bold text-text rounded"
            style={{ fontSize: 16, padding: "4px 12px", background: "var(--ghost-bg)" }}
          >
            🚛 {activeJob.trailer_number}
          </span>
        )}
      </div>
      {groups.map((g) => {
        const members = sortInvAsc(bayAssignments.filter((a) => a.loading_status === g.status));
        return (
          <section key={g.status} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted px-1">
              {g.label} ({members.length})
            </h3>
            {members.length === 0 ? (
              <p className="text-sm text-text-faint italic px-1">No jobs {g.label.toLowerCase()}.</p>
            ) : (
              <div className="space-y-2">
                {members.map((a) => (
                  <DockAssignmentCard key={a.id} a={a} {...cardHandlers} draggable={false} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
