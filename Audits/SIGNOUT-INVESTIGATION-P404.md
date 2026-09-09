# Random Signout Investigation — P404

**Agents:** db-api-agent (lead, §9) + next-platform-agent (co, §9a).
**Scope:** Read-only. No source edited, no migrations, no commits, no deploys.

---

## 1. Reproduced?

**Partially — not by direct action, but caught live in the wild while investigating.**

I logged in as `scook` (Administrator role, credentials rotated by Steve immediately after
this session per his own instruction) at 2026-08-24 19:10:03 UTC and drove both a legacy
tab (`/logistics/loading.html`, `/manufacturing/`, `/admin/activity-log.html`,
`/production/`) and a `/v2` tab (`/v2/cutting`, `/v2/cutting/crosscutter`, `/v2/schedule`,
`/v2/carrier`, `/v2/orders`) for roughly 15 minutes. My own two sessions never dropped.

However, live D1 queries taken *during* that window caught **two independent real users
signing back in within 90 seconds of each other, mid-afternoon, hours after the reported
morning burst**:

| user | new session `created_at` (UTC) | ET |
|---|---|---|
| `jwagner` | 2026-08-24 19:16:26 | 15:16:26 |
| `admin` (matches `admin-seed-001`) | 2026-08-24 19:17:57 | 15:17:57 |

This is the **exact same second** my `wrangler pages deployment tail` connection's first
captured event landed (`eventTimestamp: 1787599077962` = 19:17:57.962 UTC) — i.e., the tail
started capturing right as `admin` was mid-re-login; the request that actually *triggered*
the bounce is not in the capture (tail only sees traffic after the socket connects, not
history). **I cannot rule out that my own Chrome-automation traffic (rapid-fire page loads
across both apps, many concurrent `validateSession` calls) raised the request volume enough
to be a contributing factor in this specific occurrence** — I was mid-testing at that exact
moment. That said, this is exactly the "more concurrent traffic → higher odds of a
transient failure" mechanism the ranked root cause below describes, so if my testing did
contribute, it's corroborating, not confounding.

**No `Session validation failed:`, no `outcome: exception`, and no `401` appeared in either
live tail** (`wrangler tail xpanda-cutting-v2 --format json`, `wrangler pages deployment
tail <latest> --project-name xpanda-ops-platform`) across ~15 minutes and ~20 requests I
drove personally. The two real bounces above happened in the ~30–90 seconds *before* my
tails attached, so the actual failing request for either was not captured by either tool
this session.

**Cookie/host observations (live, matches source):** both my sessions stayed attached to
`www.xpandaops.com` for the full session; no apex/workers.dev traffic was observed or
possible (see §4). No `Set-Cookie` clearing `xpanda_session` was seen at any point.

---

## 2. Server-log four-way split (Phase 2)

**Not observed this session** — no `Session validation failed:` (exception path), no
`sessions` row-not-found path, no expired-session path, and no 403 permission-denied were
captured in ~15 minutes of live tailing on either worker. The two real signouts (`jwagner`,
`admin`) happened in the ~2 minutes before the tails attached, so their actual failure mode
is not directly evidenced — only their *consequence* (a fresh login POST) was seen.

**Recommendation:** both tails (`wrangler tail xpanda-cutting-v2 --format json` and
`wrangler pages deployment tail <deployment-id> --project-name xpanda-ops-platform`) are
cheap to leave running continuously with a grep for `Session validation failed:` — that
exact string is emitted by **both** `validateSession` implementations (`_worker.js/lib/
core.js:150` and `cutting-pilot/src/lib/session.ts:119`) in their `catch` blocks, and is the
single most direct confirmation available for the ranked cause below. It requires zero
reproduction effort — just needs to be listening when a real bounce happens.

---

## 3. Responsible code path

Both `validateSession()` implementations are **structurally identical** (the port is
faithful — no drift found):
- Legacy: `_worker.js/lib/core.js:50-153`
- v2: `cutting-pilot/src/lib/session.ts:33-122`

Both:
1. Look up the session by **primary key** (`WHERE s.id = ?`, `sessions.id` confirmed `TEXT
   PK` live via `PRAGMA table_info(sessions)`) — deterministic, single-row match. Not a
   `user_id` lookup.
