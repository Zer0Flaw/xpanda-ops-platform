// src/app/api/logistics/invoice/route.ts  →  /v2/api/logistics/invoice
// Ingest + resolve + persist + return a parsed freight invoice (PXXX invoice-analytics -c).
// Gated admin-only by middleware's logistics.v2 rule. Addresses come only from `bols` — the
// invoice is never read for addresses, a BOL is never parsed here (that's -d's client-side PDF
// parse, which only extracts {lineNo, shipDate, loadNumber, poText, amount} rows).
import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { extractBolTokens, normalizeAddressKey, composeAddress } from "@/lib/logistics/freightInvoice";
import { FACILITY_ORIGIN_ADDRESS, ORIGIN_CACHE_KEY } from "@/lib/logistics/origin";
import { geocode, drivingMiles, type GeoPoint } from "@/lib/logistics/ors";
import { computeZipVariance, computeInversions, type FlagRow } from "@/lib/logistics/flags";

interface InLine {
  lineNo: number;
  shipDate?: string;
  loadNumber?: string;
  poText: string;
  amount: number;
}

interface InBody {
  vendor: string;
  invoiceNumber: string;
  invoiceDate?: string;
  lines: InLine[];
}

interface BolRow {
  bol_number: string;
  ship_to_street: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
}

interface ResolvedLine {
  lineNo: number;
  shipDate: string | null;
  loadNumber: string | null;
  poText: string;
  amount: number;
  bolNumbers: string[];
  bolNumber: string | null;
  matchStatus: "matched" | "unmatched" | "multi_destination";
  excludedFromStats: boolean;
  shipTo: { city: string; state: string; zip: string } | null;
  miles: number | null;
  pricePerMile: number | null;
  note: string | undefined;
}

