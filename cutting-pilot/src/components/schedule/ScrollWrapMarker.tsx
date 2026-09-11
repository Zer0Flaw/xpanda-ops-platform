// src/components/schedule/ScrollWrapMarker.tsx
// Divider rendered once per cycle inside an overflowing/scrolling day column (AutoScrollColumn on
// the TV board, InteractiveScrollColumn on the desk board), after the last order. Without it the
// crawl reads as one endless, undifferentiated stream — a viewer glancing at the wall mid-scroll
// can't tell whether they're partway through the day's orders or about to see it restart. Omitted
// entirely for columns that fit without scrolling.
//
// Wording has to hold in both scroll shapes: on the TV (AutoScrollColumn) this sits between the
// real content and the seamless duplicate copy, so the very next row IS the top of the list. On
// the desk board (InteractiveScrollColumn, single copy) it's the last thing in the content — the
// list jumps back to the top only after a dwell, nothing follows it immediately. "Restarts from
// the top" reads correctly in both: true the instant you cross it on the TV, true after the dwell
// on desk.
export default function ScrollWrapMarker() {
  return (
    <div
      aria-hidden="true"
      className="shrink-0 flex items-center justify-center py-0.5 border-y border-dashed border-[var(--line)] bg-[var(--surface-2)] text-[9px] font-semibold uppercase tracking-wide text-text-faint"
    >
      ↻ List restarts from the top
    </div>
  );
}
