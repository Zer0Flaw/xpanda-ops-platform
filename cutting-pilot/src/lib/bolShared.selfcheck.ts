// src/lib/bolShared.selfcheck.ts
// Structural parity self-check for bolShared.ts (P435, unit 1 of the logistics v2 migration).
// Pure, no PDF render — mirrors src/lib/bagLabels.selfcheck.ts's shape. Not wired into the
// production build path.
//
// Asserts the ported coordinate constants and formatting helpers equal the legacy values by
// comparing against the SAME numbers hard-coded straight from logistics/bol-shared.js. This
// catches transcription drift in the coordinate map; it does NOT render a PDF (that's
// scripts/bol-parity.mjs's job — pixel parity against a real pdf-lib render).
import {
  COORDS,
  PAGE,
  FIELD_MAP,
  COMMODITY_TIERS,
  buildShipToLines,
  wrapText,
  formatBolDate,
  pickCommodityTier,
  type WidthMeasurer,
} from "./bolShared";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// Legacy COORDS, transcribed directly from logistics/bol-shared.js (P435 prompt's own source of
// truth) — NOT derived from bolShared.ts's own COORDS export, so this actually catches drift.
const LEGACY_COORDS = {
  deliveryTime: { x: 390, y: 758, size: 24, lineH: 28, maxW: 200 },
  date: { x: 346, y: 712, size: 10 },
  bolNumber: { x: 408, y: 690, size: 22, bold: true },
  carrierName: { x: 389, y: 648, size: 10 },
  trailerNo: { x: 365, y: 622, size: 12, bold: true },
  shipLine1: { x: 95, y: 615, size: 10 },
  shipLine2: { x: 95, y: 601, size: 10 },
  shipLine3: { x: 95, y: 587, size: 10 },
  shipLine4: { x: 95, y: 573, size: 10 },
  specialInstr: { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },
  contactInfo: { x: 315, y: 525, size: 12, lineH: 13, maxW: 255 },
  poNumber: { x: 315, y: 468, size: 12, lineH: 13, maxW: 255 },
  scrapYes: { x: 109, y: 512, size: 13 },
  scrapNo: { x: 109, y: 496, size: 13 },
  commodity: { x: 55, y: 380, size: 13, lineH: 28, maxW: 510, center: true },
  qrCode: { x: 40, y: 222, size: 60 },
  shipperSignature: { x: 37, y: 48, size: 22 },
  shipperDate: { x: 157, y: 48, size: 8 },
};

const LEGACY_PAGE = { width: 612, height: 792 };

const LEGACY_COMMODITY_TIERS = [
  { size: 26, lineH: 32, maxLines: 2 },
  { size: 22, lineH: 28, maxLines: 4 },
  { size: 18, lineH: 22, maxLines: 7 },
  { size: 15, lineH: 18, maxLines: 11 },
  { size: 12, lineH: 14, maxLines: 18 },
  { size: 10, lineH: 12, maxLines: Infinity },
];

// A measurer whose width ignores fontSize entirely (constant per character) so wrapText's line
// count for a given text is deterministic across every commodity tier's font size — makes
// pickCommodityTier's tier-cascade testable without a real pdf-lib font.
const FIXED_WIDTH_MEASURER: WidthMeasurer = {
  widthOfTextAtSize: (text: string) => text.length,
};

// N words of 300 chars each — each word alone fits under COORDS.commodity.maxW (510), but any two
// combined exceed it, so under FIXED_WIDTH_MEASURER each word forces its own wrapped line.
function nOneLineWords(n: number): string {
  return Array.from({ length: n }, () => "A".repeat(300)).join(" ");
}

