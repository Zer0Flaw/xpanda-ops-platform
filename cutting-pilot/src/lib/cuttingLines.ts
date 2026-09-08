// src/lib/cuttingLines.ts
// Ported 1:1 from _worker.js/lib/cutting-lines.js's completeCuttingLinesForJob(). Data-integrity
// backstop: once a job is provably, fully past cutting (every non-archived loading_assignment is
// loaded/in_transit/delivered), force its v2 cutting_lines complete and close any dangling open
// cutting_sessions, so a job worked exclusively through the v2 dock dashboard doesn't leave the
// cutting board's history with lines stuck open forever. Writes ONLY cutting_lines +
// cutting_sessions -- never jobs.status (xpanda-ops-agents.md §9a).
import type { D1Database } from "@cloudflare/workers-types";
import { logActivity } from "./activityLog";

export async function completeCuttingLinesForJob(
  db: D1Database,
  jobId: string | null | undefined,
  reason: string
): Promise<void> {
  if (!jobId) return;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const gate = await db
    .prepare(
      `SELECT COUNT(*) AS pending FROM loading_assignments
       WHERE job_id = ? AND loading_status NOT IN ('loaded','in_transit','delivered','archived')`
    )
    .bind(jobId)
    .first<{ pending: number }>();
  if ((gate?.pending ?? 0) > 0) return;

  const res = await db
    .prepare(
      `UPDATE cutting_lines SET line_status = 'complete', updated_at = ?
       WHERE job_id = ? AND line_status != 'complete'`
    )
    .bind(now, jobId)
    .run();

  await db
    .prepare(
      `UPDATE cutting_sessions
       SET status = 'closed', ended_at = ?,
           handoff_note = CASE WHEN handoff_note IS NULL OR handoff_note = ''
                               THEN ? ELSE handoff_note END
       WHERE job_id = ? AND status = 'open'`
    )
    .bind(now, `Auto-closed: job reached ${reason}.`, jobId)
    .run();

  const changed = (res as any)?.meta?.changes ?? 0;
  if (changed > 0) {
    await logActivity(
      db,
      "update",
      "cutting_lines",
      jobId,
      `Auto-completed ${changed} cutting line(s) — job reached ${reason}`,
      { reason, changed },
      null
    );
  }
}
