# V2-ACTIVITY-LOG-COVERAGE.md

## Agent: next-platform-agent — VERIFICATION / READ-ONLY
Produced by `Prompts/prompt-QC-Cleanup-9-VERIFY-v2-activity-log-enumeration.md`. Closes the open
question behind AUDIT-504 (corrected) / AUDIT-203. **No source changes were made to produce this
report.** This is the input for a future fix prompt ("A2"), to be scoped by the Orchestrator.

## Method
Enumerated every `route.ts` under `cutting-pilot/src/app/api/**` (41 files total). For each file,
identified its exported HTTP method handlers, then classified mutating handlers (POST/PUT/PATCH/
DELETE — 20 GET-only files excluded) by grepping the handler body for `INSERT INTO activity_log`.
Each mutating file was read in full to confirm the insert is actually inside the mutating handler
(not just present elsewhere in the file) and to capture the timestamp format used.

20 route files contain at least one mutating handler, totaling 33 mutating method-instances (some
files export more than one mutating method, e.g. PATCH+DELETE). 11 route files are GET-only and are
out of scope: `schedule-board`, `carrier`, `board` (collection GET), `notes/unviewed-count`,
`cutting/cc-assignments`, `production/today`, `cutting/cut-plan/setups`, `cutting/hc-slots`,
`cutting/my-session`, `cutting/photo/[sessionId]`, `cutting/queue`.

## Timestamp format finding
Every `activity_log` insert found in v2 uses the same `now()` helper —
`new Date().toISOString().replace("T", " ").slice(0, 19)` — producing **space format**
(`2026-08-29 14:23:01`), consistent across all 16 logging call sites with no exceptions. This
matches QC Cleanup-5's finding ("the 12+ inline inserts already emit space format") and QC
Cleanup-5's chosen platform standard (space format, for correct `ORDER BY timestamp` sort against
SQLite `datetime()`). **No ISO-Z v2 writes were found** — the format axis is not a concern for the
gap set below; every future insert should just reuse the same `now()` pattern already used
throughout the file.

## Full route × logging table

| Route | Mutating method(s) | Logs to `activity_log`? | Timestamp format | Notes |
|---|---|---|---|---|
| `cutting/orders` | POST | **Y** | space | Job create via order entry |
| `board/[id]` | PUT | **Y** | space | Board inline-edit (status/ship_date/notes/priority) |
| `loading-board` | PUT | N | — | Upserts singleton board note only |
| `cutting/clock-in` | POST | **Y** | space | |
| `cutting/clock-out` | POST | **Y** | space | |
| `cutting/clock-out-photo` | POST | N | — | Attaches R2 photo key to session (`UPDATE ... photo_key`) |
| `cutting/kick` | POST | **Y** | space | Manager override; audit-only per file's own comment |
| `cutting/complete-line` | POST | **Y** | space | Writes 2 activity_log rows (line + possible job-done) |
| `cutting/line-item` | POST | **Y** | space | Checklist item toggle |
| `cutting/line-progress` | POST | N | — | Batch `completed_qty` upsert across items |
| `cutting/chunk-target` | POST | N | — | Sets manual CC/HC chunk target |
| `cutting/taper-yield` | POST | N | — | **Explicitly documented as intentional** ("Activity logging intentionally omitted... mirror the clock routes later if an audit trail is wanted") |
| `cutting/cut-plan/save` | POST | N | — | Persists multi-part block-calc plan + optional chunk targets |
| `cutting/chunk-session/start` | POST | **Y** | space | |
| `cutting/chunk-session/stop` | POST | **Y** | space | |
| `cutting/chunk-session/complete` | POST | **Y** | space | |
| `cutting/manage/cc-assignments` | POST (create) | N | — | Manager-only |
| `cutting/manage/cc-assignments/[id]` | PATCH (edit) | N | — | Manager-only |
| `cutting/manage/cc-assignments/[id]` | DELETE | N | — | Manager-only |
| `cutting/manage/cc-assignments/reorder` | POST | N | — | Manager-only; batch `sort_order` rewrite |
| `cutting/manage/hb-chunk-override` | POST | N | — | Manager-only; sets/clears Holey Board chunk override |
| `notes` | POST | N | — | **Confirmed-missing per prompt scope** |
| `notes/mark-viewed` | POST | N | — | **Confirmed-missing per prompt scope** |
| `production/molding/sessions` | POST | **Y** | space | Sheet open |
| `production/molding/sessions/[id]` | PATCH | N | — | Includes sheet **close** (`status: open→closed`) and field edits |
| `production/molding/blocks` | POST (create) | N | — | Row append |
| `production/molding/blocks/[id]` | PATCH | **Y** | space | Row edit |
| `production/molding/blocks/[id]` | DELETE | **Y** | space | Row delete |
| `production/expansion/sessions` | POST | **Y** | space | Sheet open |
| `production/expansion/sessions/[id]` | PATCH | N | — | Includes sheet **close** (`status: open→closed`) and field edits |
| `production/expansion/batches` | POST (create) | N | — | Row append |
| `production/expansion/batches/[id]` | PATCH | **Y** | space | Row edit |
| `production/expansion/batches/[id]` | DELETE | **Y** | space | Row delete |

