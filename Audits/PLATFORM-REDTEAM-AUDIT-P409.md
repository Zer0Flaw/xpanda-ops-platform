# Red Team Audit — xPanda Ops Platform

- **Date:** 2026-08-25 · **Commit:** `ff55b1f296f0854939f3bcede8c0723400021880`
- **Mode:** adversarial security review (read-only). Companion to `PLATFORM-QC-AUDIT-P409.md` (correctness) and `-REVIEW.md` (cross-check). This pass asks "how do I break in," not "is the code clean."
- **Perspective assumed:** malicious floor employee (valid low-priv account), anonymous internet attacker, driver holding a BOL tracking link, and Intuit's servers.

**Executive summary: no Critical findings — no authentication bypass, injection, or privilege escalation was achieved.** The perimeter is genuinely solid for its context (session gate with regex permission map, HttpOnly+Secure+SameSite=Lax cookie, parameterized SQL everywhere, HMAC fail-closed webhook, closed email allowlist, proper admin checks on role simulation). The findings cluster where red teams expect single-maintainer internal tools to be soft: **account-lifecycle hardening (RT-01/RT-02)** and **fragile invariants that one future refactor could silently break (RT-03/RT-05)**.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 4 |

---

## High

### RT-01 — Password change requires no current password, allows 4-char passwords, and leaves other sessions alive
- Owning agent: admin-auth-agent
- Evidence: `_worker.js/routes/auth.js:112-136` — `handleAuthChangePassword` authenticates the *session* only; it never verifies `current_password`, its only policy is rejecting `new_password.length < 4`, and it does **not** delete other rows in `sessions` for that user.
- Attack: anyone with momentary access to an unlocked floor terminal (or any stolen/XSS-driven active session) can silently reset the account password and keep their own new credential permanently, while the legitimate user stays logged in unaware. Access then survives up to the 30-day session TTL with no rotation.
- Proposed remediation: require current password; raise minimum length; on success delete all *other* sessions for the user. One-commit fix, no migration.
- Migration needed: no · Effort: S

### RT-02 — No login rate limiting or lockout protecting plaintext password comparison
- Owning agent: admin-auth-agent
- Evidence: `routes/auth.js:36-52` — login compares `user.password !== password` with no throttle, lockout, delay, or attempt counter anywhere in the path. Combined with RT-01's 4-char floor.
- Attack: unlimited online guessing. Usernames are guessable (real employee names; UIs expose the name-as-username pattern). Identical error messaging prevents enumeration (good), but nothing slows guessing.
- Proposed remediation: per-username+IP failure counter (D1 or KV) with backoff after ~5 failures. Since storage is intentionally plaintext, rate limiting is the *only* brute-force control — highest-priority hardening item.
- Migration needed: no · Effort: M

## Medium

### RT-03 — Permission gate fails open for any route missing from the map
- Owning agent: db-api-agent (gate owner)
- Evidence: `lib/core.js:222-237` — `getPermissionKey()` returns `null` on no regex match; `hasPermission()` line 232: `if (!permKey) return true;`. Currently unmapped and reachable by ANY authenticated user regardless of role: `/api/notifications*`, `/api/holey-chunks` preview (known/backlog), `/api/admin/r2-backfill` (self-checks `X-User-Is-Admin` at `index.js:341` instead of using the map).
- Failure mode: every future route defaults to "all authenticated users" unless someone remembers a map entry — inverse of safe defaults. Today's routes verified fine by the QC audit; the risk is structural.
- Proposed remediation: deny unmapped mutations (`permKey === null` && method ≠ GET/HEAD), or add an explicit `UNMAPPED_POLICY`; audit the three currently-unmapped paths while doing so.
- Migration needed: no · Effort: S-M

### RT-04 — Large innerHTML surface fed by externally-derived data (stored XSS — suspected, needs dedicated sink audit)
- Owning agent: job-board-agent (+ all module agents)
- Evidence: ~124 `innerHTML` assignments across legacy pages (jobs:50, logistics:29, bead-inventory:14, block-calculator:15…). Sampled sinks show real discipline — `esc()` helper (`jobs/index.html:1095`) used in templates (e.g. 826, 871). But inputs include externally-influenced strings: packing-slip PDF text parsed client-side, customer/carrier names, gviz incident data. Full sink-by-sink audit out of scope (breadth rule); multi-line template literals defeat grep heuristics.
- Attack if one sink is unescaped: stored XSS in an admin's browser on the jobs board — which chains with RT-01 into full account takeover.
- Proposed remediation: dedicated pass enumerating every `${` interpolation inside an `innerHTML` template in the 8 highest-count files, verifying `esc()` coverage; prioritize jobs + logistics.
- Migration needed: no · Effort: L (mechanical but broad)

