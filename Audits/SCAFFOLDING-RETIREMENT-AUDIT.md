# Scaffolding Retirement Audit — Prompt-QC-Cleanup-14

- **Date:** 2026-08-29
- **Commit audited:** `68026d0` (HEAD, branch `main`)
- **Auditor:** read-only auditor role, per `Prompts/prompt-QC-Cleanup-14-VERIFY-scaffolding-retirement-audit.md`
- **Scope:** Legacy (`_worker.js`, all HTML modules) + v2 migration surface (`cutting-pilot/`)
- **Rule compliance:** read-only throughout. No source edited, no migration run, nothing committed or pushed. Live D1 checks run via the Cloudflare D1 MCP (`21d6f47b-0be9-4006-8014-d154e41f91e8`) — read-only `SELECT`s only.

## What this is

Steve's framing: "failsafes from the slow rollout that will slowly need to be removed" — transitional
scaffolding from the strangler-fig (legacy vanilla ↔ v2 React) migration and other rollouts that has
outlived its purpose. `PLATFORM-QC-AUDIT-P409.md` already found and scoped the first two instances —
**C2** (legacy `cutting_steps` + bidirectional pill-sync, its `AUDIT-301`) and **C3** (dormant
`/v2/cutting` chunk-branch logic, its `AUDIT-302`). This pass hunts for the rest, breadth-first.

## Executive summary

