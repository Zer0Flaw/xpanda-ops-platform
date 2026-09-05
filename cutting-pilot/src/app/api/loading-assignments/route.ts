// src/app/api/loading-assignments/route.ts  ->  GET /v2/api/loading-assignments?job_id=
// Read-only, scoped to a single job -- used by the BOL Viewer to enrich a frozen/stale
// `bols.trailer_no` with the live dock assignment (Bug 1, see the prompt), and by the BOL
// Generate modal to prefill each trailer's number. Deliberately does NOT replicate legacy's
// GET /api/loading-assignments backfill-on-read side effect (_worker.js/routes/loading.js) --
// that INSERT-on-GET behavior already runs against prod from the legacy page; duplicating it
// here would be a new, unrequested write path on what this unit treats as a read route.
// Gated on `logistics.loading` by middleware (GET view) -- same key as legacy's
// /api/loading-assignments.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const jobId = new URL(request.url).searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });

  try {
    const rows = await DB.prepare(
      `SELECT id, job_id, load_number, trailer_number, ship_date AS load_ship_date
         FROM loading_assignments
        WHERE job_id = ?
        ORDER BY load_number ASC`
    ).bind(jobId).all();
    return NextResponse.json({ ok: true, assignments: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
