// src/app/api/logistics/flags/route.ts  →  /v2/api/logistics/flags
// Cross-history flags over the full stored freight_invoice_lines dataset, for the -e history
// tab. Reuses the same flag math as the POST /v2/api/logistics/invoice response (src/lib/
// logistics/flags.ts) so the two never drift.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { computeZipVariance, computeInversions, computePerZip, type FlagRow } from "@/lib/logistics/flags";

export async function GET() {
  try {
    const { DB } = await getEnv();
    const rows = await DB.prepare(
      `SELECT ship_to_zip, ship_to_city, amount, miles FROM freight_invoice_lines
       WHERE match_status = 'matched' AND ship_to_zip IS NOT NULL AND miles IS NOT NULL`
    ).all<{ ship_to_zip: string; ship_to_city: string; amount: number; miles: number }>();

    const historyRows: FlagRow[] = (rows.results ?? []).map((r) => ({
      zip: r.ship_to_zip,
      city: r.ship_to_city,
      amount: r.amount,
      miles: r.miles,
    }));

    return NextResponse.json({
      ok: true,
      flags: {
        zipVariance: computeZipVariance(historyRows),
        inversions: computeInversions(historyRows),
      },
      perZip: computePerZip(historyRows),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
