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
  const week = url.searchParams.get("week"); // YYYY-MM-DD Monday start
  const status = url.searchParams.get("status");
  const daysParam = url.searchParams.get("days");
  const days = daysParam !== null ? parseInt(daysParam, 10) : 60;
  const q = url.searchParams.get("q")?.trim().toLowerCase();

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
  } else if (week) {
    where.push("shipments.ship_date >= ? AND shipments.ship_date <= date(?, '+6 days')");
    binds.push(week, week);
  } else if (days > 0) {
    where.push("(shipments.created_at >= datetime('now', ? || ' days') OR (shipments.ship_date IS NOT NULL AND shipments.ship_date >= date('now', '-7 days')))");
    binds.push(`-${days}`);
  }

  if (status) {
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      where.push("shipments.status = ?");
      binds.push(statuses[0]);
    } else if (statuses.length > 1) {
      where.push(`shipments.status IN (${statuses.map(() => "?").join(",")})`);
      binds.push(...statuses);
    }
  }

  if (q) {
    where.push("(LOWER(shipments.customer) LIKE ? OR LOWER(j.invoice_number) LIKE ? OR LOWER(shipments.trailer_number) LIKE ? OR LOWER(shipments.carrier) LIKE ? OR LOWER(shipments.bol_number) LIKE ?)");
    const qPattern = `%${q}%`;
    binds.push(qPattern, qPattern, qPattern, qPattern, qPattern);
  }

  // Calculate Monday of current week for stats
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const curMon = new Date(now);
  curMon.setUTCDate(now.getUTCDate() + diffToMon);
  const curMonStr = curMon.toISOString().slice(0, 10);

  try {
    const [listResult, statsResult] = await Promise.all([
      DB.prepare(
        `SELECT shipments.*, j.invoice_number,
                (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count
           FROM shipments
           LEFT JOIN jobs j ON j.id = shipments.job_id
          WHERE ${where.join(" AND ")}
          ORDER BY (shipments.ship_date IS NULL OR shipments.ship_date = ''),
                   shipments.ship_date ASC, shipments.created_at ASC`
      ).bind(...binds).all(),
      DB.prepare(
        `SELECT
           COUNT(CASE WHEN direction = 'outbound' AND ship_date >= ? AND ship_date <= date(?, '+6 days') THEN 1 END) AS outbound_this_week,
           COUNT(CASE WHEN direction = 'outbound' AND status IN ('not_started', 'in_production', 'ready_to_ship') THEN 1 END) AS pending_outbound,
           COUNT(CASE WHEN status = 'in_transit' THEN 1 END) AS in_transit,
           COUNT(CASE WHEN status = 'delivered' AND (ship_date >= date('now', '-30 days') OR created_at >= datetime('now', '-30 days')) THEN 1 END) AS delivered_30d
         FROM shipments`
      ).bind(curMonStr, curMonStr).first(),
    ]);

    return NextResponse.json({
      ok: true,
      data: listResult.results ?? [],
      stats: {
        outboundThisWeek: (statsResult as any)?.outbound_this_week ?? 0,
        pendingOutbound: (statsResult as any)?.pending_outbound ?? 0,
        inTransit: (statsResult as any)?.in_transit ?? 0,
        delivered30d: (statsResult as any)?.delivered_30d ?? 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
