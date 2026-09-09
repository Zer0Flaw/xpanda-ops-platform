# Platform QC & Health Audit — P409

- **Date:** 2026-08-24
- **Commit audited:** `ff55b1f296f0854939f3bcede8c0723400021880` (HEAD, branch `main`)
- **Auditor:** Orchestrator/auditor role (read-only), per `Prompts/prompt-P409-audit-01-platform-health-qc.md`
- **Scope:** Legacy (`_worker.js`, all HTML modules) + v2 migration surface (`cutting-pilot/`)

## Phase status

| Phase | Status |
|---|---|
| 0 — Inventory & drift baseline | DONE |
| 1 — Error-handling & resilience | DONE |
| 2 — Data-layer integrity | DONE |
| 3 — Dead/orphaned code | DONE |
| 4 — Duplication & SSOT drift | DONE |
| 5 — Auth/permission completeness | DONE |
| 6 — Docs & process drift + backlog risk | DONE |
| 7 — Build/config integrity | DONE |

**All 8 phases complete — this report is final.**

## Executive summary

**31 findings** recorded across 8 phases (30 distinct issues — AUDIT-303 is a duplicate re-confirmation of AUDIT-002, cross-verified independently by two different forks; AUDIT-203 is a report-accuracy correction to AUDIT-504, not a platform defect, and is excluded from severity counts below).

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 12 |
| Low | 15 |
| (correction note, no severity) | 1 |

| Phase / Category | Findings |
|---|---|
| 0 — Inventory & drift baseline | 4 (1H, 1M, 2L) |
| 1 — Error-handling & resilience | 3 (1H, 2L) |
| 2 — Data-layer integrity | 4 (1H, 1M, 1L, 1 correction) |
| 3 — Dead/orphaned code | 5 (3M, 2L) |
| 4 — Duplication & SSOT drift | 1 (1M) |
| 5 — Auth/permission completeness | 5 (2M, 3L) |
| 6 — Docs & process drift + backlog risk | 6 (2M, 4L) |
| 7 — Build/config integrity | 3 (2M, 1L) |

No Critical findings — no active outage, data-loss, or auth-bypass condition was found. The platform is not on fire. What this audit surfaced is a consistent pattern: **the P404 signout incident's root cause (fail-behavior on an untested edge, discovered only by accident) has close cousins elsewhere** — dead code masquerading as live, docs asserting things that stopped being true many prompts ago, and one other data-integrity bug in the exact same "silent, not crashing" shape as the signout bug.

**Top 5 risks, one line each:**
1. **AUDIT-201 (High)** — `activity_log.timestamp` mixes two timestamp formats live in production (5,177 vs. 636 rows today), silently misordering the platform's own incident-investigation tool — the same shape of bug as the P404 signout root cause, just in the audit trail instead of the auth path.
2. **AUDIT-101 (High)** — the outermost catch-all in `_worker.js/index.js` still returns raw stack traces (file paths, line numbers, sometimes query fragments) to any client, including unauthenticated ones, on any unhandled exception.
3. **AUDIT-001 (High)** — `production/inventory.html` (still permission-gated-reachable) 500s on every load because its four backing D1 tables were dropped with no migration record and no code cleanup; a known-stale page, but currently live and broken.
4. **AUDIT-002 / AUDIT-303 (Medium, cross-confirmed twice)** — two orphaned D1 tables (`load_builder_skus`, `parts_library`) hold 175 combined rows of stale data under names that read as exactly what a future agent or manual query would assume backs live features.
5. **AUDIT-305 (Medium, suspected)** — `BACKLOG.md` describes the QuickBooks integration two contradictory ways ("not started" vs. "abandoned, remove it") while the actual code is a substantial, wired, auth-bypassing pipeline (AUDIT-505) that matches neither description — a genuine "which doc do I believe" trap for whoever touches it next.

---

## Phase 0 — Inventory & drift baseline

### Inventory tables

| Map | Count |
|---|---|
| D1 tables (`sqlite_master`, excl. `sqlite_sequence`/`_cf_KV`) | 51 (49 app tables) |
| Legacy `API_ROUTES` rows (`_worker.js/index.js`) | 53 |
| v2 `route.ts`/`page.tsx` files (`cutting-pilot/src/app/**`) | 49 |
| Legacy `PATH_PERMISSION_MAP` + `API_PERMISSION_MAP` unique keys (`_worker.js/lib/core.js`) | 12 unique (`admin`, `jobs`, `logistics.bol`, `logistics.load-builder`, `logistics.loading`, `logistics.dashboard`, `manufacturing.cutting`, `manufacturing.calculators`, `production.inventory`, `qc`, `safety`, `reports`) |
| v2 `PERMISSION_MAP` unique keys (`cutting-pilot/src/middleware.ts`) | 13 (`schedule`, `logistics.loading.tv`, `manufacturing.cutting.manage`, `manufacturing.cutting.override`, `manufacturing.cutting`, `jobs`, `orders`, `notes.manage`, `notes`, `manufacturing.blocks`, `logistics.carrier_view`, `production.log`) |
| `PERMISSION_LABELS` keys (`admin/roles.html`) | 24 |

Two keys (`jobs.manage`, `logistics.loading.manage`) have labels but no entry in either top-level map — confirmed **by design**: both are enforced as in-handler sub-permission checks inside legacy `_worker.js/routes/jobs.js:145,180` and `_worker.js/routes/loading.js` (10 call sites) + `_worker.js/routes/bols.js:572,601`, not via the prefix maps. Not a gap.

All 12 legacy map keys have matching `PERMISSION_LABELS` entries. All 13 v2 `PERMISSION_MAP` keys have matching labels, including `manufacturing.cutting.manage` and `manufacturing.cutting.override` (the latter is undocumented in `xpanda-ops-agents.md` — see AUDIT-004).

