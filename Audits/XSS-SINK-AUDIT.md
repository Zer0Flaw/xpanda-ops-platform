# XSS Sink Audit — xPanda Ops Platform

- **Date:** 2026-08-29
- **Mode:** read-only sink-by-sink verification. Closes RT-04 ("suspected — needs dedicated sink audit") from `PLATFORM-REDTEAM-AUDIT-P409.md`.
- **Scope:** every `innerHTML =`, `insertAdjacentHTML(...)`, `.html(...)`, and `document.write(...)` sink across the legacy static HTML/JS surface, module by module: Job Board, Reports (gviz-fed), Logistics, Production/Manufacturing. Full multi-line template literals were read in full for every sink actually reviewed (not grepped in isolation), per the prompt's method.
- **Method note:** this audit was split across four parallel sub-passes (one per module) due to session-size constraints; findings below are consolidated and re-numbered into one sequence (XSS-001 through XSS-010).

---

## Exec Summary

- **Sinks reviewed:** ~155+ `innerHTML`/`insertAdjacentHTML`/`.html()`/`document.write` call sites across 16 files spanning four modules.
- **UNSAFE findings: 9** (XSS-001 through XSS-009), plus **1 latent finding** (XSS-010 — currently non-exploitable due to a separate bug, but a "masked High" the moment that bug is naively fixed).
- **Severity breakdown:** 5 High, 4 Med, 1 Latent-High-if-fixed-naively.
- **Top risks — externally-reachable (uploaded-document-sourced), not requiring an internal account:**
  - **XSS-006** (`logistics/load-builder.html`) and **XSS-007** (same file) — both rooted in the same unsanitized pipeline: a crafted packing-slip PDF's line-item description or invoice-number token, parsed client-side by `jobs/packing-slip-parser.js` with zero HTML sanitization, stored via `.trim()`-only server writes, later rendered unescaped into a `document.write()`'d print window and an `innerHTML`-injected PDF-export node. This is the single most dangerous pattern found: **a malicious external document becomes stored, cross-user XSS with no internal account required to plant it** — only to open the resulting job in the Load Builder and print/export it.
  - **XSS-001** (`jobs/index.html`, archive toast) and **XSS-002** (same file, archive button `onclick`) — same root field (`job.customer`, auto-filled from a packing-slip PDF's Ship-To company name), two different sinks, one direct `innerHTML` injection and one single-quote `onclick`-attribute breakout (`esc()` doesn't encode `'`).
  - **XSS-008** (`reports/incidents/summary.html`) — `customerBreakdown[].customer` is raw, unescaped Google-Sheets (gviz) text; anyone with edit access to that Sheet — a wider population than platform admins — can inject a payload that executes in any viewer's browser (including admins').
- **Systemic pattern found twice, independently, in two different modules:** an `esc()` helper that encodes `& < > "` but **not `'`** is used to build a single-quoted inline `onclick="...('${esc(x)}')"` JS-string argument — the escaping call is present, but insufficient for that specific context, so it looks safe on a quick read and isn't. Found in `jobs/index.html` (XSS-002, XSS-003). Checked for specifically across Logistics and Production/Manufacturing — **not found there**; every single-quoted `onclick` interpolation in those two modules carries a DB-generated id, never free text.
- **Overall discipline is good.** The large majority of sinks reviewed are SAFE (consistent `esc()`/`escapeHtml()`/`escAttr()` use) or INERT (server-validated enums, DB ids, static strings). Every finding here is a specific, narrow miss — a field the author forgot to wrap, not a systemic absence of escaping. `logistics/loading.html` (two-helper `esc()`/`escAttr()` pattern) and `logistics/index.html` had **zero** findings each.
- **One functional bug found that is also a latent security landmine (XSS-010):** `reports/incidents/list.html` calls an `escapeHtml()` function that is not defined anywhere reachable by the page — the page currently crashes on every render with data (`ReferenceError`, caught, shown as "Unable to load incidents"), so no unescaped gviz text ever reaches the DOM today. But if anyone "fixes" the crash by deleting the `escapeHtml()` calls or stubbing it as a no-op, this instantly becomes a High-severity gviz-sourced stored/reflected XSS across four fields.

---

## Findings

