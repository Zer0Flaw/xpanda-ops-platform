// src/lib/activityLog.ts
// Shared activity_log insert -- same D1 table/schema legacy's logActivity() writes to
// (_worker.js/lib/core.js), same shape unit 2's bols/orders routes already insert inline.
// Extracted here because unit 3b's loading routes have several mutation sites that all need it.
import type { D1Database } from "@cloudflare/workers-types";

export async function logActivity(
  db: D1Database,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  detail: Record<string, unknown>,
  userId: string | null
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        now,
        action,
        entityType,
        entityId,
        summary,
        JSON.stringify(detail),
        userId,
        now
      )
      .run();
  } catch (e) {
    console.error("activity_log failed:", String((e as any)?.message || e));
  }
}
