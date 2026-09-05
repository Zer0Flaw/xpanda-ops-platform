// src/app/api/shipments/route.ts  ->  GET /v2/api/shipments
// Read-only outbound shipment list backing the /v2/logistics dashboard, plus single-shipment
// lookup by job_id (used by BolViewerModal to compute *fresh* lock state -- see Bug 2 in the
// prompt: never trust a shipment row already sitting in an in-memory list). Mirrors the shape
// of legacy's GET /api/shipments (_worker.js/routes/jobs.js handleApiShipments) -- same columns,
// same bol_count subquery -- but scoped to outbound only (inbound/bead shipments are out of
// scope for this unit) and, unlike legacy, orders soonest-ship-date-first: this is a live ops
// queue of what ships next, not an admin log.
// Gated on `logistics.dashboard` by middleware (GET view) -- same key as legacy's /api/shipments.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction") || "outbound";
  const jobId = url.searchParams.get("job_id");
  const days = parseInt(url.searchParams.get("days") || "60", 10);

  // Qualified with the `shipments.` prefix throughout -- the LEFT JOIN below pulls in `jobs`,
  // which has its own created_at/direction-shaped columns; an unqualified WHERE would be
  // ambiguous (or silently bind to the wrong table).
  const where = ["shipments.direction = ?"];
  const binds: unknown[] = [direction];

  if (jobId) {
    // A specific job's shipment is wanted regardless of date window (e.g. an older shipment
    // whose ship_date/created_at has aged out of the default range) -- mirrors legacy's
    // job_id-bypasses-the-date-filter behavior on GET /api/bols.
    where.push("shipments.job_id = ?");
    binds.push(jobId);
  } else if (days > 0) {
    where.push("shipments.created_at >= datetime('now', ? || ' days')");
    binds.push(`-${days}`);
  }

  try {
    const { results } = await DB.prepare(
      `SELECT shipments.*, j.invoice_number,
              (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count
         FROM shipments
         LEFT JOIN jobs j ON j.id = shipments.job_id
        WHERE ${where.join(" AND ")}
        ORDER BY shipments.ship_date ASC, shipments.created_at ASC`
    ).bind(...binds).all();
    return NextResponse.json({ ok: true, data: results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
