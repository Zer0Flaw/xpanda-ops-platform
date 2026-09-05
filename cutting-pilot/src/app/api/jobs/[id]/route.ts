// src/app/api/jobs/[id]/route.ts  ->  GET /v2/api/jobs/:id
// Read-only job lookup for the logistics v2 BOL Generate modal's prefill (ship-to address,
// contact, carrier, PO, invoice number, load_count, line items). Mirrors legacy's
// GET /api/jobs/:id (_worker.js/routes/jobs.js) exactly, minus the `processes`/
// `ship_to_standardized` JSON parsing that prefill has no use for. Gated on `jobs` by
// middleware (GET view) -- same permission legacy's /api/jobs/:id requires, not a new key.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();

  try {
    const row = await DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<any>();
    if (!row) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });

    const liResult = await DB.prepare(
      "SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC"
    ).bind(id).all();

    return NextResponse.json({
      ok: true,
      job: { ...row, line_items: liResult.results ?? [] },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
