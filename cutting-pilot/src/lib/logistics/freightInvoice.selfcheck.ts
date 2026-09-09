// src/lib/logistics/freightInvoice.selfcheck.ts
// Guarded self-check for extractBolTokens (PXXX invoice-analytics -c). Mirrors
// poParser.selfcheck.ts's house style. Verifies every messy-variant case called out in the
// prompt text, PLUS extra cases pulled from the real "26.03 Lisma Invoice Details 4611.pdf"
// (93 real line items, provided by Steve) that the prompt's own 7 examples don't cover: a
// comma-separated pair, a slash-separated pair (NOT a date — must not be dropped), two full
// BOL numbers joined by a bare dash (NOT a suffix), and a 4-digit project-name prefix outside
// the parens that must never be mistaken for a token.
import { extractBolTokens } from "./freightInvoice";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function sameTokens(got: string[], expect: string[]): boolean {
  return got.length === expect.length && got.every((t, i) => t === expect[i]);
}

export function runFreightInvoiceSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const cases: Array<{ text: string; expect: string[] }> = [
    // --- verbatim from the PXXX prompt text ---
    { text: "BELLINGHAM (BOL 3668)", expect: ["3668"] },
    { text: "LANSING BUILDING (BOL 3692 AND 3693)", expect: ["3692", "3693"] },
    { text: "DIVERSITECH (BOL 4020 Y 4021)", expect: ["4020", "4021"] },
    { text: "VISTA CENTER EXPANSION (3715-03)", expect: ["3715-03"] },
    { text: "HARBOURS EDGE (BOL 4148-01)", expect: ["4148-01"] },
    { text: "VISTA CENTER EXPANSION 4 (03/06/26)", expect: [] },
    { text: "DIVERSITECH (03/25/26)", expect: [] },

    // --- real Lisma #4611 line items (verbatim from the PDF) ---
    { text: "PRECAST (BOL 3705,3711)", expect: ["3705", "3711"] },
    { text: "BELLINGHAM/TOWN & COUNTRY (BOL 3720-3669)", expect: ["3720", "3669"] },
    { text: "BELLINGHAM (BOL 3749/3732)", expect: ["3749", "3732"] },
    { text: "2000 WYNWOOD (BOL 3471-01)", expect: ["3471-01"] },
    { text: "SHOPPES OFF 80TH (BOL 3719-01)", expect: ["3719-01"] },
    { text: "TAMPA GEN. HOSPITAL (BOL 3755-02 & 3750))", expect: ["3755-02", "3750"] },
    { text: "HEALTHFIRST 1 (BOL 3588-01 & 3764)", expect: ["3588-01", "3764"] },
    { text: "HEALTHFIRST 3 (BOL 3588-03))", expect: ["3588-03"] },
  ];

  for (const c of cases) {
    const got = extractBolTokens(c.text);
    check(
      `extract: "${c.text}"`,
      sameTokens(got, c.expect),
      sameTokens(got, c.expect) ? undefined : `got ${JSON.stringify(got)}, expected ${JSON.stringify(c.expect)}`
    );
  }

  // --- empty / null-ish input never throws ---
  check("empty string yields []", sameTokens(extractBolTokens(""), []));

  return { pass: results.every((r) => r.pass), results };
}