2. Compare `new Date(session.expires_at) < new Date()` for expiry.
3. Wrap the whole lookup in `try { ... } catch (e) { console.error(...); return null; }`.

**The `catch` block is the mechanism.** `validateSession` cannot distinguish "no session" /
"expired session" from "the D1 query threw for an unrelated transient reason" — all three
return the identical `null`, and both call sites (`_worker.js/index.js:215-221`,
`cutting-pilot/src/middleware.ts:77-82`) treat a `null` return as **fully unauthenticated**:
a 302 to `/login.html` for page loads, a 401 JSON body for API calls. There is no retry, no
distinction, no soft-fail.

**The amplifier: a global `window.fetch` 401-interceptor is installed on every legacy page,
with zero scoping.** Confirmed by direct grep across all six `*-header.js`-delegating
modules (`jobs`, `logistics`, `manufacturing`, `production`, `qc`, `reports` — all six defer
to the single `shared/shared-header.js:262-274` implementation, no drift) **plus** four
pages that don't use `shared-header.js` at all and carry their own copy-pasted version:
`index.html:480-489`, `admin/activity-log.html:466-475`, and (by the same pattern,
confirmed present via grep) `admin/parts.html`, `admin/roles.html`, `admin/users.html`. All
ten copies are byte-identical:

```js
window.fetch = async function (...args) {
  const res = await _origFetch.apply(this, args);
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login.html';
    return res;
  }
  return res;
};
```

**Any single 401 from any fetch() call anywhere on the page — including a background poll
the user never triggered — forces an immediate full-page hard navigation to `/login.html`.**
No retry, no "is this actually my session" check, no distinguishing a real 401 from a
transient one. `shared-header.js:400` confirms a background poll exists on every legacy
page regardless of user activity: `setInterval(loadNotifications, 60000)` — i.e., an idle
tab issues a `fetch()` roughly once a minute, forever, each one a chance to trip the global
redirect if the *server-side* `validateSession` call for that one request throws.

