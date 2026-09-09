// src/lib/logistics/freightInvoice.ts
// Pure functions for the Invoice Analytics feature. No DOM, no Cloudflare context — usable
// client- (parseInvoicePdf.ts) or server-side (the /v2/api/logistics/invoice route re-runs this
// on poText server-side; it never trusts the client's own token extraction).

// Extract every BOL number token from a freight-invoice PO# cell. Tokens only ever appear
// inside a parenthetical group on the real invoices this was validated against (Lisma #4611,
// 93 real line items) — scanning is scoped to paren contents so a digit run in the surrounding
// project name (e.g. "2000 WYNWOOD (BOL 3471-01)", "SHOPPES OFF 80TH (BOL 3719-01)") is never
// mistaken for a token.
//
// A token is 3-4 digits optionally followed by "-" + 1-2 digits (a suffix), where the digit
// immediately after the suffix cannot itself be a digit — that distinguishes a real suffix
// ("3739-01)") from two full BOL numbers joined by a bare dash ("3720-3669)", two Bellingham/
// Town & Country BOLs, not one BOL "3720" suffixed "-3669"). Within one paren, "AND"/"Y"
// (Spanish)/"&"/","/"/" all just separate multiple tokens — none of those characters are
// digits, so a plain global digit-run scan handles every separator without explicit splitting.
// A paren whose *entire* trimmed content is a bare date (mm/dd/yy or mm/dd/yyyy) is dropped
// entirely, never a token.
const PAREN_RE = /\(([^)]*)\)/g;
const DATE_ONLY_RE = /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/;
const TOKEN_RE = /\d{3,4}(?:-\d{1,2}(?!\d))?/g;

export function extractBolTokens(poText: string): string[] {
  if (!poText) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();

  let pm: RegExpExecArray | null;
  PAREN_RE.lastIndex = 0;
  while ((pm = PAREN_RE.exec(poText)) !== null) {
    const content = pm[1];
    if (DATE_ONLY_RE.test(content)) continue;

    let tm: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((tm = TOKEN_RE.exec(content)) !== null) {
      const tok = tm[0];
      if (!seen.has(tok)) {
        seen.add(tok);
        tokens.push(tok);
      }
    }
  }

  return tokens;
}

// Stable key for geocode_cache. Uppercase, collapse whitespace, strip trailing punctuation.
export function normalizeAddressKey(street: string, city: string, state: string, zip: string): string {
  const raw = `${street} ${city} ${state} ${zip}`;
  return raw
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/, "");
}

// Compose the address string sent to ORS from stored bols fields.
export function composeAddress(street: string, city: string, state: string, zip: string): string {
  return `${street}, ${city}, ${state} ${zip}`.replace(/\s+/g, " ").trim();
}
