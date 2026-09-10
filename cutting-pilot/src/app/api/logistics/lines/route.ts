// src/app/api/logistics/lines/route.ts  →  /v2/api/logistics/lines?zip=<zip>
// Same-ZIP drill-down for the -e/-f Invoice Analytics panels: every stored freight_invoice_lines
// row for a ZIP (all invoices, all match statuses), so Steve can see why prices differ.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

interface LineRow {
  invoice_number: string;
  invoice_date: string | null;
  line_no: number;
  load_number: string | null;
  bol_number: string | null;
  bol_numbers: string | null;
  po_text: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  miles: number | null;
  amount: number;
  price_per_mile: number | null;
  match_status: string;
}

export async function GET(request: Request) {
  try {
    const zip = new URL(request.url).searchParams.get("zip");
    if (!zip) {
      return NextResponse.json({ ok: true, lines: [] });
    }

    const { DB } = await getEnv();
    const rows = await DB.prepare(
      `SELECT invoice_number, invoice_date, line_no, load_number, bol_number, bol_numbers,
              po_text, ship_to_city, ship_to_state, ship_to_zip, miles, amount, price_per_mile, match_status
       FROM freight_invoice_lines
       WHERE ship_to_zip = ?
       ORDER BY invoice_date ASC, line_no ASC`
    )
      .bind(zip)
      .all<LineRow>();

    return NextResponse.json({ ok: true, lines: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
