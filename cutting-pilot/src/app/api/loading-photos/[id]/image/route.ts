// src/app/api/loading-photos/[id]/image/route.ts  ->  GET /v2/api/loading-photos/:id/image
// Serves the photo bytes: R2 (photo_key) first, legacy base64-in-D1 fallback for any
// un-backfilled row -- mirrors legacy's handleApiLoadingPhotos image-serve branch exactly.
import { type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { DB, BOL_PHOTOS } = await getEnv();
  const { id } = await params;

  try {
    const row = await DB.prepare("SELECT photo_key, photo_data FROM loading_photos WHERE id = ?")
      .bind(id)
      .first<{ photo_key: string | null; photo_data: string | null }>();
    if (!row) return new Response("Not found", { status: 404 });

    if (row.photo_key) {
      const obj = await BOL_PHOTOS.get(row.photo_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body as any, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (row.photo_data && row.photo_data.length > 10) {
      const mime = row.photo_data.startsWith("iVBOR") ? "image/png" : "image/jpeg";
      const bytes = Uint8Array.from(atob(row.photo_data), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300" },
      });
    }

    return new Response("Not found", { status: 404 });
  } catch {
    return new Response("Server error", { status: 500 });
  }
}
