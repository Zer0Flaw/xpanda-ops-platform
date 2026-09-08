// src/app/api/loading-photos/[id]/route.ts  ->  /v2/api/loading-photos/:id
// GET    -> single photo row metadata.
// DELETE -> manager-only, mirrors legacy's handleApiLoadingPhotos DELETE branch.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { DB } = await getEnv();
  const { id } = await params;
  try {
    const row = await DB.prepare(
      "SELECT id, assignment_id, job_id, photo_key, filename, uploaded_by, created_at FROM loading_photos WHERE id = ?"
    )
      .bind(id)
      .first<any>();
    if (!row) return NextResponse.json({ ok: false, error: "Photo not found." }, { status: 404 });
    return NextResponse.json({ ok: true, photo: { ...row, has_image: !!row.photo_key } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { DB } = await getEnv();
  const { id } = await params;
  const canManage = request.headers.get("X-User-Can-Manage-Loading") === "1";
  const actorId = request.headers.get("X-User-Id") || null;

  if (!canManage) {
    return NextResponse.json(
      { ok: false, error: "Manager access required to delete photos." },
      { status: 403 }
    );
  }

  try {
    const exists = await DB.prepare("SELECT id FROM loading_photos WHERE id = ?").bind(id).first<{ id: string }>();
    if (!exists) return NextResponse.json({ ok: false, error: "Photo not found." }, { status: 404 });

    await DB.prepare("DELETE FROM loading_photos WHERE id = ?").bind(id).run();
    await logActivity(DB, "delete", "loading_photo", id, "Deleted loading photo", {}, actorId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