### XSS-001 — `jobs/index.html:1256` — direct unescaped interpolation (High)
**Sink:** `toast.innerHTML = `<span style="color:#34d399;">✓</span><span>${customerName} archived</span>`` (`showArchiveToast`).
**Data source:** `job.customer`, auto-filled at `jobs/index.html:1988` (`set('f-customer', data.ship_to.company)`) from an uploaded packing-slip PDF's Ship-To company field (`jobs/packing-slip-parser.js`'s `parseShipTo()`), saved to D1 with no server-side sanitization, later passed to `archiveJob(jobId, customerName)` → `showArchiveToast(customerName)`.
**Severity:** High — payload originates in an externally-supplied PDF and executes in the browser of whichever internal user clicks Archive on that job.
**Fix:** `${esc(customerName)} archived`. **Effort:** S.

### XSS-002 — `jobs/index.html:1188` — `esc()` insufficient for single-quoted inline-JS attribute context (High)
**Sink:** `onclick="event.stopPropagation();archiveJob('${esc(job.id)}','${esc(job.customer)}')"` inside the kanban card's Archive button.
**Mechanism:** `esc()` encodes `& < > "` but not `'`. A customer name containing a single quote (e.g. `x','y');alert(document.cookie);//`) breaks out of the intended call and injects arbitrary JS — no successful round-trip required, fires the instant the button is clicked.
**Data source:** Same as XSS-001 — `job.customer`, PDF-reachable via `data.ship_to.company`.
**Severity:** High. **Fix:** Move to `addEventListener`-based wiring (as already done correctly elsewhere in this file, e.g. lines 2783, 3131, 3172) instead of building the handler as a single-quoted string — escaping harder inside `esc()` isn't the right fix for this class of bug. **Effort:** M.

### XSS-003 — `jobs/index.html:1125` — same apostrophe-breakout mechanism, process-pill field (Med)
**Sink:** `onclick="event.stopPropagation();toggleProcessPill('${esc(job.id)}','${esc(p.name)}')"` in the kanban card's process pills.
**Data source:** `job.processes[].name`, stored as a raw JSON blob with no per-item shape/whitelist validation on write (`_worker.js/routes/jobs.js:435,739`). Not reachable through the normal UI or the packing-slip PDF (the UI only ever sends fixed checkbox-driven names) — requires an authenticated caller hitting `PUT /api/jobs` directly.
**Severity:** Med — same-origin/authenticated-write required, but genuine stored XSS between internal users once written; trigger is just opening the board and clicking the pill.
**Fix:** Same as XSS-002 (event-listener wiring), and/or validate `processes[].name` server-side against the known process list. **Effort:** M.

