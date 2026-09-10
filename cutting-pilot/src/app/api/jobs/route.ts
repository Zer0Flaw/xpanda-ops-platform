// src/app/api/jobs/route.ts  ->  GET /v2/api/jobs?search=
// Ports ONLY the search branch of legacy's jobs GET (_worker.js/routes/jobs.js, ~line 255-267):
// LIKE across customer/po_number/invoice_number, `limit` capped the same way (default 200, max
// 500), `include_archived`. Read-only -- no POST/PUT/DELETE in this file. Backs PullJobModal.tsx
// (PXXX-c): the modal only ever needs id/customer/invoice_number/po_number/status per job, so
// this intentionally selects a small column set rather than porting legacy's full JOB_LIST_COLS
// (line-item batch-fetch included) -- that machinery serves the Job Board, not a lookup-and-pull
// search box.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim();
  const includeArchived = url.searchParams.get("include_archived") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);

  if (!search) {
    return NextResponse.json({ ok: false, error: "search is required." }, { status: 400 });
  }

  try {
    const like = `%${search}%`;
    const archiveClause = includeArchived ? "" : " AND archived_at IS NULL";
    const rows = await DB.prepare(
      `SELECT id, customer, po_number, invoice_number, status, ship_date, load_count
         FROM jobs
        WHERE (customer LIKE ? OR po_number LIKE ? OR invoice_number LIKE ?)${archiveClause}
        ORDER BY ship_date DESC
        LIMIT ${limit}`
    )
      .bind(like, like, like)
      .all();
    return NextResponse.json({ ok: true, jobs: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
