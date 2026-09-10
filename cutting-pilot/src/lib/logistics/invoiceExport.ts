// src/lib/logistics/invoiceExport.ts
// Pure SheetJS export helpers for Invoice Analytics (PXXX-k). No React. Field names here must
// stay in sync with InvoiceAnalytics.tsx's InvoiceResult/ResultLine and the /v2/api/logistics/
// annual response shape — re-declared minimally here rather than imported, since no shared type
// module exists yet; do not let these drift from InvoiceAnalytics.tsx.
import * as XLSX from "xlsx";

export type MatchStatus = "matched" | "unmatched" | "multi_destination";

export interface ExportLine {
  lineNo: number;
  shipDate: string | null;
  loadNumber: string | null;
  poText: string;
  bolNumbers: string[];
  matchStatus: MatchStatus;
  shipTo: { city: string; state: string; zip: string } | null;
  miles: number | null;
  amount: number;
  pricePerMile: number | null;
  note: string | null;
}

export interface InvoiceResult {
  invoice: { vendor: string; invoiceNumber: string; invoiceDate: string | null };
  summary: {
    lineCount: number;
    matchedCount: number;
    unmatchedCount: number;
    multiDestCount: number;
    totalAmount: number;
    avgMiles: number;
    avgPrice: number;
    avgPricePerMile: number;
  };
  lines: ExportLine[];
}

export interface AnnualMonthlyEntry {
  month: string;
  lineCount: number;
  totalSpend: number;
  matchedSpend: number;
  totalMiles: number;
  blendedPricePerMile: number;
}

export interface AnnualTopLane {
  zip: string;
  city: string | null;
  lineCount: number;
  totalSpend: number;
  avgMiles: number;
  blendedPricePerMile: number | null;
}

export interface AnnualPerZipEntry {
  zip: string;
  city: string;
  count: number;
  avgMiles: number;
  avgPrice: number;
  avgPricePerMile: number;
}

export interface AnnualZipVarianceEntry {
  zip: string;
  city: string;
  count: number;
  minPrice: number;
  maxPrice: number;
  spread: number;
  avgMiles: number;
}

export interface AnnualData {
  year: string;
  totals: {
    lineCount: number;
    totalSpend: number;
    matchedCount: number;
    unmatchedCount: number;
    multiCount: number;
    matchRate: number;
    totalMiles: number;
    blendedPricePerMile: number;
  };
  monthly: AnnualMonthlyEntry[];
  perZip: AnnualPerZipEntry[];
  zipVariance: AnnualZipVarianceEntry[];
  topLanes: AnnualTopLane[];
  lines: ExportLine[];
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: "Matched",
  unmatched: "Unmatched",
  multi_destination: "Multi-destination",
};

const LINE_HEADER = ["Line", "Ship date", "Load #", "PO text", "BOL(s)", "Match status", "City", "State", "ZIP", "Miles", "Amount", "$/mi", "Note"];

function lineRow(l: ExportLine) {
  return {
    Line: l.lineNo,
    "Ship date": l.shipDate ?? "",
    "Load #": l.loadNumber ?? "",
    "PO text": l.poText ?? "",
    "BOL(s)": l.bolNumbers.join(", "),
    "Match status": STATUS_LABEL[l.matchStatus] ?? l.matchStatus,
    City: l.shipTo?.city ?? "",
    State: l.shipTo?.state ?? "",
    ZIP: l.shipTo?.zip ?? "",
    Miles: l.miles ?? "",
    Amount: l.amount,
    "$/mi": l.pricePerMile ?? "",
    Note: l.note ?? "",
  };
}

function linesSheet(lines: ExportLine[]) {
  return XLSX.utils.json_to_sheet(lines.map(lineRow), { header: LINE_HEADER });
}

export function buildMonthWorkbook(result: InvoiceResult, label: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, linesSheet(result.lines), "Lines");

  const summaryRows = [
    { Label: "Vendor", Value: result.invoice.vendor || "" },
    { Label: "Invoice #", Value: result.invoice.invoiceNumber },
    { Label: "Invoice date", Value: result.invoice.invoiceDate ?? "" },
    { Label: "Line count", Value: result.summary.lineCount },
    { Label: "Matched", Value: result.summary.matchedCount },
    { Label: "Unmatched", Value: result.summary.unmatchedCount },
    { Label: "Multi-destination", Value: result.summary.multiDestCount },
    { Label: "Total amount", Value: result.summary.totalAmount },
    { Label: "Avg miles", Value: result.summary.avgMiles },
    { Label: "Avg price", Value: result.summary.avgPrice },
    { Label: "Avg $/mi", Value: result.summary.avgPricePerMile },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows, { header: ["Label", "Value"] }), "Summary");

  XLSX.writeFile(wb, `freight-${label}.xlsx`);
}

function annualSummarySheet(data: AnnualData) {
  const aoa: (string | number)[][] = [
    ["Year", data.year],
    ["Line count", data.totals.lineCount],
    ["Total spend", data.totals.totalSpend],
    ["Matched", data.totals.matchedCount],
    ["Unmatched", data.totals.unmatchedCount],
    ["Multi-destination", data.totals.multiCount],
    ["Match rate", data.totals.matchRate],
    ["Total miles", data.totals.totalMiles],
    ["Blended $/mi", data.totals.blendedPricePerMile],
    [],
    ["Month", "Lines", "Total spend", "Matched spend", "Total miles", "Blended $/mi"],
    ...data.monthly.map((m) => [m.month, m.lineCount, m.totalSpend, m.matchedSpend, m.totalMiles, m.blendedPricePerMile]),
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function buildAnnualWorkbook(data: AnnualData, year: string): void {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, annualSummarySheet(data), "Summary");

  const perZipHeader = ["ZIP", "City", "Orders", "Avg miles", "Avg amount", "Avg $/mi"];
  const perZipRows = data.perZip.map((z) => ({
    ZIP: z.zip,
    City: z.city,
    Orders: z.count,
    "Avg miles": z.avgMiles,
    "Avg amount": z.avgPrice,
    "Avg $/mi": z.avgPricePerMile,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perZipRows, { header: perZipHeader }), "By ZIP");

  const topLaneHeader = ["ZIP", "City", "Orders", "Total spend", "Avg miles", "Blended $/mi"];
  const topLaneRows = data.topLanes.map((l) => ({
    ZIP: l.zip,
    City: l.city ?? "",
    Orders: l.lineCount,
    "Total spend": l.totalSpend,
    "Avg miles": l.avgMiles,
    "Blended $/mi": l.blendedPricePerMile ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topLaneRows, { header: topLaneHeader }), "Top lanes");

  const varianceHeader = ["ZIP", "City", "Orders", "Min price", "Max price", "Spread", "Avg miles"];
  const varianceRows = data.zipVariance.map((z) => ({
    ZIP: z.zip,
    City: z.city,
    Orders: z.count,
    "Min price": z.minPrice,
    "Max price": z.maxPrice,
    Spread: z.spread,
    "Avg miles": z.avgMiles,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(varianceRows, { header: varianceHeader }), "Variance");

  XLSX.utils.book_append_sheet(wb, linesSheet(data.lines), "All lines");

  XLSX.writeFile(wb, `freight-annual-${year}.xlsx`);
}
