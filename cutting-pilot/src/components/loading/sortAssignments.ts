// src/components/loading/sortAssignments.ts
// Port of legacy logistics/loading.html's sortAssignments, 1:1. Every list on the board routes
// through this -- Overview's Awaiting/bay columns/Yard/In Transit/Delivered, and both Team View
// screens (TeamView.tsx's local sortInvAsc duplicate from PXXX-a is retired in favor of this).
export type LdSortOrder = "inv_asc" | "inv_desc" | "date_asc";

export interface SortableAssignment {
  invoice_number: string | null;
  created_at: string;
}

export function sortAssignments<T extends SortableAssignment>(arr: T[], order: LdSortOrder): T[] {
  const out = [...arr];
  if (order === "inv_asc" || order === "inv_desc") {
    out.sort((a, b) => {
      const ai = a.invoice_number || "";
      const bi = b.invoice_number || "";
      if (!ai && !bi) return 0;
      if (!ai) return 1;
      if (!bi) return -1;
      const cmp = ai.localeCompare(bi, undefined, { numeric: true, sensitivity: "base" });
      return order === "inv_asc" ? cmp : -cmp;
    });
  } else {
    out.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  }
  return out;
}