**Confirmed-covered set from the prompt** (verified accurate): `clock-in`, `clock-out`, `kick`,
`complete-line`, `chunk-session/{start,stop,complete}`, `line-item`, `board/[id]`, `orders`, and
"both `production/*/sessions`" (read narrowly as the sessions-collection **POST** only — molding
and expansion — which is correct; the `sessions/[id]` PATCH sub-routes are a separate, uncovered
surface, see gap set below).

## Gap set — mutating routes with NO `activity_log` insert

17 mutating method-instances across 15 route files:

1. `loading-board` PUT — board note edit
2. `cutting/clock-out-photo` POST — cut-list photo attach
3. `cutting/line-progress` POST — batch qty-done update
4. `cutting/chunk-target` POST — manual CC/HC chunk target
5. `cutting/taper-yield` POST — taper yield-per-chunk (already flagged intentional in-code)
6. `cutting/cut-plan/save` POST — multi-part cut plan save
7. `cutting/manage/cc-assignments` POST — create Cross Cutter assignment (manager)
8. `cutting/manage/cc-assignments/[id]` PATCH — edit assignment (manager)
9. `cutting/manage/cc-assignments/[id]` DELETE — delete assignment (manager)
10. `cutting/manage/cc-assignments/reorder` POST — reorder queue (manager)
11. `cutting/manage/hb-chunk-override` POST — Holey Board override (manager)
12. `notes` POST — create shift note (**confirmed-missing per prompt scope**)
13. `notes/mark-viewed` POST — mark note viewed (**confirmed-missing per prompt scope**)
14. `production/molding/sessions/[id]` PATCH — sheet edit/close
15. `production/molding/blocks` POST — block row create
16. `production/expansion/sessions/[id]` PATCH — sheet edit/close
17. `production/expansion/batches` POST — batch row create

### Observations for scoping the fix
- **Asymmetric coverage within the same resource** is the dominant pattern: for both Molding blocks
  and Expansion batches, the row-level PATCH/DELETE (`[id]/route.ts`) logs but the row-level POST
  create (`route.ts`) does not — the create is the more consequential of the two and is currently
  silent. Same asymmetry for sessions: the sheet-open POST logs, but the sheet PATCH (which includes
  the close transition) does not.
- **The entire manager-gated chunk-board-management surface is unlogged** (`cutting/manage/*`, 5
  method-instances): create/edit/delete/reorder of Cross Cutter assignments and the Holey Board
  chunk override. This is the same class of manager-only mutation as `cutting/kick`, which *is*
  logged — an inconsistency worth calling out explicitly to the fix's author.
- **`cutting/taper-yield`** already carries an in-code comment declaring the omission intentional
  ("low-stakes planning value"). A fix prompt should either honor that call and explicitly exclude
  it, or get an explicit decision to reverse it — not silently add logging against the grain of an
  existing design note.
- `cutting/chunk-target` and `cutting/cut-plan/save` are the same "planning value" class as
  `taper-yield` but have no such comment — worth a single consistent policy decision across all
  three planning-only routes rather than fixing them piecemeal.

## Proposed shape for the fix (for Orchestrator scoping)

1. **Shared v2 `logActivity` helper.** No shared helper exists today — all 16 current logging call
   sites duplicate the same 9-column `INSERT INTO activity_log (id, timestamp, action, entity_type,
   entity_id, summary, detail, user_id, created_at) VALUES (...)` shape inline, each wrapped in its
   own try/catch (except `clock-in`/`clock-out`/`kick`/`complete-line`/`line-item`/chunk-session
   routes, which let a logging failure propagate to the outer 500 handler, vs. `orders`/`board/[id]`/
   the production `[id]` routes, which swallow it with `console.error`). A fix should add a single
   `logActivity(db, { action, entityType, entityId, summary, detail, userId })` helper (mirroring
   the legacy `_worker.js/lib/core.js` signature per `xpanda-ops-agents.md` §9) in a v2 lib module
   (e.g. `cutting-pilot/src/lib/activityLog.ts`), standardize on the space-format `now()` already in
   universal use, and standardize the swallow-vs-propagate behavior (recommend: always swallow with
   `console.error`, matching the majority pattern and the fact that logging failure should never
   block the primary mutation).
2. **Wire the 17 gap instances above.** Straightforward for the 15 non-manager routes — same
   pattern as their nearest logged sibling (e.g. `production/molding/blocks` POST should log the
   way `production/molding/blocks/[id]` PATCH/DELETE already do; `production/*/sessions/[id]` PATCH
   should log status transitions, at minimum the close). For the `cutting/manage/*` 5 instances,
   mirror `cutting/kick`'s pattern (manager identity in the summary, entity_type `cc_assignment` or
   `cut_plan_line`).
3. **Get an explicit decision on the three planning-only routes** (`taper-yield`, `chunk-target`,
   `cut-plan/save`) before wiring them — either confirm they should now be logged (reversing
   `taper-yield`'s existing comment) or exclude all three consistently and update/remove the stale
   comment.
4. Fix scope should also update the in-code comment in `cutting/taper-yield/route.ts` if the
   decision is to add logging there, since the comment would otherwise become stale/misleading.

## Terminate
Report written. No source files were edited. Not committed, not pushed, not staged.
