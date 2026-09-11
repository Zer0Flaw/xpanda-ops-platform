// src/app/api/shipments/distances/route.ts  ->  GET /v2/api/shipments/distances?ids=a,b,c
// The ONLY route that talks to ORS for the shipment-board distance/ETA feature. Bounded and
// client-paced: GET /v2/api/shipments (the list route) is cache-only and never calls ORS, so
// this route exists to warm geocode_cache for a small number of shipments at a time, called by
// ShipmentDashboard.tsx only from its default List + This-Week view (never Calendar or "Show
// All", which can span up to 365 days of rows -- see the list route's header comment for why
// that split exists: an unbounded ORS-per-row loop risks an edge timeout and could burn the
// ORS_API_KEY quota that Invoice Analytics depends on for its own mileage stats).
//
// Kept as GET, not POST: middleware.ts maps POST/PUT/DELETE to the `edit` permission, but this
// is read-triggered enrichment (a view of an order's distance) that should stay on the same
// `logistics.dashboard` view-level grant the list route uses. It does write to geocode_cache,
// which is unusual for a GET, but the writes are pure cache population, invisible to anyone but
// this feature and idempotent from any client's point of view.
//
// resolveOrigin/resolveDestRoute below are a deliberate, self-contained THIRD copy of the
// cache-read/write pattern already duplicated between invoice/route.ts and
// invoice/resolve-line/route.ts (see the comment on the latter) -- kept local rather than
// extracted into a shared module so this route's only failure mode can never risk the live
// invoice-ingest path, which handles real financial data. This copy is a variant, not an exact
// duplicate: it resolves duration alongside miles, backfills duration onto rows the invoice
// feature already geocoded (3-tier below), and skips retrying addresses that failed recently
// (negative-cache backoff) so a bad address isn't re-hit by ORS on every dashboard load.
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { normalizeAddressKey, composeAddress } from "@/lib/logistics/freightInvoice";
import { FACILITY_ORIGIN_ADDRESS, ORIGIN_CACHE_KEY } from "@/lib/logistics/origin";
import { geocode, drivingMilesAndDuration, type GeoPoint } from "@/lib/logistics/ors";

const MAX_IDS_PER_CALL = 8;
const NEGATIVE_CACHE_HOURS = 24;

interface CacheRow {
  lat: number | null;
  lng: number | null;
  miles_from_origin: number | null;
  duration_sec_from_origin: number | null;
  status: string;
  updated_at: string;
}

async function resolveOrigin(DB: D1Database, apiKey: string): Promise<GeoPoint | null> {
  const cached = await DB.prepare("SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?")
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

// Three-tier resolve: (1) full cache hit (miles + duration both present) -> zero ORS calls.
// (2) partial cache hit (lat/lng geocoded already -- e.g. by Invoice Analytics -- but duration
// missing, the expected state for every pre-existing row right after the migration) -> one
// matrix call reusing the cached coordinates, writes miles + duration together so they're never
// a mismatched pair. (3) no cache row -> geocode + matrix, full insert. A `geocode_failed` or
// `route_failed` row is only retried if it's more than NEGATIVE_CACHE_HOURS old, so one bad
// address doesn't get re-hit by ORS on every dashboard load.
async function resolveDestRoute(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<{ miles: number | null; durationSec: number | null }> {
  const key = normalizeAddressKey(street, city, state, zip);
  const cached = await DB.prepare(
    "SELECT lat, lng, miles_from_origin, duration_sec_from_origin, status, updated_at FROM geocode_cache WHERE address_key = ?"
  )
    .bind(key)
    .first<CacheRow>();

  if (cached && cached.status === "ok" && cached.miles_from_origin != null && cached.duration_sec_from_origin != null) {
    return { miles: cached.miles_from_origin, durationSec: cached.duration_sec_from_origin };
  }

  if (cached && cached.status !== "ok") {
    // updated_at is written as a JS toISOString() value (already has a trailing Z) by every
    // geocode_cache writer in this codebase -- parse directly, don't append another Z.
    const ageMs = Date.now() - Date.parse(cached.updated_at);
    if (Number.isFinite(ageMs) && ageMs < NEGATIVE_CACHE_HOURS * 3600 * 1000) {
      return { miles: null, durationSec: null }; // too recent a failure -- don't re-hit ORS
    }
  }

  if (!origin) return { miles: null, durationSec: null };

  let dest: GeoPoint | null = null;
  if (cached && cached.lat != null && cached.lng != null) {
    dest = { lat: cached.lat, lng: cached.lng }; // already geocoded (e.g. by Invoice Analytics) -- skip Pelias
  } else {
    dest = await geocode(composeAddress(street, city, state, zip), apiKey);
  }

  let miles: number | null = null;
  let durationSec: number | null = null;
  let status = "geocode_failed";
  if (dest) {
    const result = await drivingMilesAndDuration(origin, dest, apiKey);
    miles = result?.miles ?? null;
    durationSec = result?.durationSec ?? null;
    status = result ? "ok" : "route_failed";
  }

  const address = composeAddress(street, city, state, zip);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, duration_sec_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       miles_from_origin = excluded.miles_from_origin, duration_sec_from_origin = excluded.duration_sec_from_origin,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      key,
      address,
      dest?.lat ?? null,
      dest?.lng ?? null,
      miles,
      durationSec,
      dest?.label ?? null,
      dest?.confidence ?? null,
      status,
      now,
      now
    )
    .run();

  return { miles, durationSec };
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") || "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS_PER_CALL);

  if (!ids.length) {
    return NextResponse.json({ ok: true, results: {} });
  }

  try {
    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";

    const placeholders = ids.map(() => "?").join(",");
    const shipRows = await DB.prepare(
      `SELECT shipments.id, j.ship_to_street, j.ship_to_city, j.ship_to_state, j.ship_to_zip
         FROM shipments LEFT JOIN jobs j ON j.id = shipments.job_id
        WHERE shipments.id IN (${placeholders})`
    )
      .bind(...ids)
      .all<{
        id: string;
        ship_to_street: string | null;
        ship_to_city: string | null;
        ship_to_state: string | null;
        ship_to_zip: string | null;
      }>();

    const results: Record<string, { miles: number | null; durationSec: number | null; status: string }> = {};

    if (!apiKey) {
      for (const id of ids) results[id] = { miles: null, durationSec: null, status: "unavailable" };
      return NextResponse.json({ ok: true, results });
    }

    const origin = await resolveOrigin(DB, apiKey);

    // Sequential, not Promise.all -- matches the invoice route's deliberate pattern, avoids
    // bursting ORS with concurrent cold-cache calls within one small batch.
    for (const row of shipRows.results ?? []) {
      const zip = (row.ship_to_zip || "").trim();
      if (!zip) {
        results[row.id] = { miles: null, durationSec: null, status: "unavailable" };
        continue;
      }
      const { miles, durationSec } = await resolveDestRoute(
        DB,
        origin,
        apiKey,
        row.ship_to_street || "",
        row.ship_to_city || "",
        row.ship_to_state || "",
        zip
      );
      results[row.id] =
        miles != null && durationSec != null
          ? { miles, durationSec, status: "ok" }
          : { miles: null, durationSec: null, status: "unavailable" };
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