// Ensures the fixed facility origin is geocoded + cached, returns its point or null if ORS is
// unavailable/misconfigured (callers then skip mileage resolution for this request entirely).
async function resolveOrigin(DB: D1Database, apiKey: string): Promise<GeoPoint | null> {
  const cached = await DB.prepare(
    "SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(ORIGIN_CACHE_KEY)
    .first<{ lat: number | null; lng: number | null; status: string }>();

  if (cached && cached.status === "ok" && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const point = await geocode(FACILITY_ORIGIN_ADDRESS, apiKey);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      ORIGIN_CACHE_KEY,
      FACILITY_ORIGIN_ADDRESS,
      point?.lat ?? null,
      point?.lng ?? null,
      point?.label ?? null,
      point?.confidence ?? null,
      point ? "ok" : "geocode_failed",
      now,
      now
    )
    .run();

  return point;
}

// Resolves one destination address's one-way driving miles from the facility origin, using
// geocode_cache. Returns null if geocoding/routing is unavailable — caller treats the line as
// unmatched (BOL found, mileage temporarily unavailable) rather than crashing.
async function resolveMiles(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<number | null> {
  const key = normalizeAddressKey(street, city, state, zip);
  const cached = await DB.prepare(
    "SELECT miles_from_origin, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(key)
    .first<{ miles_from_origin: number | null; status: string }>();

  if (cached && cached.status === "ok" && cached.miles_from_origin != null) {
    return cached.miles_from_origin;
  }

  if (!origin) return null;

  const address = composeAddress(street, city, state, zip);
  const dest = await geocode(address, apiKey);
  let miles: number | null = null;
  let status = "geocode_failed";
  if (dest) {
    miles = await drivingMiles(origin, dest, apiKey);
    status = miles != null ? "ok" : "route_failed";
  }

  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       miles_from_origin = excluded.miles_from_origin, ors_label = excluded.ors_label,
       confidence = excluded.confidence, status = excluded.status, updated_at = excluded.updated_at`
  )
    .bind(
      key,
      address,
      dest?.lat ?? null,
      dest?.lng ?? null,
      miles,
      dest?.label ?? null,
      dest?.confidence ?? null,
      status,
      now,
      now
    )
    .run();

  return miles;
}

async function resolveLine(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  line: InLine
): Promise<ResolvedLine> {
  const base = {
    lineNo: line.lineNo,
    shipDate: line.shipDate ?? null,
    loadNumber: line.loadNumber ?? null,
    poText: line.poText ?? "",
    amount: Number(line.amount) || 0,
  };

  const tokens = extractBolTokens(line.poText ?? "");
  if (tokens.length === 0) {
    return {
      ...base,
      bolNumbers: [],
      bolNumber: null,
      matchStatus: "unmatched",
      excludedFromStats: true,
      shipTo: null,
      miles: null,
      pricePerMile: null,
      note: "No BOL number found in PO text.",
    };
  }

  const placeholders = tokens.map(() => "?").join(",");
  const found = await DB.prepare(
    `SELECT bol_number, ship_to_street, ship_to_city, ship_to_state, ship_to_zip
     FROM bols WHERE bol_number IN (${placeholders})`
  )
    .bind(...tokens)
    .all<BolRow>();

  const rows = found.results ?? [];
  if (rows.length === 0) {
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "unmatched",
      excludedFromStats: true,
      shipTo: null,
      miles: null,
      pricePerMile: null,
      note: "No matching BOL on file.",
    };
  }

  const foundNumbers = new Set(rows.map((r) => r.bol_number));
  const missing = tokens.filter((t) => !foundNumbers.has(t));
  const distinctZips = Array.from(new Set(rows.map((r) => r.ship_to_zip)));

  if (distinctZips.length > 1) {
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "multi_destination",
      excludedFromStats: true,
      shipTo: null,
      miles: null,
      pricePerMile: null,
      note: `Multiple destinations on this line (zips: ${distinctZips.join(", ")}).`,
    };
  }

  const dest = rows[0];
  const miles = await resolveMiles(
    DB,
    origin,
    apiKey,
    dest.ship_to_street,
    dest.ship_to_city,
    dest.ship_to_state,
    dest.ship_to_zip
  );

  const shipTo = { city: dest.ship_to_city, state: dest.ship_to_state, zip: dest.ship_to_zip };

  if (miles == null || miles <= 0) {
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "unmatched",
      excludedFromStats: true,
      shipTo,
      miles: null,
      pricePerMile: null,
      note:
        missing.length > 0
          ? `BOL matched (${missing.length} of ${tokens.length} tokens not found); mileage temporarily unavailable.`
          : "BOL matched; mileage temporarily unavailable.",
    };
  }

  return {
    ...base,
    bolNumbers: tokens,
    bolNumber: tokens[0],
    matchStatus: "matched",
    excludedFromStats: false,
    shipTo,
    miles,
    pricePerMile: base.amount / miles,
    note: missing.length > 0 ? `${missing.length} of ${tokens.length} BOL tokens not found on file.` : undefined,
  };
}

async function persistLine(DB: D1Database, invoice: InBody, r: ResolvedLine): Promise<void> {
  await DB.prepare(
    `INSERT INTO freight_invoice_lines (
       id, vendor, invoice_number, invoice_date, line_no, ship_date, load_number, po_text,
       bol_number, bol_numbers, amount, ship_to_zip, ship_to_city, ship_to_state, miles,
       price_per_mile, match_status, excluded_from_stats, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(invoice_number, line_no) DO UPDATE SET
       vendor = excluded.vendor, invoice_date = excluded.invoice_date, ship_date = excluded.ship_date,
       load_number = excluded.load_number, po_text = excluded.po_text, bol_number = excluded.bol_number,
       bol_numbers = excluded.bol_numbers, amount = excluded.amount, ship_to_zip = excluded.ship_to_zip,
       ship_to_city = excluded.ship_to_city, ship_to_state = excluded.ship_to_state, miles = excluded.miles,
       price_per_mile = excluded.price_per_mile, match_status = excluded.match_status,
       excluded_from_stats = excluded.excluded_from_stats`
  )
    .bind(
      crypto.randomUUID(),
      invoice.vendor ?? "",
      invoice.invoiceNumber,
      invoice.invoiceDate ?? null,
      r.lineNo,
      r.shipDate,
      r.loadNumber,
      r.poText,
      r.bolNumber,
      JSON.stringify(r.bolNumbers),
      r.amount,
      r.shipTo?.zip ?? null,
      r.shipTo?.city ?? null,
      r.shipTo?.state ?? null,
      r.miles,
      r.pricePerMile,
      r.matchStatus,
      r.excludedFromStats ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as InBody;
    if (!body?.invoiceNumber || !Array.isArray(body.lines)) {
      return NextResponse.json({ ok: false, error: "Missing invoiceNumber or lines." }, { status: 400 });
    }

    const { DB } = await getEnv();
    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";

    const needsMileage = body.lines.length > 0;
    const origin = needsMileage ? await resolveOrigin(DB, apiKey) : null;

    const resolved: ResolvedLine[] = [];
    for (const line of body.lines) {
      resolved.push(await resolveLine(DB, origin, apiKey, line));
    }
    for (const r of resolved) {
      await persistLine(DB, body, r);
    }

    const matchedCount = resolved.filter((r) => r.matchStatus === "matched").length;
    const unmatchedCount = resolved.filter((r) => r.matchStatus === "unmatched").length;
    const multiDestCount = resolved.filter((r) => r.matchStatus === "multi_destination").length;
    const totalAmount = resolved.reduce((s, r) => s + r.amount, 0);
    const matchedRows = resolved.filter((r) => r.matchStatus === "matched" && r.miles != null);
    const avgMiles = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.miles ?? 0), 0) / matchedRows.length
      : 0;
    const avgPrice = matchedRows.length ? matchedRows.reduce((s, r) => s + r.amount, 0) / matchedRows.length : 0;
    const avgPricePerMile = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.pricePerMile ?? 0), 0) / matchedRows.length
      : 0;

    const flagRows = await DB.prepare(
      `SELECT ship_to_zip, ship_to_city, amount, miles FROM freight_invoice_lines
       WHERE excluded_from_stats = 0 AND ship_to_zip IS NOT NULL AND miles IS NOT NULL`
    ).all<{ ship_to_zip: string; ship_to_city: string; amount: number; miles: number }>();
    const historyRows: FlagRow[] = (flagRows.results ?? []).map((r) => ({
      zip: r.ship_to_zip,
      city: r.ship_to_city,
      amount: r.amount,
      miles: r.miles,
    }));

    return NextResponse.json({
      ok: true,
      invoice: { vendor: body.vendor ?? "", invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate ?? null },
      summary: {
        lineCount: resolved.length,
        matchedCount,
        unmatchedCount,
        multiDestCount,
        totalAmount,
        avgMiles,
        avgPrice,
        avgPricePerMile,
      },
      lines: resolved.map((r) => ({
        lineNo: r.lineNo,
        shipDate: r.shipDate,
        loadNumber: r.loadNumber,
        poText: r.poText,
        bolNumbers: r.bolNumbers,
        matchStatus: r.matchStatus,
        shipTo: r.shipTo,
        miles: r.miles,
        amount: r.amount,
        pricePerMile: r.pricePerMile,
        excludedFromStats: r.excludedFromStats,
        note: r.note ?? null,
      })),
      flags: {
        zipVariance: computeZipVariance(historyRows),
        inversions: computeInversions(historyRows),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { DB } = await getEnv();
    const rows = await DB.prepare(
      `SELECT vendor, invoice_number, invoice_date, COUNT(*) AS line_count, SUM(amount) AS total_amount,
              MIN(created_at) AS created_at
       FROM freight_invoice_lines
       GROUP BY invoice_number
       ORDER BY MIN(created_at) DESC`
    ).all<{
      vendor: string;
      invoice_number: string;
      invoice_date: string | null;
      line_count: number;
      total_amount: number;
      created_at: string;
    }>();

    const invoices = (rows.results ?? []).map((r) => ({
      vendor: r.vendor,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      lineCount: r.line_count,
      totalAmount: r.total_amount,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ ok: true, invoices });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