### XSS-004 — `production/bead-inventory.html:1112` (Med)
**Sink:** `renderManageTypes()` — `${[t.grade, t.color].filter(Boolean).join(" · ")}` with no `esc()`, unlike every other field in the same file (e.g. `t.name` two lines above).
**Data source:** Free-text Manage-modal form fields, `.trim()`-only on write (`handleApiBeadTypes` in `_worker.js/routes/production.js`), no HTML stripping, no allow-list.
**Severity:** Med (same-origin-authored by an internal user; executes in any other viewer's session — chains with the account-takeover surface in QC Cleanup-10).
**Fix:** `${esc(t.grade)}` / `${esc(t.color)}`. **Effort:** Trivial.

### XSS-005 — `manufacturing/block-calculator.html:1191-1198` (Med)
**Sink:** `breakdown = calc.secondaries.filter(...).map(s => `${s.totalPieces} ${s.label}`).join(' + ')`, embedded unescaped into `$statGrid.innerHTML`. `esc(sec.label)` *is* correctly called two other places in the same file (1183, 1271) — this is an isolated miss.
**Data source:** Free-text "Label (optional)" input per Secondary Part card, persisted in saved "combos" (`secondary_parts_snapshot[].label`) via `/api/combos` (stored/returned verbatim, no sanitization) — loading a saved combo re-renders another user's planted label, so this is genuine stored/cross-user XSS, not self-XSS.
**Severity:** Med. **Fix:** `.map(s => `${s.totalPieces} ${esc(s.label)}`)`. **Effort:** Trivial.

### XSS-006 — `logistics/load-builder.html:1164,1167-1168` (sinks at 1175, 1183) (High)
**Sink:** `buildLoadingDiagramInnerHtml()` builds HTML embedding `item.name` (SKU name, unescaped) and `trailerType`/`invNumber` fields; the combined string is used two ways: `printPackingSlip()` → `win.document.write(...)` (direct injection into a new browser window), and `buildLoadingDiagramPdfBytes()` → `host.innerHTML = innerHtml` on a DOM node appended to `document.body` before PDF rasterization.
**Data source, traced end-to-end:** `item.name` comes from `createPartOnTheFly()`, set to `lineItem.description || partNumber` when a job is pulled into the Load Builder. `job.line_items[].description` is extracted from the packing-slip PDF's raw text by `jobs/packing-slip-parser.js`'s `parseLineItems()` with **no HTML sanitization**; the server (`handleApiParts` POST in `production.js`) only `.trim()`s and stores it verbatim. `invNumber` is independently exploitable via a free-text "BOL / INV #" input. (`trailerNumber`/`trailerType` were traced and confirmed INERT — numeric index / enum, despite the misleading parameter name.)
**Severity:** High — externally-reachable stored XSS: entry point is an uploaded document, not an internal form field, confirmed unsanitized at every hop (parse → API write → API read → render); the `document.write()` sink executes injected `<script>` immediately.
**Fix:** Wrap `item.name`, `trailerType`, and `invNumber`/`invSuffix` in the file's existing `esc()` helper throughout `buildLoadingDiagramInnerHtml()`/`printPackingSlip()`. Consider defense-in-depth sanitization at PDF-parse time or on the `/api/parts` write path (separate, larger change, out of scope here). **Effort:** Trivial for the immediate fix.

### XSS-007 — `logistics/load-builder.html:2773` (High)
**Sink:** `showJobBanner()` → `banner.innerHTML` embeds `job.customer` and `invNum` (`job.invoice_number || job.packing_slip_invoice`) unescaped. Contrast: the near-identical "Pull from Job" picker list two thousand lines away renders the same `job.customer` safely via `textContent` — this is the one spot that used `innerHTML` instead.
**Data source, traced end-to-end:** `job.customer` is internal-staff-entered (not packing-slip-derived). `invNum`, however, **is** — `packing-slip-parser.js` extracts `invoice_number` directly from the PDF via regex (`INVOICE\s*#\s*(\S+)`) with no sanitization; the `\S+` pattern excludes whitespace but not `<`,`>`,`"`,`'`, so a no-space HTML/JS payload in the invoice-number token survives parsing and the server's `.trim()`-only write.
**Severity:** High — reclassified up from an initial Med once `invNum`'s data source was traced; this is the same externally-reachable pattern as XSS-006, in the same file, via a second independent field.
**Fix:** `${esc(job.customer) || '(no customer)'}` and `` ` | INV# ${esc(invNum)}` ``, matching the `esc()` already defined and used elsewhere in the file. **Effort:** Trivial.

### XSS-008 — `reports/incidents/summary.html:244-251` (High)
**Sink:** `renderCustomerTable()` — `table.innerHTML += `<tr><td>${row.customer}</td><td>${num(row.count)}</td></tr>``, no escaping.
**Data source:** `data.customerBreakdown[].customer`, built server-side in `handleIncidentSummary` (`_worker.js/routes/reports.js`) as `customerCounts[incident.customer || "Unspecified"]++`, where `incident.customer` is raw, unrestricted text pulled straight from the gviz-fed Google Sheet's Customer column — zero server-side escaping anywhere in the fetch/parse chain (`fetchIncidentData()`/`parseIncidentRows()`).
**Severity:** High — anyone with edit access to that Sheet (a wider population than platform admins) can inject a payload that executes in the browser of any user who loads this report page.
**Fix:** Wrap in `esc(row.customer)`, consistent with the sibling `type.html`'s enum-field handling. **Effort:** S.

### XSS-009 — `reports/orders/index.html:212` (Med)
**Sink:** `${j.ship_date ? formatDate(j.ship_date) : '—'}` inside `renderTable()`'s `wrap.innerHTML`; `formatDate()` returns the raw input unescaped on both its malformed-input branch and (partially) its normal-parse branch.
**Data source:** `jobs.ship_date`. Validated as `^\d{4}-\d{2}-\d{2}$` on job **creation** (`_worker.js/routes/jobs.js:388-390`), but the `PATCH /api/jobs/:id` update path treats it as a generic `textFields` member with **no format validation** — an internal user with job-edit access can set it to arbitrary text, bypassing the creation-time regex, and have it render unescaped.
**Severity:** Med — same-origin-authored (requires internal job-edit rights, not gviz), but produces unescaped stored XSS rendered to any user (including admins) browsing this report.
**Fix:** Wrap `formatDate(j.ship_date)`'s output in `esc(...)` at the call site, or add format validation to the PATCH `ship_date` path to match creation. **Effort:** S.

### XSS-010 — `reports/incidents/list.html:219-245` — latent/non-exploitable today, but a masked High (informational)
**Sink:** All four gviz fields (`customer`, `incident_type`, `risk_level`, `summary`) are correctly wrapped in `escapeHtml(...)` calls in the source — **but `escapeHtml` is not defined anywhere reachable by this page.** Traced the full script load chain (`reports-header.js` → `shared-header.js` → `theme.js`/`auth-interceptor.js`/`shared-api.js`/`shared-utils.js`/`photo-gallery.js`/`pwa-install.js`) — none define it; the only two definitions in the whole repo are local to `safety/training/admin.html` and `track/index.html`, neither loaded here.
**Effect today:** The first `escapeHtml(...)` call throws a `ReferenceError` inside `renderTable`'s `forEach`, caught by `loadIncidentList`'s `try/catch`, which shows "Unable to load incidents." and resets the table. **The page currently never renders a single incident row when data exists** — it fails closed, so no unescaped gviz text reaches the DOM today.
**Why this matters despite being non-exploitable right now:** This is simultaneously a functional bug (a core report page is completely broken) and a security landmine — if anyone fixes the crash the "obvious" way (deletes the `escapeHtml(...)` wrapper, or defines `escapeHtml` as an identity/no-op shim to unblock rendering), this instantly becomes a High-severity gviz-sourced stored/reflected XSS across all four fields, on what this audit considers the single highest-priority target page (same root cause class as XSS-008, four fields instead of one).
**Fix:** Define `escapeHtml` (alias it to the standard `esc()`) rather than removing the calls — this fixes the functional bug and closes the landmine in one change. **Effort:** S.

---

## Sinks reviewed but confirmed SAFE / INERT (no fix needed) — summary by file

**Job Board** (`jobs/index.html` — 50 sinks, `jobs/packing-slip-parser.js` — 0 sinks/no DOM writes, `jobs/packing-slip-test.html` — 3 sinks): all SAFE/INERT except XSS-001/002/003 above. Every parser-derived field reaching a sink elsewhere in these files (`invoice_number`, `location`, line-item `description`/`dimensions`/`part_number`, ship-to address fields) is correctly escaped; `job.customer` is the one field where the discipline breaks, twice, in the same card-render function.

**Reports** (8 files: `incidents/{type,summary,trend,list}.html`, `scrap/{summary,reasons}.html`, `orders/index.html`, `cutting/index.html`): `type.html`, `trend.html` (one Low/theoretical fallback path, not externally reachable through normal UI use), both `scrap/*.html` (server-enum-validated `scrap_reason`, no free text possible), and `cutting/index.html` (consistent `esc()`/`escAttr()`/`muted()` throughout every sink) are all SAFE/INERT. `orders/index.html`'s one other notable interpolation (`j.id` raw into an `onclick` attribute) is INERT — `id` is a server-generated `crypto.randomUUID()`, never attacker-influenced, but flagged as fragile if id generation ever changes.

**Logistics** (`logistics/index.html` — 0 UNSAFE across the full file; `track/index.html` — spot-checked, corroborates a prior SAFE finding on all 7 sinks; `logistics/loading.html` — 0 UNSAFE, uses a stronger two-helper `esc()`/`escAttr()` pattern consistently; `logistics/_archived/bol-generator.html` — confirmed dead, no live references, out of scope).

**Production/Manufacturing**: `production/bead-inventory.html` and `manufacturing/block-calculator.html` — SAFE/INERT everywhere except XSS-004/005 above.

---

## Proposed Fix Prompt Slate

Cluster by module/agent — all are narrow, low-risk, additive `esc()`-wrap fixes with no schema/API change, so all four can run independently and in parallel:

| # | Prompt | Owning agent | Closes | Files touched | Effort |
|---|---|---|---|---|---|
| F1 | Fix XSS-001/002/003: escape the archive-toast customer name; rewire the Archive button and process-pill `onclick` handlers off single-quoted string construction onto `addEventListener` (or a data-attribute + delegated listener) | job-board-agent | XSS-001, XSS-002, XSS-003 | `jobs/index.html` | M (the two `onclick`-rewiring fixes touch card-building + event-wiring, not just an `esc()` wrap) |
| F2 | Fix XSS-004/005: wrap `t.grade`/`t.color` in `bead-inventory.html` and `s.label` in `block-calculator.html`'s stat-breakdown string | production-agent / manufacturing-agent | XSS-004, XSS-005 | `production/bead-inventory.html`, `manufacturing/block-calculator.html` | S (two one-line `esc()` wraps) |
| F3 | Fix XSS-006/007: wrap `item.name`, `trailerType`, `invNumber`/`invSuffix` in `buildLoadingDiagramInnerHtml()`/`printPackingSlip()`, and `job.customer`/`invNum` in `showJobBanner()` | logistics-agent | XSS-006, XSS-007 | `logistics/load-builder.html` | S–M (highest-priority fix — the only confirmed externally-reachable, uploaded-document-sourced pair) |
| F4 | Fix XSS-008/009/010: wrap `row.customer` in `incidents/summary.html`; wrap `formatDate(j.ship_date)`'s output (or add PATCH-path format validation) in `orders/index.html`; define `escapeHtml` (alias to `esc()`) in the shared script chain reachable by `incidents/list.html` | reports-agent | XSS-008, XSS-009, XSS-010 | `reports/incidents/summary.html`, `reports/orders/index.html`, `reports/incidents/list.html` (or a shared script) | S (F4's list.html fix also resolves a standing functional bug — the page currently never renders data) |