### AUDIT-001 — Legacy Production Inventory page (`production/inventory.html`) is fully broken: all 3 tabs query D1 tables that don't exist
- Category: Phase 0 — Inventory & drift baseline
- Severity: High
- Owning agent: production-agent (frontend/routes) + db-api-agent (schema)
- Evidence: `production/inventory.html` calls `/api/bead-stock` (line 436), `/api/block-inventory` (line 562), `/api/molding-log` (line 722), `/api/block-consumption` (line 711) — all four wired live in `_worker.js/index.js:65-68` to handlers in `_worker.js/routes/production.js` that run `SELECT/INSERT/UPDATE ... FROM bead_stock|block_inventory|molding_log|block_consumption_log`. Live D1 query confirms **zero** of these four tables exist: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bead_stock','block_inventory','molding_log','block_consumption_log')` → empty result set (database_id `21d6f47b-...`). `DB_Migrations/bead_inventory.sql` (header: "MIGRATION COMPLETE... kept for reference only") shows the *replacement* schema (`bead_types`, `silos`, `bead_transactions`) that IS live and correctly consumed by the separate `production/bead-inventory.html` page (`/api/silos`, `/api/bead-types`, `/api/bead-transactions` — all confirmed live tables). The block/molding side of the old schema (`block_inventory`, `molding_log`, `block_consumption_log`) has no replacement at all in the current schema and no migration file in `DB_Migrations/` — it was apparently dropped directly in the D1 console with no committed record.
- Failure mode / why it matters: Every GET/POST/PUT to any of these four endpoints throws a D1 "no such table" error, surfaced to the client as a raw crash (see Phase 1's AUDIT-101 stack-trace-leak finding) or a 500. `AGENTS.md` §6 Scope Guardrails still lists "Inventory — three-layer model (bead bags → blocks → molding log)" under "Established and actively used in production" — directly contradicted by current state. Mitigating: `CHANGELOG.md`'s P402 entry independently describes this same page as "the never-used v1 3-tab inventory page," and `BACKLOG.md` already has a queued item ("P403 — Archive v1 production module... retire v1 tables") — so this is a known-stale page pending retirement, not a surprise outage of a relied-upon flow. It is still permission-gated-reachable today (`production.inventory` / "Inventory (v1 — legacy)", assignable in Roles admin) and will 500 for anyone who opens it.
- Proposed remediation: Execute the already-queued `BACKLOG.md` P403 follow-up — remove `production/inventory.html`, its nav card/permission key, and the four dead `_worker.js/routes/production.js` handlers + `API_ROUTES` rows, once Steve signs off (data-retention note: the backing tables are already gone, so there's no data to retain from this specific page).
- Migration needed: no (tables already gone; this is a code-removal cleanup, not a schema change) · Effort: S · Depends on: none

### AUDIT-002 — Two D1 tables (`load_builder_skus`, `parts_library`) are fully orphaned, holding stale data
- Category: Phase 0 — Inventory & drift baseline
- Severity: Medium
- Owning agent: db-api-agent
- Evidence: Grep sweep of `_worker.js` + `cutting-pilot/src` for `\bload_builder_skus\b` and `\bparts_library\b` → zero matches in either codebase. Live D1 counts: `load_builder_skus` = 125 rows, `parts_library` = 50 rows. The `/api/load-builder-skus` route (`_worker.js/routes/bols.js:872-960`) — which one would expect to back the `load_builder_skus` table by name — actually reads/writes the unified `parts` table (184 rows) exclusively; confirmed by reading the full handler body (`handleApiLoadBuilderSkus`, `handleApiLoadBuilderSkusDeleteAll`, `handleApiPartsSeed`).
- Failure mode / why it matters: Dead schema clutter carrying real (if stale) row counts — a future migration or manual D1 console query against these names could be mistaken for live data. No runtime risk since nothing reads them, but it's the kind of drift that compounds confusion during future schema work.
- Proposed remediation: Confirm with Steve the two tables' data is genuinely superseded (they predate the unified `parts` table consolidation per `xpanda-ops-agents.md`'s migration list), then drop both in a follow-up migration.
- Migration needed: yes (DROP TABLE, after Steve confirms no residual value in the stale rows) · Effort: S · Depends on: none

### AUDIT-003 — No column-level drift found on sampled hot tables
- Category: Phase 0 — Inventory & drift baseline
- Severity: Low (informational — negative finding, recorded for coverage transparency)
- Owning agent: db-api-agent
- Evidence: `PRAGMA table_info` pulled live for `jobs` (46 cols), `cutting_lines` (9), `cutting_sessions` (12), `cutting_steps` (11), `schedule_rows` (18), `loading_assignments` (16), `sessions` (5), `parts` (17). Spot-checked v2 (`cutting-pilot/src/app/api/cutting/**`, `src/lib/*.ts`) column references (`qty_done_delta`, `handoff_note`, `photo_key`, `line_status`, `qty_target`, `qty_done`, `operator_id`, `operator_name`, and a sample of `j.*`/`jobs.*` references) against the live schema — all matched. No orphan-column or missing-column drift found on this sample.
- Failure mode / why it matters: n/a — negative result.
- Proposed remediation: n/a.
- Migration needed: no · Effort: n/a · Depends on: none

### AUDIT-004 — `manufacturing.cutting.override` permission key is undocumented in `xpanda-ops-agents.md`
- Category: Phase 0 — Inventory & drift baseline
- Severity: Low
- Owning agent: admin-auth-agent (doc owner) / next-platform-agent (feature owner)
- Evidence: `admin/roles.html:414` defines `'manufacturing.cutting.override': { group: 'Manufacturing', label: 'Cutting — Override (kick operators)' }`, and `cutting-pilot/src/middleware.ts:28` gates `/v2/api/cutting/kick` on it (`hasPermission(user, "manufacturing.cutting.override", "edit")`). `Prompts/prompt-372-cutting-4-kick-backend-permission.md` and `prompt-373-cutting-5-kick-ui.md` exist, confirming this shipped as a real feature. `xpanda-ops-agents.md` §8's "Migration-surface permission keys (v2)" subsection documents only `manufacturing.cutting` and `manufacturing.cutting.manage` — the override/kick key is absent from that list entirely.
- Failure mode / why it matters: Not a runtime bug — purely a docs gap. An agent reading `xpanda-ops-agents.md` to understand the v2 cutting permission model would miss that a third, distinct manager-only capability exists.
- Proposed remediation: Add a bullet for `manufacturing.cutting.override` to `xpanda-ops-agents.md` §8's migration-surface permission keys list, mirroring the existing two entries.
- Migration needed: no · Effort: S · Depends on: none

**Coverage & gaps:**
- **Table drift**: exhaustive for the orphan-table direction (all 49 app tables checked via grep reference-count sweep). The reverse direction (code referencing tables absent from D1) was found via a targeted `.prepare()` table-name extraction across `_worker.js/routes/*.js`, `_worker.js/lib/*.js`, and a sample of `cutting-pilot/src/app/api/**`+`src/lib/*.ts` — not 100%-exhaustive AST-level extraction, so a very small residual chance of a missed reference elsewhere exists, but the sweep covered every route file in both codebases.
- **Column drift**: sampled (9 of the 9 named hot tables checked via `PRAGMA table_info`; code cross-check was targeted at v2's cutting API + a jobs-column sample, not an exhaustive per-column grep across all legacy handlers — legacy `jobs.js`/`bols.js` column usage was not independently re-verified here since Phase 2 covers BOL/jobs invariants in depth).
- **Route/permission map**: exhaustive for the permission-key diff (all keys in both legacy maps and both v2/legacy label sets enumerated and cross-referenced). NOT exhaustive for "every frontend `fetch()` call resolves to a real `API_ROUTES` entry" — that would need a full fetch-call inventory across ~20 HTML/TSX files; only spot-checked as part of AUDIT-001's investigation. Flagging as a **suspected gap worth a dedicated pass** if Steve wants full route-reachability confirmation.

---

## Phase 1 — Error-handling & resilience

**Coverage:** Exhaustive grep sweep of every `catch (` block in `_worker.js/{index.js,lib/*.js,routes/*.js}` (9 route files + 2 lib files, ~100+ catch sites reviewed) and targeted review of `cutting-pilot/src/lib/session.ts`, `schedule-ingest.ts`, and 4 v2 route files with write loops. Not exhaustive over `cutting-pilot/src/app/**` (49 route.ts/page.tsx files) — sampled the ones with loop-based writes only.

### AUDIT-101 — Outermost catch-all still leaks raw stack traces to any client, pre- and post-auth
- Category: Phase 1 — Error-handling & resilience
- Severity: High
- Owning agent: db-api-agent
- Evidence: `_worker.js/index.js:288-298` — `catch (err) { const msg = err.stack || err.message ...; return new Response("Worker crashed:\n\n" + msg, { status: 500, headers: {...text/plain...} }); }`. This wraps the ENTIRE request pipeline: static-asset passthrough, the QBO OAuth callback and `/api/public/*` bypass paths (both explicitly pre-session-gate, `index.js:201-209`), the session gate itself, permission checks, and `dispatchApiRoute`. `validateSession`'s own exceptions are now caught locally (`index.js:216-221`, P405) and never reach this handler, but any *other* uncaught exception anywhere in the 53-route dispatch table, in `env.ASSETS.fetch`, or in the public/QBO bypass handlers still falls through to this catch and returns a full JS stack trace (file paths, line numbers, function names, and sometimes bound query values inside D1 error messages) as a plain-text 500 body to the requester — including unauthenticated requesters hitting `/api/public/*` or the QBO webhook before any session check runs.
- Failure mode / why it matters: Information disclosure — internal file layout, code structure, and potentially query fragments are handed to any client (including anonymous ones) on any unhandled exception. This is reconnaissance value for an attacker and a support/professionalism liability on a production ERP. P404 flagged this for follow-up once `validateSession` could throw; confirmed here that the throw path itself is now safe, but the outer catch-all's exposure is otherwise unchanged and was never scoped as its own fix.
- Proposed remediation: Replace the outer catch's raw `err.stack` body with a generic `"Internal Server Error"` response (or the existing `json({ok:false,error:'Server error.'})` shape) for the client, while still `console.error`-logging the full stack server-side (Cloudflare's dashboard already captures `console.error`/tail output) for debugging.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-102 — v2 `validateSession()` is missing legacy's opportunistic expired-session cleanup (drift from the "1:1 port" invariant)
- Category: Phase 1 — Error-handling & resilience
- Severity: Low
- Owning agent: next-platform-agent
- Evidence: `_worker.js/lib/core.js:75-79` — legacy `validateSession` has a `Math.random() < 0.01` branch that fire-and-forgets `DELETE FROM sessions WHERE expires_at < ?`. `cutting-pilot/src/lib/session.ts:52-146`'s `validateSession` has no equivalent block — compared line-by-line, this is the only structural difference; everything else (session lookup, `is_active`/expiry check, role-junction merge, `simulating_role_id` override, `isRealAdmin` detection, the `SessionLookupError`/retry contract) is faithfully mirrored.
- Failure mode / why it matters: Low functional impact today (legacy still runs the cleanup at 1% of its own request volume, and expired sessions are otherwise harmless — inert rows), but it contradicts the file's own header comment ("Ported 1:1 from `_worker.js/lib/core.js` validateSession()... Keep in sync if the legacy logic changes") and `SIGNOUT-INVESTIGATION-P404.md`'s claim that the two implementations are "structurally identical... no drift found." If legacy traffic share keeps shrinking as v2 modules take over, cleanup frequency drops with it since only legacy runs it.
- Proposed remediation: Port the same `Math.random() < 0.01` cleanup branch into `session.ts`'s `validateSession`, or explicitly document the omission as intentional (v2 read-only design) if that was the actual intent.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-103 — Redundant `validateSession()` call inside `handleApiUsers` duplicates the session-gate's D1 read on every `/api/users` request
- Category: Phase 1 — Error-handling & resilience
- Severity: Low
- Owning agent: db-api-agent
- Evidence: `_worker.js/index.js:217` already calls `validateSession(db, request)` in the global session gate for every non-static, non-public request. `_worker.js/routes/admin.js:63-75`'s `handleApiUsers` calls it AGAIN (`sessionUser = await validateSession(db, request)`) before doing its own `isRealAdmin` check — a second full session+role-junction D1 round trip for the exact same request/cookie the gate just validated.
- Failure mode / why it matters: Doubles D1 read load on `/api/users` specifically (admin-only, so low request volume — this is the same class of "extra chance for a transient D1 exception" contention the signout investigation (`SIGNOUT-INVESTIGATION-P404.md` §3/§5) flagged, just smaller-scale and correctly handled (it does catch `SessionLookupError` locally, `admin.js:69-73`) rather than fail-silent. Mirrors the already-tracked v2 analog in `BACKLOG.md` ("P406 follow-up — nine v2 `page.tsx` server components re-call `validateSession()`").
- Proposed remediation: Have `handleApiUsers` read the already-injected `X-User-*` headers (userId/isAdmin, set by the gate at `index.js:248-258`) instead of re-querying, the same pattern already used elsewhere in the codebase for operator identity.
- Migration needed: no · Effort: S · Depends on: none

**Checked, no new findings:**
- **Fail-silent auth-path catches**: none found. All three `validateSession()` call sites (`index.js:216-221`, `routes/auth.js:5-9`, `routes/admin.js:68-73`) correctly distinguish `SessionLookupError` (503 `session_unavailable`, retryable) from a genuine `null` (401/redirect) — this is the P405 fix, confirmed intact and complete; no sibling of the original signout bug's fail-silent pattern was found on the auth path.
- **Other fail-silent catches surveyed** (`_worker.js/routes/{jobs,bols,loading,public,quickbooks}.js`, `lib/push.js`): the overwhelming majority either (a) return a proper `{ok:false, error, detail}` 500 to the caller, or (b) are deliberate, commented non-fatal side-effect swallows on genuinely secondary paths (R2 upload-after-D1-write fallback, push-notification dispatch, shipment/loading-status cross-sync backfills, Lob address verification) where the primary response has already succeeded and the comment explicitly states the swallow is intentional (e.g. `public.js:126-129` "Notification failure must NOT break the pickup confirmation response"). None of these sit on an auth, money, or BOL-integrity write path the way the original bug did. `loading.js:587-589` is a minor inconsistency (returns a bare `Response('Server error', 500)` instead of the standard `json({ok:false,...})` shape) but is not fail-silent — not raised as a separate finding, too cosmetic to number.
- **Unbatched hot-path D1 writes**: `cutting-pilot/src/lib/schedule-ingest.ts` — confirmed P408's fix is real and current: writes are collected into `writeStatements`/`deleteStatements` arrays and submitted via `db.batch()` in `WRITE_BATCH_CHUNK`-sized chunks (`schedule-ingest.ts:275-314`), not sequential `await ...run()` in a loop. Swept remaining `for`/`.map` + `await db.prepare().run()` loops in `_worker.js/routes/{admin,bols,jobs,loading}.js`, `_worker.js/lib/cutting.js`, and 4 v2 route files (`cutting/queue`, `board`, `orders`, `cutting/cut-plan/save`) — all are bounded per-request loops sized to one job's line items / load count / cutting-process list (typically single digits to low tens), triggered by direct user action, not a cron/bulk-import burst against the shared D1 the way `schedule-ingest.ts` (up to ~180 rows every 15 min) was. No new sibling of the P408 anti-pattern found. The two R2-migration backfill loops in `index.js` (`loading-photos`, `packing-slips`, lines ~340-420) are also sequential per-row writes, but are manually admin-triggered, `LIMIT batchSize`-bounded, and not on any hot/cron path — noted as acceptable design, not flagged.
- **Legacy↔v2 validateSession sync**: see AUDIT-102 above for the one drift found; everything else is 1:1, including the `SessionLookupError`/retry contract, `isRealAdmin` detection, `simulating_role_id` override, and multi-role permission merge. `hasPermission()` mirrors are also logically identical (admin bypass, GET→view/mutate→edit).

---

## Phase 2 — Data-layer integrity

**Coverage:** Dual-timestamp-format check was exhaustive for write-site enumeration (every `datetime('now')` and `toISOString()` occurrence across `_worker.js` and `cutting-pilot/src`, ~90 call sites) plus live D1 verification on the one table (`activity_log`) where both formats collide, and a second confirmed collision on `parts.updated_at`. SQL-injection sweep was exhaustive for the `prepare(\`...${...}\`)` pattern across both codebases. `users.password` exposure was traced end-to-end for the one query that selects it. BOL/jobs invariants were verified by reading the actual CREATE/UPDATE handlers, not just grep. Holey-board orientation-constant drift could not be checked — no prior baseline value is recorded anywhere in the repo to diff against.

### AUDIT-201 — `activity_log.timestamp` mixes ISO-Z (legacy) and space-separated (v2) formats on a live, actively-queried `ORDER BY` column — confirmed broken sort in production
- Category: Phase 2 — Data-layer integrity
- Severity: High
- Owning agent: db-api-agent (legacy `logActivity`) + next-platform-agent (v2 inline inserts)
- Evidence: Legacy `logActivity()` (`_worker.js/lib/core.js:20-34`) writes both `timestamp` and `created_at` as raw `new Date().toISOString()` (e.g. `2026-08-25T12:18:00.900Z`). v2 has no shared helper, but at least 12 route files insert directly into the same `activity_log` table with a normalized-to-SQLite-format timestamp instead: `const now = new Date().toISOString().replace("T", " ").slice(0, 19)` (e.g. `2026-08-25 10:27:27`) — confirmed in `cutting-pilot/src/app/api/cutting/clock-in/route.ts:51,88-94` and the same pattern in `clock-out`, `kick`, `complete-line`, `chunk-session/{start,stop,complete}`, `line-item`, `board/[id]`, `orders`, `production/expansion/sessions`, `production/molding/sessions`. Live D1 confirms both formats coexist in the real table right now: `SELECT COUNT(*) FROM activity_log WHERE timestamp LIKE '%T%'` → 5177 rows (legacy), `WHERE timestamp LIKE '% %'` → 636 rows (v2), out of 5813 total. The consumer, `handleApiActivityLog` (`_worker.js/routes/admin.js:33`), runs `ORDER BY timestamp DESC` directly on this mixed column — the query backing `admin/activity-log.html`, the platform's audit-trail viewer (the same tool used to investigate the P404 signout incident).
- Failure mode / why it matters: String comparison of the two formats is wrong on any day both legacy and v2 wrote activity: ASCII `' '` (0x20) sorts before `'T'` (0x54), so a v2 entry and a legacy entry with the *same real timestamp prefix* will not interleave correctly — space-format (v2) rows sort as if earlier than same-day ISO-format (legacy) rows regardless of actual time-of-day. This silently scrambles chronological order in the one tool whose entire purpose is establishing what happened when — actively misleading for exactly the kind of incident investigation `SIGNOUT-INVESTIGATION-P404.md` did. Not a crash, so it's gone unnoticed, but it is live and wrong today, at a confirmed 636-row scale and growing on every v2 mutation.
- Proposed remediation: Standardize on one format platform-wide (space-separated is the more common site here, and it sorts correctly with SQLite's own `datetime()`/`CURRENT_TIMESTAMP`). Either (a) change legacy `logActivity()` to emit `new Date().toISOString().replace("T"," ").slice(0,19)` matching v2's convention, or (b) give v2's inserts a shared helper that matches legacy's raw ISO instead. Either direction requires a one-time backfill/normalization pass over the 5177+636 existing rows (or accept historical rows stay mixed and only fix going forward — cheaper, and the practical harm is mostly forward-looking). No schema change needed either way (same TEXT column).
- Migration needed: no (data backfill optional, not a schema migration) · Effort: S (code fix) / M (if backfilling history) · Depends on: none

### AUDIT-202 — `parts.updated_at` mixes ISO-Z and SQLite-native `datetime('now')` depending on which of two separate write paths touches the row
- Category: Phase 2 — Data-layer integrity
- Severity: Medium
- Owning agent: db-api-agent (spans two route files it owns: `production.js` and `bols.js`)
- Evidence: `_worker.js/routes/production.js`'s `handleApiParts` — the canonical parts CRUD backing `admin/parts.html` — writes `parts.created_at`/`updated_at` as `new Date().toISOString()` on both INSERT (line 45) and UPDATE (line 91). Separately, `_worker.js/routes/bols.js`'s `handleApiLoadBuilderSkus` PUT handler (the `/api/load-builder-skus/:id` endpoint backing the Load Builder's inline SKU editor) writes the *same column* as `updates.push("updated_at = datetime('now')")` (line 923) — SQLite-native space format. A part edited once through `admin/parts.html` and once through the Load Builder SKU editor ends up with two different timestamp formats on the same `updated_at` column across its lifetime.
- Failure mode / why it matters: No confirmed live `ORDER BY parts.updated_at` query was found in this pass (unlike AUDIT-201), so this is drift/latent risk rather than a proven-broken query today — rated Medium rather than High on that basis. If any future report, sync job, or "recently edited parts" view sorts or filters on `parts.updated_at`, it will silently misorder rows edited via the two different paths, the same class of bug as AUDIT-201.
- Proposed remediation: Change `bols.js:923` to match `production.js`'s convention (`new Date().toISOString()`) for consistency — smallest possible fix, one line.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-203 — Correction to AUDIT-504 (Phase 5): v2 does write to `activity_log`, just not via a function named `logActivity`
- Category: Phase 2 — Data-layer integrity (cross-phase correction, surfaced while tracing the timestamp-format writers above)
- Severity: n/a (report-accuracy note, not a platform defect)
- Owning agent: n/a
- Evidence: AUDIT-504 (Phase 5) originally stated "Grepping `cutting-pilot/src` for `logActivity` returns zero hits anywhere in the tree... none of v2's ~20 mutating API routes... write to `activity_log` at all." That grep was for the *function name* `logActivity`, which indeed doesn't exist in v2 — but at least 12 v2 route files insert directly into the `activity_log` table without going through a named helper (see AUDIT-201's evidence list: `clock-in`, `clock-out`, `kick`, `complete-line`, `chunk-session/{start,stop,complete}`, `line-item`, `board/[id]`, `orders`, both `production/*/sessions` routes). `BACKLOG.md`'s narrower, accurate claim — "`logActivity()` is legacy-worker-only; v2's `/v2/api/notes` POST/mark-viewed don't write to the shared `activity_log` table" — is correct as scoped to notes specifically; AUDIT-504's generalization to "the entire v2 API surface" was overstated. **AUDIT-504 has been corrected in place above (Phase 5 section) to reflect this.**
- Failure mode / why it matters: Whoever compiles fix prompts from AUDIT-504 as originally worded would scope a "build a v2 logActivity helper from scratch" prompt against a wrong premise. Recorded here so the correction has its own evidence trail.
- Proposed remediation: Before scoping a fix prompt from AUDIT-504, re-verify which specific v2 routes actually lack an `activity_log` insert (this pass didn't do that full audit — it only confirmed the ones enumerated above DO log). Likely candidates for genuinely missing coverage: `/v2/api/notes` (confirmed via `BACKLOG.md`), and any route not in the 12-file list above (not individually re-checked here).
- Migration needed: no · Effort: n/a · Depends on: none

### AUDIT-204 — `GET /api/users` returns every user's plaintext password in the same payload as the user list (by design, admin-only, but the bulk-exposure pattern is worth flagging)
- Category: Phase 2 — Data-layer integrity
- Severity: Low
- Owning agent: admin-auth-agent
- Evidence: `_worker.js/routes/admin.js:83-102` (`handleApiUsers` GET) selects `password` explicitly (`SELECT id, username, display_name, password, role, ...`) and spreads the full row (`...u`) into the JSON response for every user, on every load of the admin Users page. Confirmed this is intentional, not accidental: `admin/users.html:483,519` deliberately renders `u.password` in a visible table cell and pre-fills the edit modal with it — a designed admin-recovery feature, consistent with `AGENTS.md` §3's documented "Plaintext passwords in D1 (intentional — admin recovery for floor workers)." The route is `admin`-permission-gated (`API_PERMISSION_MAP`'s `/^\/api\/users/` → `admin`), so this isn't reachable by non-admins.
- Failure mode / why it matters: This is the "leakage" the audit prompt distinguishes from "storage" — even though storage is intentional and the leak is admin-only, bulk-returning every plaintext password in one list response (rather than a reveal-on-demand per-row endpoint) widens the exposure window: the full password list sits in the browser's network tab, devtools cache, and JS heap for as long as the Users page is open, and any future XSS on that specific admin page would be able to scrape every credential at once rather than one at a time. Given passwords are already plaintext by design, this is a hardening suggestion, not a bug.
- Proposed remediation: Optional hardening, not required: keep password out of the default list response and add a separate `GET /api/users/:id/password` (still admin-gated) that the UI calls only when an admin clicks "reveal" on a specific row. Low priority given the admin-only gate already in place; flag for Steve's judgment rather than treat as a required fix.
- Migration needed: no · Effort: S (if pursued) · Depends on: none

**Checked, no violation found:**
- **SQL injection**: exhaustive sweep of `prepare(\`...${...}\`)` across both codebases. Every hit interpolates only a dynamically-built list of `"column = ?"` strings (from a `.push()`/`.join()` pattern) or a `?`-placeholder count for an `IN (...)` clause — actual values are always bound via `.bind(...)`, never concatenated into the SQL text. No unparameterized user input reaches a query in this pass.
- **`PUT /api/bols/:id` full-row replace**: confirmed — `_worker.js/routes/bols.js:527-553`'s `UPDATE bols SET ...` lists essentially every editable column with the `s(f)` helper defaulting an absent payload field to `""` (not preserving the prior value), which is the correct "full replace" semantics per the documented invariant, not a partial-update leak.
- **`access_token` never overwritten**: confirmed on both paths. Create (`bols.js:389-416`) looks up and re-uses the most recent prior token for the same `(job_id, load_number)` before generating a new one only if none exists. Update (`bols.js:522-525`) reads `existing.access_token` and only calls `generateAccessToken()` `if (!access_token)`. Both paths correctly preserve a once-issued token, protecting printed QR codes.
- **`jobs.status` never set to the literal `'archived'`**: no live INSERT/UPDATE statement assigns `status = 'archived'` anywhere in `_worker.js` (grep-verified). The only `'archived'` string hits are `loading_assignments.loading_status != 'archived'` guard conditions (a different column/table) and a `jobs.js:621-622` code comment explicitly documenting that *legacy* rows may still carry a stale `status='archived'` value from before the orthogonal-archive (`archived_at`) model — matches the already-tracked `BACKLOG.md` item "P272 follow-up." Not a new finding; current code is compliant.

**Not independently checkable this pass:**
- **Holey-board orientation constants "unchanged"**: no baseline value is recorded anywhere in the repo (no prior audit snapshot, no comment stating "this must never change to X") to diff current constants against. `_worker.js/lib/holey-nester.js` has no literal `orientation`-named constant (grepped, zero hits). Flagging as a **suspected gap needing a dedicated pass** with someone who knows the intended baseline.

**Coverage & gaps:**
- Dual-timestamp-format check: **exhaustive** on write-site enumeration; **two confirmed live collisions** found (`activity_log.timestamp`, `parts.updated_at`) out of the ~15 tables carrying `created_at`/`updated_at`-style columns — the other tables were not individually verified for a second writer using the opposite format (this pass followed the two concrete leads that turned up rather than checking all ~15 tables' every write site against every other write site — **breadth achieved on write-site inventory, not on exhaustive per-table cross-comparison**).
- SQL injection: exhaustive for the specific interpolation pattern checked; did not separately audit `env.DB.exec()` (raw exec, if used anywhere) or any dynamic query-building outside the `prepare()` call convention.
- `users.password`: traced the one confirmed selecting query end-to-end; did not re-grep every other `SELECT ... FROM users` site for the same pattern.
- BOL/jobs invariants: (a) and (b) verified by direct code read; (c) verified by grep + comment context; (d) not checkable, see above.

---

## Phase 5 — Auth / permission completeness

### AUDIT-501 — QC mutation handlers (`scrap-log`, `completions`) never call `logActivity`
- Category: Phase 5 — Auth/permission completeness
- Severity: Medium
- Owning agent: qc-agent (+ db-api-agent for the shared rule)
- Evidence: `_worker.js/routes/qc.js` — `handleApiScrapLog` (POST `/api/scrap-log`, lines 175-336) and `handleApiCompletions`'s POST branch (`/api/completions`, lines 28-89) both insert new rows (`INSERT INTO scrap_log ...`, `INSERT INTO completions ...`) with zero calls to `logActivity()` anywhere in the file (`grep -c logActivity qc.js` → 0).
- Failure mode / why it matters: `AGENTS.md` §2 states "All mutating operations (POST/PUT/DELETE) must include `logActivity()` calls." Scrap entries and QC final-inspection attestations are real business/quality records with no audit trail — if a bad scrap entry or attestation needs tracing back to who/when outside the record's own timestamp, `admin/activity-log.html` shows nothing for these two modules.
- Proposed remediation: add a `logActivity(db, 'create', 'scrap_log', id, ...)` / `logActivity(db, 'create', 'completion', id, ...)` call after each successful insert, mirroring the pattern already used in `production.js`'s `handleApiParts`.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-502 — Production module: only `parts` CRUD has `logActivity` coverage; bead types/stock, block inventory, molding log, block consumption, and combos have none
- Category: Phase 5 — Auth/permission completeness
- Severity: Medium
- Owning agent: production-agent (+ db-api-agent)
- Evidence: `_worker.js/routes/production.js` — file-wide `logActivity(` count is 3, and all 3 are inside `handleApiParts` (create/update/delete, lines 54/103/130). `handleApiCombos` (POST/DELETE, lines 165 & 250), `handleApiBeadTypes` (POST/PUT/DELETE, lines 297-391 — verified by direct read, zero `logActivity` calls in the function), `handleApiBeadStock`, `handleApiBlockInventory`, `handleApiMoldingLog`, and `handleApiBlockConsumption` all support mutating methods per `AGENTS.md`'s documented `/api/*` list but none call `logActivity`.
- Failure mode / why it matters: same rule violation as AUDIT-501, but systemic across an entire module rather than one handler — six of seven mutating handler groups in `production.js` have zero audit trail. Inventory/molding data (raw material counts, block consumption against jobs) is exactly the kind of record where "who changed this stock count and when" matters for reconciling discrepancies. Note: some of these handlers (`handleApiBlockInventory`, `handleApiMoldingLog`) back the dead tables in AUDIT-001 and may be moot once that cleanup lands — `handleApiBeadStock` and `handleApiCombos` are still live and unaffected.
- Proposed remediation: add `logActivity()` calls to each handler's create/update/delete branches, scoped as a dedicated production-agent cleanup prompt (touches 5-6 handlers across one file — still one commit); coordinate with AUDIT-001's cleanup so dead-table handlers aren't instrumented just to be deleted.
- Migration needed: no · Effort: M · Depends on: none

### AUDIT-503 — `POST /api/bol-email/send` has no `logActivity` call
- Category: Phase 5 — Auth/permission completeness
- Severity: Low
- Owning agent: logistics-agent
- Evidence: `_worker.js/routes/bol-email.js` — `handleSend` (POST, routed at line 211) is the only mutating action in the file (`grep -c logActivity bol-email.js` → 0).
- Failure mode / why it matters: emailing a BOL to a customer is a real, externally-visible business action (a customer receives a document). No record in `activity_log` of who sent which BOL to whom, when — makes "did we already send this?" or "who sent the wrong BOL" unanswerable from the audit trail.
- Proposed remediation: add a `logActivity(db, 'send', 'bol_email', bolId, ...)` call in `handleSend` after a successful send.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-504 — ~~The entire v2 (`cutting-pilot/`) API surface has no `logActivity`-equivalent; every v2 mutation is unaudited~~ — CORRECTED by Phase 2 (see AUDIT-203): v2 does log to `activity_log`, just not via a function named `logActivity`
- Category: Phase 5 — Auth/permission completeness
- Severity: Medium → **downgraded to Low per correction**
- Owning agent: next-platform-agent
- Evidence (original, Phase 5): `BACKLOG.md`'s "Shift Notes" section already flags this narrowly for `/v2/api/notes` ("`logActivity()` is legacy-worker-only; v2's `/v2/api/notes` POST/mark-viewed don't write to the shared `activity_log` table"). Grepping `cutting-pilot/src` for the function name `logActivity` returns zero hits anywhere in the tree.
- **CORRECTION (Phase 2, AUDIT-203):** that grep only checked for a function named `logActivity` — it does not exist in v2, but at least 12 v2 route files insert directly into `activity_log` without going through a named helper (`clock-in`, `clock-out`, `kick`, `complete-line`, `chunk-session/{start,stop,complete}`, `line-item`, `board/[id]`, `orders`, both `production/*/sessions` routes — confirmed by reading each). The original claim that "none of v2's ~20 mutating API routes... write to `activity_log` at all" is **overstated**. `BACKLOG.md`'s narrower, accurate claim — v2's `/v2/api/notes` specifically doesn't log — still stands uncontested. The real gap is a partial subset of v2 routes (notes confirmed, others not individually re-checked), not the entire surface, and separately those inline inserts use an inconsistent timestamp format from legacy's (see AUDIT-201).
- Failure mode / why it matters: revised down — the v2 audit trail is real but partial and format-inconsistent, not absent. A fix prompt scoped from the original wording ("build a v2 logActivity helper from scratch, ~20 routes") would be working from a wrong premise.
- Proposed remediation: Before scoping any fix, re-verify which specific v2 routes actually lack an `activity_log` insert (this audit did not complete that full re-check). Confirmed-missing: `/v2/api/notes`. For routes that DO already insert inline, the more useful fix is a shared helper for consistency + the AUDIT-201 timestamp-format fix, not adding logging where it already exists.
- Migration needed: no · Effort: M (narrower than original L estimate — re-scope after the re-check) · Depends on: AUDIT-201 (timestamp format), AUDIT-203

### AUDIT-505 — Live, session-gate-bypassing QuickBooks webhook/OAuth endpoints for an integration `BACKLOG.md` calls "abandoned"
- Category: Phase 5 — Auth/permission completeness
- Severity: Low
- Owning agent: db-api-agent
- Evidence: `_worker.js/index.js:196-204` wires `POST /api/qb/webhook` and `GET /api/qb/callback` to explicitly bypass the session gate (comments confirm this is deliberate: "bypasses session gate; verified by HMAC-SHA256 signature inside handler"). `_worker.js/routes/quickbooks.js:88-140`'s `handleApiQbWebhook` is fully implemented (fetches invoice, creates job, calls `logActivity`). Signature verification (`_worker.js/lib/quickbooks.js:134-150`) fails closed when `env.QB_WEBHOOK_VERIFIER` is unset or the signature doesn't match — so this is not presently exploitable, just a live unauthenticated surface. Yet `BACKLOG.md`'s Admin/Platform section lists "Remove dead `_worker.js/routes/quickbooks.js` intake route (QBO abandoned — no domain API access); post-launch backlog cleanup" — i.e. the docs describe this as dead/abandoned, but the code is a fully-built, wired, auth-bypassing pipeline, not a stub.
- Failure mode / why it matters: an unauthenticated POST endpoint accepting arbitrary bodies is inert today (fails closed on signature check) but is still attack surface (parses JSON, does async work via `ctx.waitUntil`) for a feature the backlog says is abandoned. Doc/code mismatch also means a future cleanup pass might not realize how much is actually built here.
- Proposed remediation: no code change required for safety (already fails closed) — either (a) actually remove the route per the existing backlog item, or (b) if QB intake might resume later, update `BACKLOG.md` to say "built but dormant, secrets unset" rather than "abandoned," so a future cleanup doesn't accidentally delete a working pipeline or leave a stale doc claim uncorrected.
- Migration needed: no · Effort: S · Depends on: none

**Checked, no violation found:**
- **Permission-key parity (both directions)**: built the full key set from `PATH_PERMISSION_MAP` + `API_PERMISSION_MAP` (`_worker.js/lib/core.js`, 12 keys), v2's `PERMISSION_MAP` (`cutting-pilot/src/middleware.ts`, 12 keys), and the two ad-hoc in-body manager checks (`jobs.manage` in `jobs.js`, `logistics.loading.manage` in `bols.js`/`loading.js`) against all 24 keys in `PERMISSION_LABELS` (`admin/roles.html`). Every enforced key has a label; every label maps to an enforcement site somewhere (legacy map, v2 middleware map, or an in-body check). `manufacturing.cutting` and `manufacturing.cutting.manage` both confirmed present and enforced. No orphan keys, no dead labels found. (Cross-checked with Phase 0's independent count — Phase 0 also found no parity gaps; the two forks' key counts differ slightly by grouping method but agree on the conclusion.)
- **"Always accessible" allowlist**: `/api/auth/*`, `/login`, `/login.html`, `/api/public/*` (access-token-gated in-handler), and the QB webhook/callback (HMAC-gated, see AUDIT-505) are the only session-gate bypasses. The `ESCAPE_PREFIXES` role-simulation escape hatch (`_worker.js/index.js:234`) is scoped to `user.isRealAdmin` only — not a general bypass. Nothing sensitive found unexpectedly in an allowlist.
- **Gate coverage spot-check**: sampled `handleApiUsers`, `handleApiRoles`, `handleApiBols`, `handleApiJobs` mutation branches — all fall under a `PATH_PERMISSION_MAP`/`API_PERMISSION_MAP` entry (`admin`, `logistics.bol`, `jobs` respectively) with GET→view/mutate→edit enforced by the session gate before the handler runs. `/api/holey-chunks` (preview, non-backfill) remains unmapped → authenticated-allowed by the `getPermissionKey` fallthrough (`hasPermission` returns `true` when `permKey` is null) — this is already tracked in `BACKLOG.md` as low-priority/acceptable ("fine for compute-only, tidy later"), not a new finding.

**Coverage & gaps:**
- `logActivity` coverage check was **exhaustive** for `_worker.js/routes/*.js` (grep count of `logActivity(` vs mutating-method checks per file, then manually read every file with a mismatch: `qc.js`, `bol-email.js`, `production.js`, `notifications.js`). `notifications.js`'s single mutation check is a push-subscribe/unsubscribe endpoint (device registration, not a business record) — judged out of scope for the audit rule's intent, not listed as a finding.
- Gate coverage was **sampled**, not exhaustive — 4 representative handlers traced end-to-end; the other ~45 `API_ROUTES` entries were not individually traced against the permission map.
- Permission-key parity was **exhaustive** (all keys on all three maps enumerated and cross-referenced).
- Did not independently verify v2's `manufacturing.cutting.override` header-injection wiring beyond confirming the key exists and is referenced in `middleware.ts` (line 115) — did not trace the "kick operators" UI consumer.

---

## Phase 3 — Dead / orphaned code from feature churn

**Coverage:** Targeted grep + direct file/D1 verification against the specific items §4a/BACKLOG.md already flag as removal-candidates. Not an exhaustive file-by-file dead-code sweep of every HTML module (breadth-over-depth per the audit's own rule) — orphaned-file checking was sampled (nav links in `manufacturing/index.html`/`index.html`, one `localStorage` version key, two flagged D1 tables, two flagged API routes), not run across all 8 modules' nav trees.

### AUDIT-301 — Legacy cutting stack is fully retirement-ready; only the worker/table layer remains
- Category: Phase 3 — Dead/orphaned code
- Severity: Medium
- Owning agent: manufacturing-agent (page/nav layer, already done) + db-api-agent (worker/table layer, still open)
- Evidence: `manufacturing/cutting-dashboard.html` no longer exists at its old path — confirmed moved to `manufacturing/_archived/cutting-dashboard.html` (P234, per `CHANGELOG.md:2418`). Grepped `manufacturing/index.html` and `index.html` (the two nav surfaces) for `cutting-dashboard` — zero hits; both link exclusively to `/v2/cutting` and `/v2/cutting/crosscutter` (`manufacturing/index.html:43,48`; `index.html:421-422`). But `_worker.js/index.js:8` still `import`s `handleApiCutting` from `./routes/cutting.js`, and `_worker.js/lib/cutting.js` + `_worker.js/routes/cutting.js` + the `cutting_steps` table are still live and wired into `/api/cutting*` and the `jobs.processes` pill-sync path (per `CHANGELOG.md:2418`, "deliberately left intact — their removal remains a separate backlog item"; also tracked in `BACKLOG.md`'s Manufacturing/Cutting section: "Retire cutting_steps + /api/cutting* + routes/cutting.js + lib/cutting.js").
- Failure mode / why it matters: Not a breakage risk today (nothing links to it), but it's dead weight: a live D1 table + ~2 files + an API route surface that cost a permission check and a code-review mental-model tax on every future `_worker.js` change, with zero users since P234. The precondition the backlog item names ("once v2 cutting reaches the floor") is now met — v2 `/v2/cutting` + `/v2/cutting/crosscutter` are both live, both linked from both nav surfaces, and `xpanda-ops-agents.md` §4a already states "Do not invest new feature work in the cutting_steps model."
- Proposed remediation: A scoped removal prompt: drop the `cutting_steps` table (after confirming zero remaining reads — the archived HTML page itself still calls `/api/cutting`, so either delete the archived page too or accept it as a dead fallback), remove `routes/cutting.js`, `lib/cutting.js`, the `import`/route-table entries in `index.js`, and the `jobs.processes`↔`cutting_steps` pill-sync calls in `routes/jobs.js`.
- Migration needed: yes (DROP TABLE) · Effort: M · Depends on: none

### AUDIT-302 — `/v2/cutting`'s dormant chunk logic confirmed genuinely unreachable from the UI, not just "reduced"
- Category: Phase 3 — Dead/orphaned code
- Severity: Low
- Owning agent: react-component-agent (UI) + next-platform-agent (API routes)
- Evidence: `cutting-pilot/src/app/api/cutting/queue/route.ts:10,15` — self-documented: `// Chunk branches below (CHUNK_LINES, taper Cross Cutter derivation) are left dormant on purpose.` / `const CHUNK_LINES = new Set(["Cross Cutter", "Hole Cutter"]);`, with `queue/route.ts:282` actively skipping any line in that set. Traced the two chunk-input UI paths in `PartsPanel.tsx`: the taper-yield input only renders `if (job.is_taper && line === "Cross Cutter")` (`PartsPanel.tsx:107`), and the plain chunk-target input only fires `onSetChunkTarget` when `line === "Cross Cutter"` and NOT the HB-guillotine case (`PartsPanel.tsx:147`, `CuttingBoard.tsx:227-232` routes HB-guillotine Main/Blue jobs to a different endpoint, `hb-chunk-override`). Since `PROCESS_ORDER` on this board is hardcoded to `["Main Line", "Blue Line"]` in 3 separate route files (`queue/route.ts:11`, `clock-in/route.ts:13`, `complete-line/route.ts:11`) and `dockLine` can only take those two values, `line === "Cross Cutter"` can never be true at runtime — confirming `POST /v2/api/cutting/chunk-target` and `POST /v2/api/cutting/taper-yield` are unreachable from this board's UI (the standalone `/v2/cutting/crosscutter` board doesn't call them either — it uses `cc-assignments`/`chunk-session` endpoints instead, per `xpanda-ops-agents.md` §migration-surface-additions).
- Failure mode / why it matters: Confirms `BACKLOG.md`'s "Cleanup: remove dormant chunk branches + dead endpoints (chunk-target, taper-yield, cut-plan, CHUNK_LINES, taper Cross Cutter derivation) from /v2/cutting once the standalone board (P292–P294) is proven" — the stated precondition is now met (the standalone chunk board is live and linked, confirmed in AUDIT-301's evidence). No functional risk (dead code doesn't execute), but it's ~2 API route files + 3 duplicated `PROCESS_ORDER`/`CHUNK_LINES` constants + UI branches that will silently bit-rot and confuse anyone reading `/v2/cutting` fresh.
- Proposed remediation: Execute the already-scoped `BACKLOG.md` cleanup item as-is: delete `chunk-target/route.ts`, `taper-yield/route.ts`, the `CHUNK_LINES`-gated branches in `queue.ts`, and the corresponding dead UI branches in `PartsPanel.tsx`/`CuttingBoard.tsx`.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-303 — Two D1 tables (`load_builder_skus`, `parts_library`) are fully dead, holding stale data
- Category: Phase 3 — Dead/orphaned code
- Severity: Medium
- Owning agent: db-api-agent
- Evidence: Cross-references AUDIT-002 (Phase 0) — same two tables, independently confirmed by this fork. `grep -rlE "\bload_builder_skus\b|\bparts_library\b" _worker.js cutting-pilot/src` returns zero files. `/api/load-builder-skus` (the route whose name implies it should use this table) instead reads/writes the `parts` table entirely. D1 confirms both orphan tables still hold data: `load_builder_skus` = 125 rows, `parts_library` = 50 rows, vs. `parts` = 184 rows (live).
- Failure mode / why it matters: Not a breakage risk (nothing reads them), but a real trap for anyone querying D1 directly during a future incident — both table names read as exactly the kind of table you'd expect the load builder / parts UI to be backed by, and both hold plausible-looking stale data that could be mistaken for current state.
- Proposed remediation: Same as AUDIT-002 — confirm with Steve neither table is a manual-query habit he relies on, then `DROP TABLE load_builder_skus; DROP TABLE parts_library;` in one migration (do not double-count as a separate fix prompt from AUDIT-002).
- Migration needed: yes (DROP TABLE) · Effort: S · Depends on: AUDIT-002 (duplicate finding, same fix)

### AUDIT-304 — `GET /api/reports/cutting-sessions` confirmed orphaned, no remaining caller
- Category: Phase 3 — Dead/orphaned code
- Severity: Low
- Owning agent: reports-agent / db-api-agent
- Evidence: `_worker.js/index.js:58` still registers `{ path: '/api/reports/cutting-sessions', handler: (req, env) => handleCuttingSessionsReport(req, env) }`, handler defined at `_worker.js/routes/reports.js:588`. `grep -rl "cutting-sessions" reports/` (the only plausible frontend consumer directory) returns zero files. Matches `BACKLOG.md`'s Reports section: "P391 follow-up — orphaned endpoint... Confirm no other caller, then remove the handler and its API_ROUTES row" — confirmed here: no other caller found.
- Failure mode / why it matters: Pure dead code, zero risk; already correctly identified and scoped in `BACKLOG.md`, just not yet executed.
- Proposed remediation: Remove the `API_ROUTES` row and the `handleCuttingSessionsReport` function per the backlog item's own description — this is a trivial one-line-plus-function-body removal, good candidate for bundling into any other reports-agent cleanup prompt.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-305 — SUSPECTED: `BACKLOG.md`'s QuickBooks-integration status is stale — code and schema show substantially more is already built than the backlog describes as "not started" (and a second backlog entry contradicts the first)
- Category: Phase 3 — Dead/orphaned code (code-vs-docs reality check; cross-reference Phase 6 and AUDIT-505)
- Severity: Medium
- Owning agent: db-api-agent (needs Orchestrator/Steve reconciliation, not a pure code fix)
- Evidence: `BACKLOG.md`'s "QuickBooks Integration" section describes QB1–QB6 as **all unbuilt** (`[ ] QB1 — Connectivity + custom-field recon`, `[ ] QB4 — OAuth connect + token storage. qb_tokens table (needs migration)...`), status "Fully scoped 2026-06-05, intentionally deferred." But `_worker.js/routes/quickbooks.js` (311 lines) already implements `createJobFromInvoice`, and imports `getValidToken/saveConnection/fetchInvoice/verifyWebhookSignature/buildAuthUrl/exchangeCodeForTokens` from an already-existing `_worker.js/lib/quickbooks.js`, plus `mapInvoiceToJob` from an already-existing `_worker.js/lib/qb-mapper.js`. All three routes are live and wired in `index.js`: `/api/qb/*` prefix (line 71), `/api/qb/webhook` POST (line 197-198), `/api/qb/callback` GET (line 203-204) — with a comment "State cookie set by /api/qb/oauth guards against CSRF" implying an OAuth connect flow already exists too. D1 confirms a `qb_connections` table already exists live with exactly the columns QB4 describes as needing a new migration for (`id, realm_id, access_token, refresh_token, token_expires_at, created_at, updated_at`) — but under a DIFFERENT name than the backlog's planned `qb_tokens`. Separately, `BACKLOG.md`'s Admin/Platform section has ANOTHER, contradictory line: "Remove dead `_worker.js/routes/quickbooks.js` intake route (QBO abandoned — no domain API access); post-launch backlog cleanup" — describing the same file as dead/abandoned rather than a half-built version of the QB1-6 plan. (See also AUDIT-505, Phase 5's independent finding that this same route is live, session-gate-bypassing, and fails closed.)
- Failure mode / why it matters: This is a genuine "which doc do I believe" hazard for whoever picks up either the QB1 prompt or the "remove dead quickbooks.js" cleanup item — they contradict each other about the same code, and neither matches what's actually in the repo (a substantial, non-trivial, apparently-functional implementation, not a stub). Building QB1 without first reading the existing `routes/quickbooks.js`/`lib/quickbooks.js`/`qb_connections` risks duplicate work or a broken merge of two competing QB integrations. This is flagged **suspected — needs dedicated pass**, not confirmed root cause: did not test whether this code path is reachable/functional in production (no live QB webhook traffic observed), whether `qb_connections` has any rows, or when this code was actually written relative to the "Fully scoped 2026-06-05" backlog entry.
- Proposed remediation: Before scoping any QB1-6 prompt or the "remove dead quickbooks.js" cleanup, spend 30 minutes reading `_worker.js/lib/quickbooks.js`, `_worker.js/lib/qb-mapper.js`, and `_worker.js/routes/quickbooks.js` in full, check `qb_connections` row count, and check `git log` on those three files to establish actual history/currency — then correct whichever `BACKLOG.md` entry is stale (likely rewrite the QB1-6 section to reflect what's already done, or confirm it really is dead and safe to delete).
- Migration needed: unknown (pending the dedicated pass) · Effort: S (investigation) · Depends on: none

**Checked, no new findings:**
- `logistics/load-builder.html`'s `STORAGE_KEY` is `"foam_trailer_loader_v31"` (line 451) — matches the current version cited in `AGENTS.md`/`xpanda-ops-agents.md`; no stale older-version key found still being read/written in a targeted grep.

**Coverage:** Sampled, not exhaustive. Confirmed: legacy cutting-dashboard nav status (exhaustive for the 2 nav files that matter), v2 dormant-chunk-logic reachability (traced fully for the specific functions BACKLOG.md names), 2 already-flagged orphan tables (confirmed, not newly discovered beyond parent session), 1 already-flagged orphan endpoint (confirmed). NOT covered: a full nav-link audit of all 8 modules' HTML for other orphaned pages; a full `API_ROUTES` vs. frontend-`fetch()` diff across all 53 routes (only sampled the 2 backlog-flagged ones); exported-function-never-imported sweep (not attempted — would need a proper JS reference graph, out of scope for a grep-based pass). AUDIT-305 in particular needs a dedicated follow-up pass, not further chase here.

---

## Phase 4 — Duplication & single-source-of-truth drift

**Coverage:** Targeted greps across legacy HTML/JS (modal patterns, BOL coordinate objects, density-formula implementations) and a direct line-by-line comparison of `hasPermission()` and the `xpanda_session` cookie-parse regex between `_worker.js/lib/core.js` and `cutting-pilot/src/lib/session.ts`. Sampled, not exhaustive, on the modal sweep (pattern-matched, did not read every modal's full JS body).

### AUDIT-401 — Seven legacy pages hand-roll their own modal open/close/backdrop logic; no shared `<Modal>`-equivalent primitive exists in legacy
- Category: Phase 4 — Duplication & SSOT drift
- Severity: Medium
- Owning agent: admin-auth-agent (admin/*.html) + job-board-agent (jobs/index.html) + logistics-agent (logistics/index.html) + production-agent (production/inventory.html) + manufacturing-agent (block-calculator.html)
- Evidence: `grep -l 'class="modal-overlay"\|class="modal-backdrop"\|function openModal\|function closeModal'` across the repo matches 7 independent files: `admin/users.html`, `admin/parts.html`, `admin/roles.html`, `jobs/index.html`, `logistics/index.html`, `production/inventory.html`, `manufacturing/block-calculator.html`. Each defines its own local open/close functions and modal markup rather than consuming a shared component/module — this is exactly the anti-pattern `xpanda-ops-agents.md` §9b names as the reason the React migration exists ("The legacy platform reinvented components by hand... pays for it with copy-pasted modals that drift and break").
- Failure mode / why it matters: A fix applied to one modal (e.g. an Escape-key handler, a focus-trap, a backdrop-click-to-close behavior, an accessibility attribute) does not propagate to the other six — this is the live legacy analog of the exact class of bug P407 just fixed for the fetch interceptor (ten copies, one drifted/needed consolidating). Not urgent (no incident yet), but it's the next most likely candidate for the same kind of silent drift.
- Proposed remediation: Not a one-commit fix given the "surgical changes only" rule (`AGENTS.md` §9) and no build/module system in legacy vanilla JS — extracting a true shared component would need a `<script src>`-loadable shared modal helper (mirroring `shared/auth-interceptor.js`'s consolidation pattern) that each page opts into individually, one page per follow-up prompt rather than a single sweep. Flag for backlog, not urgent.
- Migration needed: no · Effort: L (7 call sites, each its own careful pass) · Depends on: none

**Checked, no findings (confirmed intact / correctly centralized):**
- **BOL coordinate SSOT**: `logistics/bol-shared.js`'s `COORDS` object is the only coordinate table in the repo — grepped `logistics/*.html` and `logistics/*.js` for a second `x:`/`y:` coordinate object or a redefinition of `COORDS`; found none. `bol-compose.js` and `bol-editor.js` both consume `bol-shared.js` rather than duplicating it. No violation of the "NEVER duplicate COORDS" rule.
- **Density/packing math SSOT**: `shared/shared-utils.js`'s `calculateDensity(weightLbs, lengthIn, widthIn, heightIn)` is the only implementation of the cubic-inches→cubic-feet→density formula in the codebase. `qc/density-calculator.html` calls `utils.calculateDensity(...)` rather than reimplementing it — it does define its own *local* function also named `calculateDensity(showErrors)`, but that's a UI-event handler that delegates to the shared math function, not a second implementation of the math itself; naming collision only, not logic duplication.
- **`window.fetch` 401-interceptor (P407)**: re-verified independently — `shared/auth-interceptor.js` is the sole `window.fetch =` override in the repo; all six `*-header.js` module headers delegate to `shared/shared-header.js`, which loads the interceptor; the five previously-standalone pages (`index.html`, `admin/{users,activity-log,parts,roles}.html`) all now reference `auth-interceptor.js` directly. No site reverted to a local copy.
- **`hasPermission()` port sync**: `_worker.js/lib/core.js:230-238` and `cutting-pilot/src/lib/session.ts:149-159` are logically identical — same admin-bypass short-circuit, same fail-open-on-null-permKey behavior (`if (!permKey) return true`, both sides — this is the same fail-open default flagged separately in Phase 0/AUDIT-P0-2 as a finding, confirmed here to be consistently ported, not a v2-only gap), same view/edit branching. No drift.
- **Session-cookie parse regex**: byte-identical `/(?:^|;\s*)xpanda_session=([^;]+)/` in both `_worker.js/lib/core.js:46` and `cutting-pilot/src/lib/session.ts:29`. No drift.

**A note on scope overlap (folded into AUDIT-602 below):** While investigating BOL-related duplication, this fork found `logistics/bol-generator.html` has been archived (`logistics/_archived/bol-generator.html`) and BOL generation now runs through `bol-compose.js`/`bol-editor.js` — but both `AGENTS.md` and `xpanda-ops-agents.md` still describe it as a live, owned file. This is a docs-drift finding, not a duplication finding; the Phase 6 fork independently found and numbered the same issue (AUDIT-602) with additional detail (including a now-dead `PATH_PERMISSION_MAP` pattern) — not double-counted here.

**Coverage & gaps:** Modal sweep was pattern-based (class name / function name grep), not a read of every modal's full implementation — could not confirm to what degree the 7 modals' *internal* logic (vs. just structure) has already drifted from each other; flagging as **suspected — needs a dedicated pass** if a consolidation prompt is scoped. BOL-coordinate and density-math SSOT checks were closer to exhaustive (grepped for the actual formula/coordinate structure, not just a keyword). Ported-logic checks (`hasPermission`, cookie parsing) were exhaustive for the two functions named in the prompt spec; did not additionally check every other small helper for legacy↔v2 drift beyond what Phase 1's fork already covered for `validateSession`.

---

## Phase 6 — Docs & process drift + backlog risk dig

**Coverage:** Scripted diff (exhaustive) of `Prompts/*.md` (169 numbered files, excludes `Prompts/archived_prompts/` — 225 files, NOT diffed, see gap note) against `CHANGELOG.md` (2673 lines). Spot-checked ~8 file-size/line-count claims in `xpanda-ops-agents.md`/`AGENTS.md` against actual `wc`. Targeted grep for the two backlog-risk items named in the audit prompt (packing-slip ~87 unmatched lines, load-builder "unnecessary failsafes"). Did not read `BACKLOG.md` end-to-end for the stale-`[ ]`-item sweep — sampled the sections most likely to drift (Load Builder, Job Board, Manufacturing/Cutting).

### AUDIT-601 — `ROADMAP.md` contains no roadmap content — it's the verbatim text of an unrelated prompt file
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Medium
- Owning agent: Orchestrator (docs-only, no code owner)
- Evidence: `ROADMAP.md` (195 lines) opens "You are working inside the xPanda Operations Platform repository... Objective: Create a new QC utility tool for day-to-day floor use: /qc/density-calculator.html..." — this is a task-prompt spec for the density calculator, not a roadmap. `git log --follow -- ROADMAP.md` shows exactly one commit ever touched it: `0d1698e` (2026-03-30), "Improve platform navigation and add density calculator roadmap." No commit since has corrected it — 5 months of subsequent development (169+ numbered prompts) with a repo-root `ROADMAP.md` containing the wrong content the entire time. Compounding: `xpanda-ops-agents.md`'s own Repository Structure section describes it as `ROADMAP.md (5KB — implementation roadmap)` — the doc-of-docs is itself wrong about what this file contains, and this audit's own Required Reading list names `ROADMAP.md` expecting real roadmap content.
- Failure mode / why it matters: Anyone (human or agent) consulting `ROADMAP.md` for actual platform direction gets a stale single-feature prompt instead. Not a runtime risk, but a real "loose end" of exactly the kind this audit was scoped to surface — a doc that looks authoritative and is silently wrong.
- Proposed remediation: Either populate `ROADMAP.md` with real forward-looking roadmap content (if Steve wants one) or delete it and remove the reference from `xpanda-ops-agents.md`'s repo structure listing. Low effort either way.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-602 — `xpanda-ops-agents.md`/`AGENTS.md` describe `logistics/bol-generator.html` as a live, owned 59KB file — it was archived ~230 prompts ago
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Medium
- Owning agent: logistics-agent (file ownership doc) / Orchestrator (repo structure doc)
- Evidence: `logistics/bol-generator.html` does not exist at that path (`ls logistics/` confirms; it lives at `logistics/_archived/bol-generator.html`). `git log --oneline --diff-filter=D -- "logistics/bol-generator.html"` shows it was archived in commit `e325cc9`, "P176: archive bol-generator.html, popup launcher, fix viewer z-index" — well over 200 prompts before the current P409. Yet: (1) `xpanda-ops-agents.md`'s Orchestrator "Repository Structure (Verified)" section lists `logistics/bol-generator.html (59KB — BOL PDF generation via pdf-lib)` as present; (2) its §3 Logistics Agent section lists it under "Key Files You Own" and describes "BOL Generator: PDF generation via pdf-lib.js" as current domain knowledge; (3) `AGENTS.md`'s §4 Module Overview table lists `logistics/bol-generator.html` as a Key File for the Logistics module. BOL generation actually runs through `logistics/bol-compose.js` (shared engine per the CHANGELOG's "BOL re-unification" P122-128 sequence), consumed by `load-builder.html` and `logistics/index.html` — the standalone generator page is gone. Independently corroborated by the Phase 4 fork, which additionally found `_worker.js/lib/core.js:180`'s `PATH_PERMISSION_MAP` still has a now-dead `pattern: /^\/logistics\/bol-generator/` entry mapping a URL that 404s today.
- Failure mode / why it matters: Both required-reading docs for every agent working on this codebase point at a file that hasn't existed for ~230 prompts. An agent told to "edit the BOL Generator" per these docs would either fail to find the file or, worse, resurrect it from `_archived/` and reintroduce a duplicate BOL-generation code path — directly the kind of SSOT violation `bol-shared.js`'s own "never duplicate" rule exists to prevent.
- Proposed remediation: Update both docs' file listings to describe the actual current BOL flow (`bol-compose.js` as the shared engine, consumed by `load-builder.html`/`logistics/index.html`), removing the `bol-generator.html` references; also remove the dead `PATH_PERMISSION_MAP` entry in `core.js` while touching that area.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-603 — File Size Budget table and per-module file-size claims in `xpanda-ops-agents.md` are stale (up to 2x drift)
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Low
- Owning agent: Orchestrator (docs-only)
- Evidence: Spot-check via `wc -c`/`wc -l` against `xpanda-ops-agents.md`'s claimed sizes: `jobs/index.html` claimed "78KB" (§2 Job Board Agent, and §10 File Size Budget table) — actual **152KB** (155,234 bytes), essentially double. `logistics/index.html` claimed "65KB" — actual **91KB** (93,364 bytes), +40%. `_worker.js/routes/bols.js` claimed "~840 lines" (§10 File Size Budget table) — actual **961 lines**, +14%. By contrast `load-builder.html` (159KB claimed vs 157KB actual) and `block-calculator.html` (108KB claimed vs 108KB actual) are still accurate, so this isn't uniform rot — it's specific files that kept growing after the doc was last refreshed (`xpanda-ops-agents.md` header says "Last Analyzed: 2026-07").
- Failure mode / why it matters: Low risk on its own (informational context, not a rule agents act on programmatically), but it's a second independent signal (alongside AUDIT-601/602) that the "living doc" hasn't actually been kept current against the modules that are changing fastest (Job Board, Logistics) — exactly the docs most likely to mislead an agent scoping a new prompt's blast radius.
- Proposed remediation: Refresh the file-size figures in `xpanda-ops-agents.md`'s Repository Structure and File Size Budget sections next time either file is touched substantively; not worth a dedicated prompt on its own.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-604 — Packing-slip parser's "~87 unmatched lines" (per this audit's own prompt framing) is stale; P387/P389 already closed most of that gap
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Low
- Owning agent: job-board-agent
- Evidence: `Prompts/prompt-P409-audit-01-platform-health-qc.md` §Phase 6.2 directs the audit to "pull specifically on... the packing-slip parser's ~87 unmatched lines." `CHANGELOG.md`'s P387 entry documents a diagnostic against the full 139-slip corpus that found 191 unmatched lines pre-fix, then a fix that recovered all 191 and lifted the corpus match rate from 37.5% to 68.7%, leaving only 21 thickness-less HB base lines (deliberately out of scope) plus "remainder of block"/"pallet foam" note lines and the alias-table gap as open remainder — all of which ARE already correctly tracked as open items in `BACKLOG.md`'s Job Board section. No new backlog item is needed; the "~87" figure itself doesn't match any number found in the CHANGELOG or BACKLOG (191 before fix, 21 after) and appears to be a stale/imprecise figure carried in verbal/tribal framing rather than the current written record.
- Failure mode / why it matters: Not a code risk — a case of the audit's own briefing citing an outdated number. Flagging so whoever scopes the next packing-slip prompt uses BACKLOG.md's current, already-correct framing (21 base lines + note lines + alias table) rather than chasing a "~87" figure that doesn't exist in the current corpus state.
- Proposed remediation: No code action. If Steve intends a follow-up prompt here, scope it directly from the three existing BACKLOG.md items already listed under Job Board, not from the "~87" figure.
- Migration needed: no · Effort: n/a (informational) · Depends on: none

### AUDIT-605 — "Load-builder unnecessary failsafes from the slow rollout" (audit prompt framing) does not correspond to any current BACKLOG.md item
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Low
- Owning agent: logistics-agent
- Evidence: `Prompts/prompt-P409-audit-01-platform-health-qc.md` §Phase 6.2 also directs pulling on "the load-builder iceboxed bugs / 'unnecessary failsafes from the slow rollout.'" `BACKLOG.md`'s Load Builder section (under Logistics) currently has only 3 open items (larger initial calculated-load view, customize-mode drag-and-drop clarity, DISSOLVE per-piece granularity) — none mention failsafes or a rollout. Repo-wide grep for "failsafe"/"rollout" (case-insensitive, all `.md`) finds no BACKLOG.md hits; the closest CHANGELOG hits are unrelated "soft rollout" mentions for the v2 cutting queue (P290/P291) and a "Soft Rollout Batch" for logistics status write-through (P90-92) — neither is a load-builder failsafe item.
- Failure mode / why it matters: Either this is tribal knowledge Steve has that never made it into `BACKLOG.md` (in which case BACKLOG.md is the thing that's incomplete — worth asking him directly rather than guessing), or it's a misremembered reference from an earlier conversation. Recorded as suspected/unconfirmed per the audit's own "needs dedicated pass" allowance rather than fabricating a backlog item to match.
- Proposed remediation: Ask Steve directly what specific load-builder failsafe(s) he has in mind; write the real BACKLOG.md item once identified rather than guessing from this pass.
- Migration needed: no · Effort: n/a · Depends on: none

### AUDIT-606 — `CHANGELOG.md` coverage gap: none found for the numbered `Prompts/` set; `Prompts/archived_prompts/` (225 files) not diffed
- Category: Phase 6 — Docs & process drift + backlog risk
- Severity: Low
- Owning agent: Orchestrator (process/docs)
- Evidence: Scripted diff of all 169 files in `Prompts/*.md` (excluding the `archived_prompts/` subfolder) against `CHANGELOG.md` by extracting each filename's prompt number and grepping for it in the changelog: the only gap found is `prompt-P409-audit-01-platform-health-qc.md` itself — the audit currently in progress, which is expected (report-only prompts note themselves in CHANGELOG.md per the platform rule, and this report hasn't shipped yet). No other gaps. Ambiguous-numbered files were spot-checked by hand (e.g. both `prompt-305-fix-logout-getsessiontoken.md` and `prompt-305-tv-board-scaling-fix.md` — a genuine duplicate prompt number across two unrelated fixes — each have distinct CHANGELOG entries). `Prompts/archived_prompts/` (225 files, no README/index) was NOT diffed — out of scope for this pass's time budget.
- Failure mode / why it matters: Low — the live/numbered prompt set (which is what agents actually reference day-to-day) has clean CHANGELOG coverage. The archived folder is a coverage gap in this audit, not a confirmed platform defect.
- Proposed remediation: If a dedicated docs-drift pass is ever scoped, diff `archived_prompts/` too; otherwise no action needed.
- Migration needed: no · Effort: n/a · Depends on: none

**Coverage summary:** CHANGELOG-gap check — exhaustive over numbered `Prompts/`, not run over `archived_prompts/`. BACKLOG stale-`[ ]`-item sweep — sampled (Load Builder, Job Board, Manufacturing/Cutting sections), not exhaustive over the full ~490-line file. Agent-doc file-size accuracy — sampled 6 files/claims, not exhaustive over every file mentioned in `xpanda-ops-agents.md`.

---

## Phase 7 — Build / config integrity

**Coverage:** Exhaustive on all 5 checklist items (each verified live against the actual filesystem/git index/build output, not inferred from docs alone).

### AUDIT-701 — `_routes.json` does not exist anywhere in the repo
- Category: Phase 7 — Build/config integrity
- Severity: Medium
- Owning agent: db-api-agent (legacy Pages/worker routing config)
- Evidence: `find . -iname "_routes.json" -not -path "*/node_modules/*"` from repo root returns zero hits anywhere in the tree (only unrelated Next.js-generated `routes-manifest.json` files inside `cutting-pilot/.next` and `.open-next` build output). The platform's own documented architecture (this audit's Phase 7 checklist item #1) assumes this file exists and restricts the legacy worker to `/api/*`, with static assets served free by the Pages CDN. `wrangler.toml` (root) has no `[[routes]]`/`route_include` config either — just `pages_build_output_dir = "."`.
- Failure mode / why it matters: without `_routes.json`, Cloudflare Pages Advanced Mode invokes the `_worker.js` function for **every** request, not just `/api/*` — the worker's own internal `isStaticAsset` check (confirmed present in `_worker.js/index.js`, falls through to `env.ASSETS.fetch(request)`) still serves the correct content, so this is not a correctness bug, but it means every static asset (CSS/JS/images/fonts) burns a full Worker invocation instead of being served directly by the CDN edge — the opposite of what the architecture doc claims and presumably the opposite of what was intended for cost/latency. This is either silent doc drift (the file was planned but never created) or a real, uncounted perf/cost tax that's been paying since day one.
- Proposed remediation: either (a) create `_routes.json` with `{"version":1,"include":["/api/*"],"exclude":[]}` at repo root so Pages' CDN routing takes over for everything else, or (b) if the current every-request-through-the-worker behavior is intentional/acceptable, correct `xpanda-ops-agents.md` §7's claim so it stops asserting a file that doesn't exist. Recommend (a) — it's the documented intent and a low-risk config-only change.
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-702 — Root `.gitignore` does not cover `.wrangler/`, and legacy `.wrangler/` local state (including a Cloudflare account ID + owner email) is tracked in git
- Category: Phase 7 — Build/config integrity
- Severity: Medium
- Owning agent: db-api-agent (repo hygiene, same owner as the `DB_Migrations/` gitignore rule)
- Evidence: root `.gitignore` (read directly) contains no entry for `.wrangler/`, `.next/`, `.open-next/`, `node_modules/`, or `.dev.vars` — only `DB_Migrations/`, `employee_roster.md`, a few doc/audit files, and `client_secret_*.json`. `git ls-files | grep -i wrangler` lists 20+ tracked paths under root `.wrangler/` (cache, miniflare `d3` SQLite state files, `.wrangler/tmp` bundle output). `git show HEAD:.wrangler/cache/wrangler-account.json` returns `{"account":{"id":"5ebc9a59cbb7894bea7fa29ae994fea6","name":"Scook8925@gmail.com's Account"}}` — a live Cloudflare account ID and the owner's email, committed to history. This matches the `D` (deleted-but-tracked) status seen in `git status` at session start for `.wrangler/cache/{cf,pages,wrangler-account}.json` — those files are locally deleted but git still has them tracked, confirming they are genuinely in the index, not a one-off accident. By contrast, `cutting-pilot/.gitignore` (nested, separate file) correctly ignores `.next/`, `.open-next/`, `node_modules/`, `.wrangler/`, `.dev.vars`, `*.tsbuildinfo` — confirmed 0 tracked files under any of those v2 paths. The gap is root-only.
- Failure mode / why it matters: not a credential leak on the scale of the `DB_Migrations/` incident (no passwords here), but it's the same class of mistake the repo already got burned by once — local machine/account-identifying state committed to a shared repo, and local D1/R2 dev state (miniflare SQLite files) could easily pick up snapshots of real-shaped data on a future `wrangler pages dev` run and get committed the same way. Also just repo bloat (binary/SQLite files in history).
- Proposed remediation: add `.wrangler/`, `.next/`, `.open-next/`, `node_modules/`, `.dev.vars` to the root `.gitignore` (mirroring `cutting-pilot/.gitignore`), then `git rm -r --cached .wrangler` to untrack the currently-committed copies (content stays on disk, just leaves the index — regular cleanup, not a `DB_Migrations`-style history purge, since nothing here rises to a secret).
- Migration needed: no · Effort: S · Depends on: none

### AUDIT-703 — OpenNext skew protection not enabled (confirms existing BACKLOG item, no new risk found)
- Category: Phase 7 — Build/config integrity
- Severity: Low
- Owning agent: next-platform-agent
- Evidence: `cutting-pilot/open-next.config.ts` and `cutting-pilot/wrangler.toml` contain no skew-protection configuration (grepped both for "skew" — zero hits). `BACKLOG.md` already lists "Enable OpenNext skew protection on the v2 Worker (durable fix for hashed-asset 404s across deploys)" as an open item citing the same doc link. This confirms the backlog item is accurate and still open — not a new discovery.
- Failure mode / why it matters: without it, a deploy mid-session can 404 a user's already-loaded JS chunk hash (the exact class of bug `xpanda-ops-agents.md` §9a #5 documents as a proven prior incident on this project, fixed then only by a manual CF cache purge). Low severity here only because it's already tracked and not a regression.
- Proposed remediation: no new remediation beyond what BACKLOG.md already proposes; this finding exists to formally confirm the backlog item via live config inspection.
- Migration needed: no · Effort: S · Depends on: none

**Confirmed clean / no finding (documented for completeness per the phase checklist):**
- **`wrangler.toml` (legacy) vs `cutting-pilot/wrangler.toml`**: both bind the identical D1 `database_id = "21d6f47b-0be9-4006-8014-d154e41f91e8"` and identical R2 bucket `xpanda-bol-photos` (binding `BOL_PHOTOS`). `cutting-pilot/wrangler.toml` has `compatibility_flags = ["nodejs_compat"]` (legacy has no such flag — not a mismatch, a v2-only requirement given the different compat model). Cron is `crons = ["*/10 * * * *"]`, intact, matches P408/P274 history in `BACKLOG.md`.
- **Build invocation**: confirmed live, both ways. `npx opennextjs-cloudflare build` (with the positional `build` arg) throws exactly the documented `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: Unexpected argument 'build'` on the installed CLI (`@opennextjs/cloudflare ^0.3.0`). `npm run cf-build` — `"opennextjs-cloudflare && node scripts/fix-asset-prefix.mjs && node scripts/copy-pdf-worker.mjs"` (no `build` argument, called bare) — ran clean end-to-end this session, produced `.open-next/worker.js`, log output confirmed the asset-relocation step fired. **Canonical build command: `npm run cf-build` (run from `cutting-pilot/`). Never `npx opennextjs-cloudflare build` — the positional arg breaks the installed CLI version.**
- **v2 asset/matcher integrity**: `cutting-pilot/src/middleware.ts`'s `matcher` is `["/((?!_next/static|_next/image|favicon.ico).*)"]` — unprefixed by `/v2`, which is CORRECT, not a bug: `cutting-pilot/next.config.mjs` sets `basePath: "/v2"`, and Next.js auto-prepends `/v2` to matcher patterns — adding `/v2` manually would double-prefix to `/v2/v2/...`. The Phase-7-checklist's "flag if it should be `/v2/_next/...`" concern does not apply here. `scripts/fix-asset-prefix.mjs` exists and is wired into `cf-build` (confirmed both by reading `package.json` and by its log output firing during the live build run above).
- **`_routes.json` static-asset fallthrough correctness**: even though the file doesn't exist (AUDIT-701), the worker's own `isStaticAsset` branch still serves static content correctly via `env.ASSETS.fetch(request)` — this is a cost/architecture-drift finding, not a broken-requests finding.
- **`DB_Migrations/` gitignore coverage**: still present in root `.gitignore`, confirmed by direct read — unchanged from the documented hard rule.

**Coverage:** All 5 checklist items fully verified against live filesystem/git-index/build state, not just documentation — this phase's coverage is exhaustive, not sampled (only 2 config files + 1 build command + 1 gitignore file + 1 git-index query were in scope).

---

## Proposed remediation prompt slate

Clustered into candidate one-commit fix prompts, sequenced roughly by risk and dependency. **Migration-before-push** is flagged wherever a prompt touches `DB_Migrations/*.sql` — per the platform's hard rule, such a prompt must not be pushed until Steve confirms the migration ran in the D1 console.

| # | Prompt | Owning agent | Closes | Migration? | Effort | Depends on |
|---|---|---|---|---|---|---|
| A | Replace outer catch-all's raw stack-trace body with a generic error response; remove `handleApiUsers`' redundant `validateSession()` call | db-api-agent | AUDIT-101, AUDIT-103 | No | S | none |
| B | Retire `production/inventory.html` (v1 3-tab page) + its 4 dead route handlers + permission key/nav card — executes existing BACKLOG P403 item | production-agent + db-api-agent | AUDIT-001 | No (tables already gone) | S | none |
| C | Drop two orphaned D1 tables (`load_builder_skus`, `parts_library`) after Steve confirms no residual value | db-api-agent | AUDIT-002, AUDIT-303 | **Yes — Migration-before-push** | S | Steve's manual sign-off |
| D | Standardize `activity_log.timestamp` format across legacy `logActivity()` and the 12 v2 inline-insert route files; fix `parts.updated_at`'s one-line format mismatch in `bols.js:923` | db-api-agent (legacy + `parts.js`) + next-platform-agent (v2 route files) | AUDIT-201, AUDIT-202 | No (same TEXT column; backfill optional) | S–M | none — but should land before prompt E |
| E | Re-verify which v2 API routes genuinely lack an `activity_log` insert (most already have one, inline) and close the real gaps (`/v2/api/notes` confirmed missing) | next-platform-agent | AUDIT-504 (corrected), AUDIT-203 | No | M | D (avoid touching the same insert lines twice) |
| F | Retire legacy cutting stack: drop `cutting_steps`, remove `routes/cutting.js` + `lib/cutting.js`, remove the `jobs.processes` pill-sync calls, decide fate of the archived `cutting-dashboard.html`'s own `/api/cutting` call | manufacturing-agent + db-api-agent | AUDIT-301 | **Yes — Migration-before-push** | M | none (precondition already met per AUDIT-301) |
| G | Remove `/v2/cutting`'s dormant chunk branches (`chunk-target`, `taper-yield` routes, `CHUNK_LINES` UI branches in `PartsPanel.tsx`/`CuttingBoard.tsx`) | react-component-agent + next-platform-agent | AUDIT-302 | No | S | none (can bundle with F or run standalone) |
| H | Remove orphaned `GET /api/reports/cutting-sessions` handler + its `API_ROUTES` row | reports-agent | AUDIT-304 | No | S | none (good bundle candidate with F/G) |
| I | Investigation-only: read `lib/quickbooks.js`/`lib/qb-mapper.js`/`routes/quickbooks.js` in full, check `qb_connections` row count and git history, then correct whichever `BACKLOG.md` QB section is stale | db-api-agent (+ Steve reconciliation) | AUDIT-305 | No | S (investigation) | **must run before** any QB1 prompt or the "remove dead quickbooks.js" cleanup item |
| J | logActivity coverage: add calls in QC's `scrap-log`/`completions` handlers, Production's bead/block/molding/consumption/combos handlers, and `bol-email`'s send handler | qc-agent + production-agent + logistics-agent | AUDIT-501, AUDIT-502, AUDIT-503 | No | S–M (3 small prompts, one per agent, or one bundled if Steve prefers) | coordinate with B (don't instrument the dead production handlers B is about to delete) |
| K | Docs cleanup: rewrite `ROADMAP.md` with real content (or remove it + its reference), correct `bol-generator.html` references in `AGENTS.md`/`xpanda-ops-agents.md` to describe `bol-compose.js`, remove the dead `PATH_PERMISSION_MAP` entry for it, add `manufacturing.cutting.override` to the documented permission list, refresh stale file-size figures | Orchestrator (docs-only) | AUDIT-601, AUDIT-602, AUDIT-603, AUDIT-004 | No | S | none |
| L | Build/config hygiene: add `_routes.json` restricting the legacy worker to `/api/*`; add `.wrangler/`/`.next/`/`.open-next/`/`node_modules/`/`.dev.vars` to root `.gitignore` and `git rm -r --cached .wrangler` | db-api-agent | AUDIT-701, AUDIT-702 | No | S | none |
| M | Update `BACKLOG.md`'s QuickBooks "abandoned" framing to match reality (built-but-dormant, not dead) | db-api-agent (docs) | AUDIT-505 | No | S | **after** I lands (needs the reconciliation read first) |

**Not scoped as a fix prompt (backlog/judgment calls, not one-commit-ready):**
- **AUDIT-401** (7 hand-rolled legacy modals, no shared primitive) — genuinely large (7 call sites, each its own careful pass per the "surgical changes" rule); needs a dedicated multi-prompt sequence, one page at a time, if/when Steve wants to invest in it. Flagged as the platform's next most-likely P407-class drift incident, not urgent today.
- **AUDIT-204** (bulk plaintext-password exposure in `GET /api/users`) — optional hardening, Steve's call given passwords are intentionally plaintext and the route is already admin-gated.
- **AUDIT-605** ("load-builder failsafes from the slow rollout") — needs Steve to name the specific concern before it can be scoped at all; not a code-derivable item.
- **AUDIT-606** (`Prompts/archived_prompts/` not diffed against CHANGELOG) — a coverage gap in this audit, not a confirmed defect; only worth a dedicated pass if Steve wants full historical CHANGELOG completeness confirmed.
- **AUDIT-703** (OpenNext skew protection) — already an open `BACKLOG.md` item with its own link; this audit only reconfirmed it, no new prompt needed.

**Suggested sequencing:** A, B, D, L, K can all run independently and in parallel (different files, no shared state). C and F both need Steve's migration sign-off — bundle their D1 console steps into one sitting if convenient, but keep them separate commits per the one-commit-per-prompt rule. I should run before any QB-related work (including M). E should follow D. J can run any time but coordinates loosely with B.

---

## Coverage & gaps

**Overall coverage level:** breadth-over-depth achieved across all 8 phases as instructed — every phase's checklist item was executed with either exhaustive grep sweeps + live D1 verification, or explicitly-stated sampling with a named reason. No single thread was chased past the point of characterizing it; five items are explicitly flagged **suspected — needs a dedicated pass** rather than resolved further here:

1. **AUDIT-305** — QuickBooks backlog-vs-code reconciliation (Phase 3). Needs a focused 30-minute read of 3 files + a `qb_connections` row count + git history check.
2. **Holey-board orientation constants** (Phase 2, "not independently checkable") — no baseline value exists anywhere in the repo to diff against; needs someone with the intended-value knowledge, not further code archaeology.
3. **Route-reachability** (Phase 0) — "every frontend `fetch()` call resolves to a real `API_ROUTES` entry" was only spot-checked, not exhaustively verified across ~20 HTML/TSX files.
4. **Modal-internals drift** (Phase 4, AUDIT-401) — confirmed 7 independent implementations exist structurally, but whether their *internal* behavior has already drifted from each other (not just that they're separate files) wasn't traced line-by-line.
5. **`Prompts/archived_prompts/`** (Phase 6, 225 files) — not diffed against `CHANGELOG.md`; the live/numbered `Prompts/` set (169 files) was diffed exhaustively and is clean.

**Process note on this audit's own execution:** Phases were run as parallel sub-investigations (forked agents, each scoped to one phase, each writing findings to its own scratch file for the parent to merge). One early fork briefly misunderstood its own role and had to be redirected; a few forks' final status messages referenced "the coordinator" or "other agents" reflexively even after correctly completing their own scoped work and writing valid findings. All findings in this report were independently verified against the actual repo/D1 state as described in each finding's own Evidence line — the parent session (this report's compiler) did not take any fork's summary claim on faith without the finding's cited evidence backing it up in the merged text above. Phase 2's fork additionally caught and corrected an over-broad claim in Phase 5's AUDIT-504 (see AUDIT-203) — cross-phase review worked as intended in at least that one case.

## Terminate

Audit complete. No source was edited, no migrations run, no commits made, nothing staged. This report (`PLATFORM-QC-AUDIT-P409.md`) is uncommitted at the repo root, ready for the Orchestrator/Steve to slice into the fix prompts above.

---

## Addendum — Live D1 verification (2026-08-25, via Cloudflare MCP, read-only)

Closes the "Pending D1 verification" items from this report and its second-opinion review. All queries run against database `21d6f47b-0be9-4006-8014-d154e41f91e8`.

### AUDIT-001 — CONFIRMED ✅
`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bead_stock','block_inventory','molding_log','block_consumption_log')` → **empty result**. None of the four tables exist. The High finding is fully verified end-to-end.

### AUDIT-201 — CONFIRMED ✅ (counts updated)
`SELECT SUM(timestamp LIKE '%T%'), SUM(timestamp NOT LIKE '%T%'), COUNT(*) FROM activity_log` → **5,197 ISO-Z / 638 space-format / 5,835 total**. First pass measured 5,177/636/5,813 — the table grew ~22 rows in one day and every new row is v2 space-format, confirming the finding is live and actively worsening.

### AUDIT-002 / AUDIT-303 — CONFIRMED ✅ (exact figures)
`load_builder_skus`: **125 rows** · `parts_library`: **50 rows** → **175 combined stale rows**, matching the first pass's figure exactly.

### AUDIT-003 — CONFIRMED ✅ (negative finding upheld)
Column-level check on all seven hot tables (`jobs`, `bols`, `sessions`, `parts`, `schedule_rows`, `loading_assignments`, `cutting_steps`, plus `users`/`roles`): every code-referenced column exists; no orphan columns found beyond the two already documented — `bols.location_no` and legacy `users.role` TEXT are both still present as documented in §12 of AGENTS.md.

### Orphan-table sweep — no new orphans
Full live inventory: **53 user tables** (excl. `sqlite_*`). Spot-checked the least-familiar names (`employee_birthdays`, `plant_holidays`, `shift_notes`, `bol_documents`, `hc_slots`, `cc_assignments`, `chunk_sessions`, `loading_board_notes`, `production_molding_blocks`, `production_expansion_batches`) against `_worker.js` + `cutting-pilot/src` — **all referenced somewhere in code**. The only unreferenced tables remain `load_builder_skus` and `parts_library` (AUDIT-002/303). Also noted: `cutting_steps` is still present per AUDIT-301's pending-retirement finding.

**Status change: all ⏳ pending-D1 items across this report are now closed. Zero open verification items remain.**