**6 new findings** (SCAFFOLD-001 through SCAFFOLD-006), plus **2 re-confirmations** of P409's C2/C3 and
**2 explicitly-excluded items** (pre-existing accepted debt, not this audit's target). One category from
the hunt list (load-builder rollout failsafes, Steve's specific callout) came up empty on a breadth pass
and is flagged for a dedicated follow-up rather than guessed at.

| # | Finding | Severity | Retirement-ready? |
|---|---|---|---|
| SCAFFOLD-001 | R2 blob-migration backfill (`loading_photos.photo_data`, `jobs.packing_slip_pdf`) is 100% complete — confirmed live, `remaining=0` both types | Low | **Yes — fully ready, removal SQL already drafted in a prior doc** |
| SCAFFOLD-002 | Legacy `xpanda-ops-platform.pages.dev` → canonical-host redirect (P199, ~230 prompts old) | Low | Likely yes — no internal references remain; needs Steve's external-bookmark sign-off (already tracked in `BACKLOG.md`) |
| SCAFFOLD-003 | `/training` → `/safety/training/` redirect safety net (5+ months old, undocumented in `BACKLOG.md`) | Low | Likely yes — same shape as SCAFFOLD-002, same caveat |
| SCAFFOLD-004 | Public BOL doc-type validator still accepts writes of legacy `driver_signed`/`customer_signed` though the only live caller has used `original_signed` exclusively since P313 | Low | Write-side only — read-side compat still genuinely needed (139 live legacy rows) |
| SCAFFOLD-005 | `schedule-status.ts` "rung 0" legacy-archived-sentinel shim | Informational | **No — precondition unmet**, 118 rows still need it |
| SCAFFOLD-006 | Orphaned handler-comment header in `admin.js` for a function that actually lives in `index.js` | Trivial | Yes, bundle with SCAFFOLD-001 |
| — | C2 re-confirmed (`cutting_steps` + pill-sync) | Medium | Yes (per P409, unchanged) |
| — | C3 re-confirmed (`/v2/cutting` dormant chunk branches) | Low | Yes (per P409, unchanged) |

**Top finding:** SCAFFOLD-001 is the cleanest hit in this pass — a prior agent (`r2-migration-inventory.md`,
2026-06-03) already wrote the exact `ALTER TABLE ... DROP COLUMN` statements and gated them on
"only after `remaining=0`." Live D1 confirms both migrations (`loading-photos`, `packing-slips`) now read
`remaining=0`. This is about as close to a pre-packaged retirement prompt as this hunt produces.

---

## Findings

### SCAFFOLD-001 — R2 base64-blob migration is fully complete; backfill endpoint + dead columns + one dead fallback branch are all retirement-ready
- **Category:** One-time migration backfill left wired (hunt item 4) + defensive guard for a now-impossible state (hunt item 3)
- **Severity:** Low (no risk today — dead weight, not a live bug)
- **Owning agent:** db-api-agent (worker) + logistics-agent (loading dock photo viewer)
- **Evidence:**
  - `r2-migration-inventory.md` (repo root, dated 2026-06-03) is the original F4c/F4d migration plan. It explicitly documents both migrations as **Completed** (P97 for `loading_photos.photo_data`, P98 for `jobs.packing_slip_pdf`) and pre-writes the post-migration cleanup SQL: `ALTER TABLE loading_photos DROP COLUMN photo_data;` / `ALTER TABLE jobs DROP COLUMN packing_slip_pdf;`, gated on "Only after `POST /api/admin/r2-backfill?type=...` returns `remaining=0`."
  - Live D1 query this session: `loading_photos_remaining=0` (of 175 total rows), `packing_slips_remaining=0` (of 336 jobs) — both migrations are verifiably complete right now.
  - `_worker.js/index.js:341-436` (`handleApiAdminR2Backfill`) is the admin-only (`X-User-Is-Admin`) backfill endpoint itself, wired at `index.js:94` (`POST /api/admin/r2-backfill`). For `type=loading-photos` specifically, the live write path (`_worker.js/routes/loading.js:620-664`, `handleApiLoadingPhotos` POST) uploads to R2 **first** and only inserts the D1 row on success (`photo_data` stored as `''` sentinel) — on R2 failure it now hard-fails the request (`500 photo_upload_failed`) rather than falling back to a D1 base64 write. That means **no new row can ever populate `photo_data` again** — the `type=loading-photos` backfill can never again find work, and the read-side "Legacy base64 fallback for un-backfilled rows" branch (`_worker.js/routes/loading.js:578-583`, `if (row.photo_data && row.photo_data.length > 10) { ... }`) is now provably dead code — this is the hunt-item-3 archetype (guard for a state that can no longer occur).
  - By contrast, `jobs.packing_slip_pdf`'s write path (`_worker.js/routes/jobs.js:443-457, 748-770`) **deliberately keeps** a base64-in-D1 fallback on R2 upload failure ("keep base64 in D1 so the slip isn't lost") — that one is intentional ongoing resilience, not scaffolding, and its read-side fallback (`jobs.js:87-101`) is still genuinely reachable. Only the `type=packing-slips` **backfill call itself** is currently idle (0 remaining), not the underlying fallback design.
  - `_worker.js/routes/admin.js:328-333` has an orphaned comment header (`// HANDLER: /api/admin/r2-backfill (POST — admin only) ...`) with no function body following it — the real handler was apparently moved to `index.js` at some point, leaving a stray doc marker behind in the file that reads like the module boundary.
- **Why it's now retirement-ready:** Both stated preconditions ("remaining=0" for each type) are met, live, today. The removal shape was already fully specified by a previous agent 3 months ago and just never executed.
- **Proposed removal shape:**
  1. Steve runs the two `ALTER TABLE ... DROP COLUMN` statements already sitting in `r2-migration-inventory.md` in the D1 console (after his own spot-check that photos/slips render correctly).
  2. Once both columns are gone, delete `handleApiAdminR2Backfill` (`index.js:341-436`) and its `API_ROUTES` row (`index.js:94`).
  3. Delete the dead "Legacy base64 fallback" branch in `loading.js:578-583` (do this regardless of the column drop timing, since it's independently proven dead now).
  4. Leave `jobs.js`'s packing-slip R2-failure fallback and its read-side branch alone — that one is live design, not scaffolding — **unless** Steve also wants to drop `jobs.packing_slip_pdf` outright, in which case that fallback needs its own separate design conversation (it currently protects against R2 write failures for packing slips; dropping the column removes that safety net entirely).
  5. Clean up the orphaned comment header in `admin.js:328-333`.
- **Migration?** Yes — `DROP COLUMN` × 2, Migration-before-push HARD RULE applies. **Effort:** S. **Depends on:** Steve's manual sign-off + a quick visual spot-check that a sample of already-migrated photos/slips still render via their R2 keys before dropping columns.

### SCAFFOLD-002 — Temporary `pages.dev` → canonical-host redirect, ~230 prompts old, no internal references remain
- **Category:** Feature-flag-ish / soft-rollout guard now always-on (hunt item 5) — a domain-cutover safety net, not strictly strangler-fig, but same "slow rollout residue" shape Steve described
- **Severity:** Low
- **Owning agent:** db-api-agent (routing) / Orchestrator (external-facing risk judgment)
- **Evidence:**
  - `_worker.js/index.js:148-155`:
    ```js
    // TEMPORARY host redirect: old Pages domain → canonical domain.
    // 302 (NOT 301) so it is not hard-cached and can be cleanly removed.
    // REMOVE this block once all internal links/bookmarks point at the canonical host.
    if (url.hostname === "xpanda-ops-platform.pages.dev") {
      const CANONICAL_ORIGIN = "https://www.xpandaops.com";
      return Response.redirect(CANONICAL_ORIGIN + url.pathname + url.search, 302);
    }
    ```
  - `CHANGELOG.md:2995` dates this to **P199** — commit `c9c850f`. Current HEAD is past P421; this has sat for 200+ prompts.
  - `BACKLOG.md:383` already carries the exact tracked item: "Remove temporary `pages.dev` → `xpandaops.com` redirect from `_worker.js/index.js` once all internal links/bookmarks confirmed updated."
  - Repo-wide grep for the `pages.dev` hostname (outside this redirect block and `.wrangler/` build artifacts) found no internal code reference to it — nothing in the codebase itself still links there.
  - `SIGNOUT-INVESTIGATION-P404.md` §4 independently confirms live: `wrangler pages project list` shows the legacy Pages project's only bound domains are `xpanda-ops-platform.pages.dev` and `www.xpandaops.com` — the old domain is still live and reachable, so the redirect isn't inert, it's actively still firing for whoever still hits it (browser bookmarks, old external links, etc.).
- **Why it's flagged (not yet "confirmed remove"):** Can't verify external bookmark/link usage from the repo alone — that's exactly the condition the code comment and the `BACKLOG.md` item both already name as the blocker. This finding doesn't change the situation; it just re-confirms the item is still open and accurate.
- **Proposed removal shape:** Steve's call on external-link risk (this is explicitly *his* threshold to clear, per the code comment itself) — once he's comfortable, delete `index.js:148-155`. No migration, no dependent code.
- **Migration?** No. **Effort:** S. **Depends on:** Steve confirming external bookmarks/links are updated (already the exact ask in `BACKLOG.md`).

### SCAFFOLD-003 — `/training` → `/safety/training/` redirect safety net, 5+ months old, undocumented in `BACKLOG.md`
- **Category:** Same shape as SCAFFOLD-002 — soft-rollout guard now always-on
- **Severity:** Low
- **Owning agent:** safety-agent (destination page) / db-api-agent (routing)
- **Evidence:**
  - `_worker.js/index.js:138-141`:
    ```js
    // 🔥 Training redirect safety net
    if (url.pathname === "/training" || url.pathname === "/training/") {
      return Response.redirect(`${url.origin}/safety/training/`, 301);
    }
    ```
  - Commit `b8993be`, dated **2026-03-17** ("Fix worker + add training redirect safety net") — over 5 months old at time of audit.
  - Repo-wide grep for `href="/training"` (or bare `/training` path references) outside this one redirect block found **zero** hits — every current internal link already points at `/safety/training/`.
  - Unlike SCAFFOLD-002, this one is **not** in `BACKLOG.md` at all — a genuine undocumented loose end, distinct from the pages.dev item which at least has a tracked ticket.
- **Why it's flagged:** Same caveat as SCAFFOLD-002 — can't rule out external bookmarks (e.g. a printed floor poster with the old URL), but it's a 301 (permanent, cacheable) rather than the 302 used for the domain redirect, which is a slightly stronger signal this one was meant to be short-lived and forgotten rather than deliberately left soft.
- **Proposed removal shape:** Add to `BACKLOG.md` at minimum so it's tracked like SCAFFOLD-002; remove once Steve confirms no printed/bookmarked references to the bare `/training` path remain.
- **Migration?** No. **Effort:** S. **Depends on:** Steve's sign-off (same external-reference caveat).

### SCAFFOLD-004 — Public BOL delivery endpoint's doc-type validator still accepts writes of two doc types no live caller produces
- **Category:** Defensive guard for a state that no live code path produces anymore (hunt item 3) — narrow
- **Severity:** Low
- **Owning agent:** logistics-agent
- **Evidence:**
  - `_worker.js/routes/public.js:144-147`:
    ```js
    const docType = String(payload.doc_type || '');
    if (!['original_signed', 'driver_signed', 'customer_signed'].includes(docType)) {
      return json({ ok: false, error: 'doc_type must be original_signed|driver_signed|customer_signed' }, 400);
    }
    ```
  - `CHANGELOG.md:1892-1903` (P313 entry): the driver/customer double-signed-copy flow was deliberately collapsed to a single `original_signed` capture — "the delivery-submit flow calls `uploadSignedCopy('original')` once instead of the old driver-then-customer double upload." The `driver_signed`/`customer_signed` values were kept accepted "for backward compatibility — no data migrated/deleted."
  - Grep for `uploadSignedCopy(` finds exactly one call site, `track/index.html:340`, hardcoded to `uploadSignedCopy('original')`. No other caller of this endpoint exists in the repo.
  - Live D1: `bol_documents` still holds 70 `driver_signed` + 69 `customer_signed` rows (139 total) alongside 55 `original_signed` — **these are real historical records still actively read** by the dashboard's `pickSignedDoc()` fallback (`logistics/index.html`), so the **read-side** compat is genuinely still load-bearing and must NOT be touched.
- **Why it's flagged:** Only the **write-side acceptance** of the two legacy values is now provably unreachable in practice (no caller sends them) — narrower than a typical "retire this" finding, since the read side stays.
- **Proposed removal shape:** Optional, low-value hardening: narrow the validator to accept `original_signed` only (reject `driver_signed`/`customer_signed` on new writes), while leaving `pickSignedDoc()`'s read-side handling of all three values untouched forever (139 historical rows aren't going away). Low priority — not causing any active problem, just slightly wider input surface than necessary.
- **Migration?** No. **Effort:** S. **Depends on:** none — but genuinely optional; flagging for completeness more than urgency.

### SCAFFOLD-005 — `schedule-status.ts` "rung 0" legacy-archived-sentinel shim: self-documented, checked, NOT yet retirement-ready
- **Category:** Defensive guard for a (not yet) impossible state (hunt item 3) — included as a negative/informational finding, not a remove-now candidate
- **Severity:** Informational
- **Owning agent:** next-platform-agent
- **Evidence:**
  - `cutting-pilot/src/lib/schedule-status.ts:38-58` carries an unusually thorough self-documenting docblock explaining that "rung 0" (`jobs.status === "archived"` → `Shipped`) is "a legacy compatibility shim, not a general design rule," needed only for "the finite, shrinking population of rows already archived before the [archived_at] refactor."
  - Live D1 query this session: `SELECT COUNT(*) FROM jobs WHERE status = 'archived'` → **118 rows**, confirming the shim is still actively load-bearing today.
- **Why it's flagged despite not being removal-ready:** This is exactly the hunt-item-3 archetype (a guard for a state the migration was supposed to make impossible) — but it's the one instance found this pass where the precondition genuinely isn't met yet, so it's the right kind of thing to log as "checked, correctly still present" rather than silently skip. Worth revisiting once/if those 118 rows are ever backfilled to real status values (a data-correction project, not a code change) — until then this shim stays.
- **Proposed removal shape:** None now. If Steve ever wants to accelerate retirement, the path is a one-time data-correction pass on the 118 rows (assign them their best-guess real lifecycle status) followed by deleting rung 0 — that's a data project, not a code cleanup, and out of scope for a fix prompt on its own.
- **Migration?** N/A (would be a data backfill, not schema). **Effort:** N/A. **Depends on:** Steve's appetite for a historical-data correction project.

### SCAFFOLD-006 — Orphaned handler-comment header in `admin.js`
- **Category:** Dormant/doc-drift, trivial
- **Severity:** Trivial
- **Owning agent:** db-api-agent
- **Evidence:** `_worker.js/routes/admin.js:328-333` — a full comment block header (`// HANDLER: /api/admin/r2-backfill (POST — admin only) ...`) sits at the end of the file with no function definition following it. The actual `handleApiAdminR2Backfill` function lives in `index.js:341-436` instead.
- **Why it's flagged:** Minor, but exactly the kind of thing that misleads a future agent grepping `admin.js` for this handler and not finding it, or worse, adding a second implementation there.
- **Proposed removal shape:** Delete the stray comment block, or (if `handleApiAdminR2Backfill` is ever formally relocated into `admin.js` for consistency with the rest of the file) move the real function there and delete it from `index.js` instead. Bundle with SCAFFOLD-001.
- **Migration?** No. **Effort:** Trivial. **Depends on:** none.

---

## Re-confirmed from P409 (not re-litigated in depth — evidence spot-checked live this session)

### C2 — Legacy `cutting_steps` + bidirectional pill-sync (P409's `AUDIT-301`)
Spot-checked this session: `_worker.js/routes/jobs.js:871-880` still runs `reconcileCuttingSteps` /
`mirrorProcessesToSteps` / `syncJobFromSteps` on every job PUT that touches `processes`, unchanged since
P409. Live D1: `cutting_steps` still holds 361 rows. No new evidence changes P409's assessment —
still retirement-ready per the precondition P409 already confirmed met (v2 cutting reached the floor,
archived page has zero nav links). See P409's finding for full evidence and its proposed removal prompt (slate item **F**).

### C3 — `/v2/cutting`'s dormant chunk branches (P409's `AUDIT-302`)
Spot-checked this session: `cutting-pilot/src/app/api/cutting/{queue,clock-in,complete-line}/route.ts`
all still carry the identical `// Chunk branches below (CHUNK_LINES, taper Cross Cutter derivation) are
left dormant on purpose.` comment and the `PROCESS_ORDER = ["Main Line", "Blue Line"]` constant that makes
`line === "Cross Cutter"` permanently unreachable on this board. Unchanged since P409. See P409's finding
(slate item **G**).

---

## Explicitly excluded from this hunt (pre-existing accepted debt, not "retirement-ready scaffolding")

- **`bols.location_no`** and **legacy `users.role` TEXT column** — both are named directly in
  `AGENTS.md` §12 / `xpanda-ops-agents.md`'s "Known Technical Debt" as columns *deliberately* kept for
  backward compatibility, with an explicit instruction that agents must not "fix" these without being
  asked. That's a different posture than the strangler-migration scaffolding this prompt targets — these
  are permanent-until-Steve-decides-otherwise compatibility columns, not leftover rollout residue with a
  met precondition. Not re-flagged here; including them would just restate what `AGENTS.md` already says.

## Context noted, not a finding: `/v2/board` cutover is NOT yet retirement-ready (opposite direction)

`BACKLOG.md:143-150` — the Orders/Production-board v2 rework (P337-P344) is built and reachable by direct
URL, but the P344 cutover was reverted same-day; home page (`index.html:360`) and both nav bars still
point `Job Board` at legacy `/jobs/`. This is the **inverse** of what this audit hunts (a v2 module not
yet cut over, not a legacy module whose v2 replacement has already landed) — flagged here only so it
isn't mistaken for a gap in this audit's coverage. Confirmed via direct read of `index.html` and
`BACKLOG.md`; matches the "v2 visibility gate HARD RULE" in `xpanda-ops-agents.md` §Cross-Cutting Rules.

---

## Proposed retirement prompt slate

| # | Prompt | Owning agent | Closes | Migration? | Effort | Depends on |
|---|---|---|---|---|---|---|
| N1 | Drop `loading_photos.photo_data` + `jobs.packing_slip_pdf` D1 columns (SQL already drafted in `r2-migration-inventory.md`); remove `handleApiAdminR2Backfill` + its `API_ROUTES` row; delete the dead legacy-base64-fallback read branch in `loading.js:578-583`; clean up the orphaned comment header in `admin.js:328-333` | db-api-agent + logistics-agent | SCAFFOLD-001, SCAFFOLD-006 | **Yes — Migration-before-push** (2× `DROP COLUMN`) | S | Steve's spot-check that R2-backed photos/slips still render before dropping columns |
| N2 | Remove the `pages.dev` temporary host redirect (`index.js:148-155`) once Steve confirms no live external bookmarks/links remain | db-api-agent | SCAFFOLD-002 | No | S | Steve's external-link sign-off (already the exact ask in `BACKLOG.md:383`) |
| N3 | Remove (or, if Steve wants a longer grace period, at least add to `BACKLOG.md`) the `/training` redirect safety net | db-api-agent | SCAFFOLD-003 | No | S | Steve's sign-off on external/printed references |
| N4 | Narrow the public BOL doc-type validator (`public.js:144-147`) to reject new `driver_signed`/`customer_signed` writes while leaving all read-side handling of historical rows untouched | logistics-agent | SCAFFOLD-004 | No | S | none — genuinely optional, low priority |
| — | (Already slated by P409, unchanged) Retire `cutting_steps` + `/api/cutting*` + `routes/cutting.js` + `lib/cutting.js` + pill-sync calls | manufacturing-agent + db-api-agent | C2 / AUDIT-301 | Yes | M | P409 slate item F |
| — | (Already slated by P409, unchanged) Remove `/v2/cutting`'s dormant chunk branches | react-component-agent + next-platform-agent | C3 / AUDIT-302 | No | S | P409 slate item G |

**Suggested sequencing:** N1, N2, N3, N4 can all run independently and in parallel — different files, no
shared state, no cross-dependencies on each other. N1 is the only one with a migration, so it alone needs
the Migration-before-push discipline. N2/N3 both hinge purely on Steve's judgment call about external
references, not on any code investigation this audit could do further. Bundle N1's trivial doc-drift
cleanup (SCAFFOLD-006) into the same commit rather than a separate prompt.

---

## Coverage & gaps

**Hunt-list coverage:**

1. **Legacy↔v2 bridges / dual-paths** — covered by re-confirming C2 (the only live instance of this
   specific shape found; P409's Phase 4 already swept for `hasPermission`/cookie-parse drift and found
   none). No new bidirectional-sync instance found beyond the already-known cutting pill-sync.
2. **Dormant "pending cleanup" code** — grepped the full comment-marker list (`dormant`, `pending
   cleanup`, `left intact`, `legacy fallback`, `TODO remove`, `once v2`, `after rollout`, plus a wider
   synonym sweep: `backward compat`, `kept for`, `shim`, `bridge`, `dual-write`, `MIGRATION COMPLETE`,
   `failsafe`, `soft rollout`, `feature flag`). Hits were C2/C3 (already known) plus SCAFFOLD-004's
   `driver_signed`/`customer_signed` backward-compat note. **Exhaustive on the marker-grep approach**;
   not exhaustive against unmarked/uncommented scaffolding that never got a code comment calling it out.
3. **Defensive guards for now-impossible states** — found one confirmed-dead instance (SCAFFOLD-001's
   `loading.js` base64 fallback), one confirmed-still-needed instance logged for completeness
   (SCAFFOLD-005), and one narrow write-side-only instance (SCAFFOLD-004). **Sampled**, not exhaustive —
   this category requires tracing individual write paths to their read-side guards one at a time; only
   the ones surfaced by the marker-grep sweep or already flagged elsewhere (P404, P409, `BACKLOG.md`)
   were traced to ground truth via live D1 queries.
4. **One-time migration backfills run repeatedly or left wired** — the R2 backfill (`index.js`
   `loading-photos`/`packing-slips`) named directly in the prompt was traced end-to-end and confirmed
   complete (SCAFFOLD-001). No other backfill-shaped endpoint was found in a grep for `backfill` across
   both codebases beyond this one and the already-tracked `handleHoleyChunksBackfill`
   (`/api/holey-chunks/backfill`) — that one is a P409-noted acceptable-design admin-triggered utility,
   not itself flagged as scaffolding in P409 or here (not a migration-completion artifact — it's a
   general recompute tool, out of this hunt's shape). **Exhaustive for the named target; sampled for
   "any other similarly-shaped backfill."**
5. **Feature-flag-ish / soft-rollout guards** — grepped for `env.[A-Z_]+` conditionals, `ENABLE_`,
   `FEATURE_`, `ROLLOUT_` patterns across `_worker.js` — found only `QB_SANDBOX` (a legitimate env
   config toggle, not rollout scaffolding) and a `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` presence check
   (config-gating, not rollout scaffolding). The two URL-redirect safety nets (SCAFFOLD-002,
   SCAFFOLD-003) are the closest fit to this category's spirit even though they're host/path redirects
   rather than literal flags. **Sampled** — did not do a per-commit archaeology of every past "soft
   rollout" mentioned in `CHANGELOG.md` (e.g., the P290/P291 priority-sort disable/restore pair and the
   P261 cron-interval temporary drop were both checked via `git log` and confirmed already fully
   reverted/resolved — not open scaffolding).
6. **Load-builder rollout failsafes (Steve's specific callout)** — **NOT YET RUN to completion.**
   Grepped `logistics/load-builder.html` (159KB) for failsafe/rollout/legacy/deprecated language and
   found only one hit: the `state.skuError` → "LOCAL FALLBACK" vs. "CLOUD SAVED" UI toggle
   (`load-builder.html:1641`, `loadSaved()` at `:527`), which reads as intentional live-network
   resilience (what to show when `/api/load-builder-skus` is unreachable right now) rather than
   migration-era rollout scaffolding — there's no evidence it's tied to a completed precondition the way
   the other findings are. This matches P409's own `AUDIT-605` conclusion verbatim: no `BACKLOG.md` item,
   no `CHANGELOG.md` mention of a load-builder "failsafe"/"rollout" cluster exists to scope against.
   **Recommend asking Steve directly what specific guard(s) he has in mind** before spending a full
   line-by-line pass on this 159KB file — a keyword sweep alone is not enough coverage to either confirm
   or rule out something Steve is recalling from memory rather than from a code comment. Marking this
   sub-item **NOT YET RUN** rather than guessing.

**General gaps (breadth-over-depth, by design):**
- D1 verification was targeted at the specific tables/columns named in each finding above (R2 blob
  columns, `cutting_steps`, `jobs.status='archived'`, `bol_documents.doc_type`) — not a full re-run of
  P409's Phase 0 orphan-table sweep (that sweep is recent, Aug 25, and already exhaustive; re-running it
  4 days later was judged low-value).
- No exhaustive line-by-line read of any single large file (`load-builder.html`, `block-calculator.html`,
  `jobs/index.html`) was performed — all findings above came from targeted grep + comment-driven leads +
  live D1 cross-checks, consistent with the prompt's explicit breadth-over-depth instruction.
- `cutting-pilot/src/app/**` (49 route/page files) was not re-swept beyond the cutting-specific files
  already covered by C2/C3 and the `schedule-status.ts` read for SCAFFOLD-005 — a full per-module sweep
  of `orders`, `carrier`, `loading`, `production`, `notes`, `board`, `blocks` v2 modules for their own
  possible rollout guards was not attempted this pass (none of those modules are named in P409's
  Known-Technical-Debt lists as migration-scaffolding candidates, and no marker-grep hit surfaced
  anything there).

**Terminate:** Report complete. No source changes made. Nothing staged, committed, or pushed.