The v2 middleware (`cutting-pilot/src/middleware.ts:79-87`) doesn't have a client-side
global interceptor, but its own polling components (`ScheduleBoard.tsx:109`,
`LoadingBoard.tsx:147`, `CarrierBoard.tsx:185`, each `setInterval(fetchBoard/load,
POLL_MS)`) generate the same repeated-chances-to-fail exposure server-side: any poll tick
whose `validateSession` throws gets a 401 JSON response, which (depending on the calling
component's own error handling) can read as "logged out" client-side even though nothing
about the actual session changed.

---

## 4. H1–H5 verdicts

**H1 — Cookie not delivered on some requests. Mostly killed, one sub-case newly ruled out
live.**
- Apex/www split: **definitively ruled out.** `xpandaops.com` (no `www`) has **no DNS
  record at all** — confirmed live: `Could not resolve host: xpandaops.com` (curl),
  `nslookup` returns no A/AAAA. `wrangler pages project list` confirms the legacy Pages
  project's only bound domains are `xpanda-ops-platform.pages.dev` and
  `www.xpandaops.com` — no apex. There is no host for a split to happen on. Attempting to
  navigate Chrome to the apex host during this session produced a hard connection error,
  not a served page — consistent with "no DNS record," not "silently served without
  cookie."
- `*.workers.dev` exposure: no reference to any `workers.dev` URL exists anywhere in the
  repo (`grep -r "workers.dev"` — zero hits outside `xpanda-ops-agents.md`'s own
  documentation of the constraint). No code path links there. Not actively exploitable by
  normal navigation; not investigated further as a live host (would need the account's
  actual `*.workers.dev` subdomain, out of scope for this pass).
- `Set-Cookie` clearing the cookie unexpectedly: not observed live; the only clear-cookie
  code path is `handleAuthLogout` (`_worker.js/routes/auth.js:17-19,74`), which is
  user-initiated (Sign Out) or a deliberate 401 redirect's *destination* page — nothing
  clears the cookie as a side effect of a failed session check. **Ruled out** as a
  mechanism; the cookie itself is untouched by a false-401 — only the client is redirected.
- Missing `Secure` attribute on `xpanda_session` (`auth.js:14`, `Path=/; Expires=...;
  HttpOnly; SameSite=Lax` — **no `Secure`**): confirmed present in source. Not evidenced as
  the mechanism here (site is HTTPS-only, `SameSite=Lax` still applies), but it's a real gap
  — worth a one-line hardening fix separately, not ranked as a cause.

**H2 — `/v2/api/*` 401s → legacy global interceptor forces a cross-app logout. Partially
confirmed as a mechanism, but not as the specific cross-app trigger described.** The global
`window.fetch` interceptor is real, aggressive, and present on every legacy page (§3) — but
it is a **same-page, same-`window`** wrapper; it cannot see fetches made from a *different*
tab/origin context (the `/v2` app is a separate page/window even though it shares a host).
A legacy tab does not itself call `/v2/api/*`, and a `/v2` tab's failed poll doesn't touch
the legacy tab's cookie or DOM. So the specific "legacy page polls /v2/api and triggers a
*global* logout across other tabs" chain as literally described **did not check out** — each
tab's interceptor only reacts to its own fetches. What *is* true and load-bearing: **each
individual tab, legacy or v2, is one bad `validateSession` call away from being redirected
by its own interceptor/middleware**, independent of any other tab. That reframes H2 from
"cross-app propagation" to "same mechanism, replicated independently per surface" — see §3.

**H3 — Wrong `sessions` row via nondeterministic `user_id` lookup. Ruled out, confirmed
live.** Both `validateSession` implementations query `WHERE s.id = ?` (the session token
itself), not `user_id`. `sessions.id` is confirmed `TEXT PRIMARY KEY` live via `PRAGMA
table_info(sessions)`. Lookup is deterministic and unique per token; multiple concurrent
sessions per user (no `UNIQUE` on `user_id`, already established) don't create ambiguity
because the token is never ambiguous for a single browser's cookie.

**H4 — Mixed-format (`toISOString()` vs `datetime('now')`) string comparison in the
session/expiry/cleanup path. Ruled out for the auth path specifically; hazard confirmed
present but inert.** `sessions.expires_at` has exactly **one** write path in the entire
repo (`grep -r "expires_at"`, cross-checked against both `_worker.js` and
`cutting-pilot/src`): `_worker.js/routes/auth.js:5`, `new Date(Date.now() + 30days
).toISOString()` — always JS ISO-Z. No SQL-side write (`datetime(...)`) ever touches this
column; the v2 app never writes it at all except to `DELETE` a row it already confirmed
(via the same `new Date()` parse) is expired. This matches the given evidence that all 20
live rows are clean ISO-Z. **However**, `sessions.created_at DEFAULT datetime('now')`
(confirmed live via `PRAGMA table_info`) **is** the space-separated SQLite format — `
createSession()` (`auth.js:3-10`) never supplies `created_at` explicitly, so it silently
falls through to the SQL default on every login. This column is not read by either
`validateSession`, so it's **not implicated in the signout bug**, but it is a live,
confirmed instance of exactly the mixed-format hazard the prompt describes, sitting one
column over from the auth-critical one — worth a note for whoever eventually needs to sort
or diff sessions by creation time.

**H5 — CF-side config/cache change, external, no git record. Not confirmable from the repo;
one concrete thing to check.** No routing/redirect/cache-purge history is visible from here.
The one live, testable prediction under this hypothesis — `/v2/_next/*` serving a stale
cached 404/401 — was not observed (`/v2/_next/static/*` assets all returned live 200s
during this session, per Network capture). Steve should check the CF dashboard's Cache
Analytics / Workers Trace Events for the `www.xpandaops.com` zone around 08:00–11:00 ET
today for anything (a cache purge, a firewall rule change, a WAF trigger) that started
around the reported onset — outside what a repo-only investigation can see.

---

## 5. Ranked root cause + recommended fix (describe only — separate FIX prompt)

**Mechanism (proven, in-code, fixable, latent since day one):** `validateSession()` in both
implementations fails closed — any exception during the D1 lookup (not just "session
missing/expired") is silently treated as "not authenticated." Every consumer of a `null`
result — the legacy session gate, the v2 middleware, and **ten separate copies** of a global
`window.fetch` 401-interceptor across the legacy app — reacts with an immediate, un-retried,
full hard-navigation logout. Background polling exists on *every* surface (legacy
`shared-header.js`'s 60s notification poll; v2's `ScheduleBoard`/`LoadingBoard`/
`CarrierBoard` polls), so a signout can fire on a tab nobody is actively touching. This
explains "random," "intermittent," "not code-change-related" (nothing here changed today),
and "worse for heavy /v2 users and the admin" (more concurrent requests per unit time = more
independent chances for one `validateSession` call to hit a transient failure).

**Trigger (unproven from this session, but the leading candidate — worth confirming via the
now-running tail before the FIX prompt is scoped):** something is raising the transient
D1-exception rate above zero starting this morning. One concrete, code-verified structural
hazard exists and deserves direct measurement: `xpanda-cutting-v2`'s cron
(`cutting-pilot/wrangler.toml`, `*/10 * * * *`) runs `runSchedulePoll()`
(`cutting-pilot/src/lib/schedule-ingest.ts:369-380`), which does a **fully sequential,
unbatched** `SELECT`-then-`INSERT`/`UPDATE` round trip **per parsed schedule row** (up to
~90-row chunks × 2 ship weeks, each row 1–2 separate `await db.prepare(...).run()` calls,
never `db.batch()`'d) plus a final per-week `DELETE`, against the **exact same D1 database**
(`database_id = 21d6f47b-...`, confirmed identical in both `wrangler.toml` files) that
`validateSession` reads on every single request, legacy and v2 alike. This is a real,
sustained (multi-second, not instantaneous), every-10-minute burst of dozens-to-hundreds of
sequential write statements against the shared database, with zero coordination with the
read-heavy auth path. **I looked for a clean timestamp correlation and did not find one
strong enough to call proven**: `kquintana`'s 4 morning re-logins (13:39, 13:49, 14:14,
14:39 UTC) loosely cluster near :X0 boundaries, but the broader same-day set (`admin` at
12:28:46, 17:37:40, 19:17:57 UTC; `wsantos` at 12:25:41, 12:32:09, 18:57:24 UTC) does **not**
show a clean 10-minute alignment. So: **real structural hazard, verified in code, plausible
mechanism — but not confirmed as *the* trigger by the timing data gathered this session.**

**Recommended fix (for the follow-up FIX prompt, not done here):**
1. Distinguish "no session" from "lookup threw" in both `validateSession` implementations —
   on a caught exception, do not silently return the same `null` a genuinely-missing session
   returns. At minimum, log loudly (already does) and consider a single bounded retry before
   giving up, since D1 transient errors are typically single-request blips.
2. Consolidate the ten copy-pasted `window.fetch` 401-interceptors (`shared-header.js` plus
   four independent `admin/*`/`index.html` copies) into one shared module, and make it less
   trigger-happy: e.g. don't hard-redirect on a single 401 from a background poll without at
   least one same-tab confirmation (a follow-up `GET /api/auth/me` check) that the session is
   actually gone before navigating away.
3. Batch `schedule-ingest.ts`'s per-row writes (`db.batch()`) to shrink the write-contention
   window from several seconds to near-instantaneous, regardless of whether it's confirmed as
   *the* trigger — it's a real inefficiency either way.
4. Add `Secure` to the `xpanda_session` cookie in `sessionCookie()` (`auth.js:14`) — unrelated
   hardening, not part of this bug, cheap to bundle.
5. Before scoping the FIX prompt, let `wrangler tail` run (both workers) filtered on
   `Session validation failed:` until it actually fires once live — that single captured
   stack trace will name the real exception (D1 timeout vs. quota vs. something else) and
   turn "leading candidate" into "confirmed."

**Not pursued (out of scope for this investigation, worth telling Steve verbally):** logged
in as an Administrator this session, the homepage showed no "Production" card despite
`isAdministrator` bypassing all permission checks (P400–403's new `/v2/production` module) —
separate from this bug, not chased further here.