export function runBolSharedSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // --- COORDS / PAGE / COMMODITY_TIERS equal legacy values verbatim ---
  check(
    "COORDS matches legacy bol-shared.js verbatim",
    JSON.stringify(COORDS) === JSON.stringify(LEGACY_COORDS),
    JSON.stringify(COORDS) === JSON.stringify(LEGACY_COORDS) ? undefined : `got=${JSON.stringify(COORDS)}`
  );
  check("PAGE matches legacy (612x792 US Letter)", JSON.stringify(PAGE) === JSON.stringify(LEGACY_PAGE), JSON.stringify(PAGE));
  check(
    "COMMODITY_TIERS matches legacy pickCommodityTier's inline tier table",
    JSON.stringify(COMMODITY_TIERS) === JSON.stringify(LEGACY_COMMODITY_TIERS),
    JSON.stringify(COMMODITY_TIERS)
  );

  // --- FIELD_MAP: same 11 entries, same order, coord refs point at the real COORDS objects ---
  const expectedKeys = [
    "deliveryTime",
    "date",
    "bolNumber",
    "carrierName",
    "trailerNo",
    "shipTo",
    "specialInstr",
    "contactInfo",
    "poNumber",
    "commodity",
    "scrap",
  ];
  check(
    "FIELD_MAP has the 11 legacy entries in order",
    JSON.stringify(FIELD_MAP.map((f) => f.key)) === JSON.stringify(expectedKeys),
    JSON.stringify(FIELD_MAP.map((f) => f.key))
  );
  check("FIELD_MAP.deliveryTime.coord === COORDS.deliveryTime (same object)", FIELD_MAP[0].coord === COORDS.deliveryTime);
  check(
    "FIELD_MAP.shipTo.coords === [shipLine1..4] (same objects, in order)",
    Array.isArray(FIELD_MAP[5].coords) &&
      (FIELD_MAP[5].coords as unknown[])[0] === COORDS.shipLine1 &&
      (FIELD_MAP[5].coords as unknown[])[3] === COORDS.shipLine4
  );
  check(
    "FIELD_MAP.scrap.coords === {yes:scrapYes,no:scrapNo} (same objects)",
    !Array.isArray(FIELD_MAP[10].coords) &&
      (FIELD_MAP[10].coords as { yes: unknown; no: unknown }).yes === COORDS.scrapYes &&
      (FIELD_MAP[10].coords as { yes: unknown; no: unknown }).no === COORDS.scrapNo
  );

  // --- buildShipToLines ---
  {
    const full = buildShipToLines({
      ship_to_company: "ABC Co",
      ship_to_attention: "John",
      ship_to_street: "123 Main",
      ship_to_street2: "Suite 5",
      ship_to_city: "Town",
      ship_to_state: "FL",
      ship_to_zip: "33000",
    });
    check(
      "buildShipToLines: all 4 lines in order",
      JSON.stringify(full) === JSON.stringify(["ABC Co", "John", "123 Main, Suite 5", "Town, FL, 33000"]),
      JSON.stringify(full)
    );
  }
  {
    const partial = buildShipToLines({ ship_to_company: "ABC Co", ship_to_city: "Town", ship_to_state: "FL", ship_to_zip: "33000" });
    check(
      "buildShipToLines: skips missing attention/street lines, keeps order",
      JSON.stringify(partial) === JSON.stringify(["ABC Co", "Town, FL, 33000"]),
      JSON.stringify(partial)
    );
  }
  check("buildShipToLines: empty source -> []", buildShipToLines({}).length === 0);

  // --- formatBolDate ---
  check("formatBolDate: ISO date -> MM/DD/YYYY", formatBolDate("2026-06-05") === "06/05/2026");
  check("formatBolDate: non-ISO input passes through unchanged", formatBolDate("TBD") === "TBD");
  check("formatBolDate: falsy input -> ''", formatBolDate("") === "" && formatBolDate(undefined) === "" && formatBolDate(null) === "");

  // --- wrapText algorithm (deterministic fake measurer; real font widths verified by the PDF
  //     parity harness, not here) ---
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("hello world foo", measurer, 1, 10);
    check("wrapText: greedily fills a line then wraps on overflow", JSON.stringify(wrapped) === JSON.stringify(["hello", "world foo"]), JSON.stringify(wrapped));
  }
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("a\n\nb", measurer, 1, 9999);
    check("wrapText: blank paragraph between two lines is preserved as an empty line", JSON.stringify(wrapped) === JSON.stringify(["a", "", "b"]), JSON.stringify(wrapped));
  }
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("Line one\nLine two", measurer, 1, 9999);
    check(
      "wrapText: splits on explicit newlines into separate paragraphs/lines",
      JSON.stringify(wrapped) === JSON.stringify(["Line one", "Line two"]),
      JSON.stringify(wrapped)
    );
  }

  // --- pickCommodityTier tier cascade (fixed-width measurer makes line count independent of the
  //     tier's font size, so each boundary below tests COMMODITY_TIERS' cascade directly) ---
  const tierCases: Array<[number, number]> = [
    [2, 26],
    [3, 22],
    [7, 18],
    [8, 15],
    [18, 12],
    [19, 10],
  ];
  for (const [words, expectedSize] of tierCases) {
    const { size } = pickCommodityTier(nOneLineWords(words), FIXED_WIDTH_MEASURER);
    check(`pickCommodityTier: ${words}-line commodity text -> size ${expectedSize}`, size === expectedSize, `got size=${size}`);
  }

  return { pass: results.every((r) => r.pass), results };
}