### RT-05 — Authorization trusts `X-User-*` headers whose safety hangs on one implicit invariant
- Owning agent: db-api-agent
- Evidence: gate rebuilds the request appending `X-User-Id/Role/Name/Permissions/Is-Admin` (`index.js:248-256`), relying on `new Headers(array)` last-wins semantics to overwrite client-supplied duplicates. ≥12 handler sites authorize off these headers (`jobs.js:143-148,178-183`, `bols.js:429,570-571,599-600`, `loading.js:21`, `index.js:333-341`). Incoming `X-User-*` are never explicitly stripped, and nothing documents the ordering assumption.
- Attack today: none found — gated paths always overwrite; ungated handlers don't read them. But any future handler reached outside the gate inherits forgeable authorization ("add `X-User-Is-Admin: 1`").
- Proposed remediation: explicitly delete the five `X-User-*` headers before injecting, plus a comment declaring the invariant. Cheap; removes the class.
- Migration needed: no · Effort: S

## Low

### RT-06 — Public BOL tracking: bearer token lives in the URL; lookup returns the full BOL row
- Owning agent: logistics-agent / db-api-agent
- Evidence: `/api/public/bol-lookup/:token` (`public.js:5-46`) — token (128-bit hex, good entropy) is a path segment → persists in browser history, server logs, referrers. On match, `SELECT * FROM bols` returns every column except `access_token` to an anonymous holder. Guessing is impractical at that entropy; this is hygiene, not exposure.
- Proposed remediation: accept token via `POST` body or `#fragment` if the track page is ever reworked; project explicit columns instead of `SELECT *`.
- Migration needed: no · Effort: S

### RT-07 — QB webhook signature failures are invisible (console.error only, responds 200)
- Owning agent: db-api-agent
- Evidence: `routes/quickbooks.js:95-99` — invalid HMAC → `console.error` + `200 'ok'`. The 200 is correct per Intuit's retry spec and the check fails closed, but signature-guessing attempts leave no trace in `activity_log`, so probing would be undetectable.
- Proposed remediation: `logActivity(db, 'qb_webhook_rejected', …)` on failure (best-effort, inside `waitUntil`). Effort: S · Migration needed: no

### RT-08 — Server error details leak to clients in auth handlers
- Owning agent: admin-auth-agent
- Evidence: `auth.js:66,134` and elsewhere — `detail: String(e?.message || e)` returned in 500 bodies on pre-auth endpoints (login, change-password). D1/worker internals exposed to unauthenticated users. Compounds AUDIT-101 (stack traces).
- Proposed remediation: log detail server-side, return generic message to client on auth-path errors. Effort: S

### RT-09 — Sessions: fixed 30-day TTL, no rotation, no re-auth for sensitive operations
- Owning agent: admin-auth-agent
- Evidence: `createSession` (`auth.js:14-22`) — flat 30-day expiry; no refresh; role simulation is well-guarded by `isRealAdmin` checks (`auth.js:146-147,175-176`) but password change never re-verifies identity or invalidates sibling sessions. Acceptable for a floor tool; noted for completeness with RT-01.
- Proposed remediation: fold into RT-01's fix (invalidate-on-password-change); consider shorter TTL for admin-role accounts.

---

## Attacked and held (clean — verified, not assumed)

- **SQL injection:** all template-literal `prepare()` sites interpolate only code-built column-name fragments; every value is `?`-bound.
- **Session tokens:** `crypto.randomUUID()` (~122 bits) for sessions, 128-bit hex for BOL access tokens; new token per login (no fixation).
- **Cookie posture:** `HttpOnly; Secure; SameSite=Lax`; logout clears correctly.
- **CSRF:** SameSite=Lax blocks cross-site cookie attach for POST/PUT/DELETE; no state-changing GET handlers found (QB OAuth callback is the sole mutating GET — low risk, Intuit-originated).
- **Gate escape hatches:** `ESCAPE_PREFIXES` requires `isRealAdmin`; `/api/auth/simulate-role` independently verifies `isRealAdmin` in-handler and refuses simulating the administrator role.
- **QB webhook:** fails closed when `QB_WEBHOOK_VERIFIER` unset or HMAC mismatch (only gap is RT-07 invisibility).
- **Email:** `/api/bol-email/send` recipients resolve from the `bol_email_recipients` allowlist table — not an open mailer.
- **Secrets:** `.dev.vars`, `client_secret_*.json`, rosters not tracked in git (post-2026-07-31 purge holds); wrangler.tomls contain no literal secrets.
- **Public surface inventory:** exactly three anonymous surfaces exist (login, BOL tracking, QB webhook) plus static assets — each accounted for above.

## Priority ordering for fix prompts
1. **RT-01 + RT-02** (one prompt, auth lifecycle) — closes the takeover chain.
2. **RT-03** (fail-open default) — pairs naturally with the QC audit's permission findings.
3. **RT-05** (header stripping) — S-effort invariant hardening.
4. **RT-04** — dedicated XSS sink pass (L).
5. RT-06/07/08/09 — batch as one low-priority hardening prompt.

All findings are code-level confirmed unless marked *suspected* (RT-04). No source files were modified; this report is uncommitted per audit discipline.
