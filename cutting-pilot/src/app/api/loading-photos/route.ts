// src/app/api/loading-photos/route.ts  ->  /v2/api/loading-photos
// GET  ?job_id= / ?assignment_id=  -> list photo metadata (no image bytes).
// POST                              -> R2 upload + metadata row. Mirrors legacy's
//                                      handleApiLoadingPhotos POST branch exactly: R2 put first,
//                                      D1 row only inserted on R2 success; photo_data stored as
//                                      '' sentinel (column is NOT NULL) since the bytes live in
//                                      R2 under photo_key, not base64 in D1.
// Single-photo GET/DELETE and the image-serve route live in ./[id]/route.ts and
// ./[id]/image/route.ts (Next.js route segments, mirroring legacy's path-suffix dispatch).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");
  const assignmentId = url.searchParams.get("assignment_id");

  try {
    let query =
      "SELECT id, assignment_id, job_id, photo_key, filename, uploaded_by, created_at FROM loading_photos";
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (jobId) {
      conditions.push("job_id = ?");
      binds.push(jobId);
    }
    if (assignmentId) {
      conditions.push("assignment_id = ?");
      binds.push(assignmentId);
    }
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at ASC";

    const rows = await DB.prepare(query)
      .bind(...binds)
      .all();
    return NextResponse.json({ ok: true, photos: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { DB, BOL_PHOTOS } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || null;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.assignment_id) return NextResponse.json({ ok: false, error: "assignment_id is required." }, { status: 400 });
  if (!payload.job_id) return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });
  if (!payload.photo_data) return NextResponse.json({ ok: false, error: "photo_data is required." }, { status: 400 });

  if (String(payload.photo_data).length > 10_000_000) {
    return NextResponse.json({ ok: false, error: "Photo too large. Maximum ~7MB." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const isPng = String(payload.photo_data).startsWith("iVBOR");
  const ext = isPng ? "png" : "jpg";
  const contentType = isPng ? "image/png" : "image/jpeg";
  const r2Key = `loading-photos/${payload.assignment_id}/${id}.${ext}`;

  try {
    const photoBytes = Uint8Array.from(atob(payload.photo_data), (c) => c.charCodeAt(0));
    await BOL_PHOTOS.put(r2Key, photoBytes, { httpMetadata: { contentType } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "photo_upload_failed", detail: String(e?.message || e) },
      { status: 500 }
    );
  }

  try {
    await DB.prepare(
      `INSERT INTO loading_photos (id, assignment_id, job_id, photo_key, photo_data, filename, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?)`
    )
      .bind(id, payload.assignment_id, payload.job_id, r2Key, payload.filename || "", actorId, now)
      .run();

    await logActivity(
      DB, "create", "loading_photo", id,
      `Uploaded loading photo for assignment ${payload.assignment_id}`,
      { assignment_id: payload.assignment_id, job_id: payload.job_id }, actorId
    );

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
