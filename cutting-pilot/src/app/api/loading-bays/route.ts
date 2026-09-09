// src/app/api/loading-bays/route.ts  ->  GET /v2/api/loading-bays
// Mirrors legacy handleApiLoadingBays' GET branch (_worker.js/routes/loading.js) exactly:
// active bays, bay_number ascending. Read-only for this unit -- legacy's PUT (bay label/
// trailer_number, a different field than the per-assignment trailer_number) has no call site
// in logistics/loading.html's dock dashboard, so it's out of scope here.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET() {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      "SELECT * FROM loading_bays WHERE is_active = 1 ORDER BY bay_number ASC"
    ).all();
    return NextResponse.json({ ok: true, bays: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