**Suggested sequencing:** F3 is the highest-priority (only confirmed externally-reachable pair, no internal account needed to plant the payload) — recommend running it first. F4's `list.html` portion is also worth prioritizing since it's simultaneously a functional-bug fix (a report page that currently never renders). F1, F2 can run anytime, lowest urgency (same-origin-authored only). All four are independent — no shared files, no cross-dependencies.

---

## Coverage & Gaps

- **Exhaustive (every sink read in full, every interpolation traced):** `jobs/index.html`, `jobs/packing-slip-test.html`, `reports/incidents/{type,summary,trend,list}.html`, `reports/scrap/{summary,reasons}.html`, `reports/orders/index.html`, `reports/cutting/index.html`, `logistics/index.html`, `production/bead-inventory.html`, `manufacturing/block-calculator.html`.
- **Thorough (every sink call-site located and read in full surrounding function; every free-text field traced to source, but not a literal every-line read given file size):** `logistics/load-builder.html` (3044 lines), `logistics/loading.html` (1551 lines).
- **Spot-checked, relying on a corroborated prior finding:** `track/index.html` (3 of 7 sinks read in full, all correctly using `escapeHtml()`; not re-verified line-by-line for all 7 this pass).
- **Confirmed dead, out of scope:** `logistics/_archived/bol-generator.html` (no live references anywhere outside changelog/docs).
- **0 files marked NOT YET RUN** — every file named in the parent prompt's priority list, plus every file discovered via cross-referencing (`jobs/packing-slip-parser.js`, `logistics/_archived/*`), was covered to at least the spot-check level above.
- **Not audited (outside the parent prompt's named scope):** any other legacy HTML module not named above (e.g. `admin/*.html`, `safety/*.html`, `qc/*.html`) — the parent prompt explicitly prioritized the externally-fed, highest-count files named in its "Method" section, and this audit stayed within that named list plus files discovered while tracing data sources for confirmed findings.

**Terminate:** Report complete. No source changes made. Nothing staged, committed, or pushed.
