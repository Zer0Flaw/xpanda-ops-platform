# Scratch D1 + R2 (dev write-safety)

`wrangler dev` now has `preview_database_id` / `preview_bucket_name` entries in `wrangler.toml`
(unit 3a). Once set up, `wrangler dev` mutations land on this scratch DB/bucket — never prod.
`wrangler deploy` is untouched and still targets prod.

## One-time setup (Steve — requires Cloudflare account auth)

1. Create the scratch D1 database:
   ```
   wrangler d1 create xpanda-v2-scratch
   ```
   Copy the returned `database_id` into `preview_database_id` in `cutting-pilot/wrangler.toml`
   (currently a placeholder marked `<<SCRATCH_D1_ID — ...>>`).

2. Create the scratch R2 bucket:
   ```
   wrangler r2 bucket create xpanda-bol-photos-scratch
   ```

3. Export prod schema (read-only, schema only — no data leaves prod):
   ```
   wrangler d1 export DB --no-data --output cutting-pilot/scripts/scratch/schema.sql
   ```
   This overwrites the placeholder `schema.sql` in this folder. If the export is broad (every
   table in the platform), it's fine to leave it as-is or trim to just the tables this dashboard
   needs: `sessions`, `users`, `user_roles`, `roles`, `jobs`, `bols`, `loading_assignments`,
   `loading_bays`, `loading_photos`, `loading_board_notes`.

   **Before running `seed.sql` (step 4), reconcile it against the real export.** `seed.sql` was
   written from column names observed directly in `_worker.js/routes/*.js` (INSERT/SELECT
   statements), not from a live export — high confidence, but not verified against the actual
   `CREATE TABLE` DDL. If any column name/order is off, `wrangler d1 execute` will fail loudly
   (no silent partial-apply) — fix the mismatched line(s) and re-run.

4. Apply schema then seed to scratch. **Plain `wrangler dev` (no `--remote`) does not talk to the
   cloud database at all** — it runs against a local Miniflare-emulated D1 (a SQLite file under
   `.wrangler/state`), and `preview_database_id` is irrelevant to that mode. Pick ONE of the two
   paths below to match how you intend to run `wrangler dev` in step 5, and use the matching
   `--local` / `--remote` flag consistently for both this step and step 5 — mixing them (e.g.
   seeding remote but running dev local, or vice versa) will look like the seed silently didn't
   take:

   **Local (default, recommended for day-to-day dev):**
   ```
   wrangler d1 execute xpanda-v2-scratch --local --file cutting-pilot/scripts/scratch/schema.sql
   wrangler d1 execute xpanda-v2-scratch --local --file cutting-pilot/scripts/scratch/seed.sql
   ```

   **Remote (only once `preview_database_id` above is the real id, not the placeholder):**
   ```
   wrangler d1 execute xpanda-v2-scratch --remote --file cutting-pilot/scripts/scratch/schema.sql
   wrangler d1 execute xpanda-v2-scratch --remote --file cutting-pilot/scripts/scratch/seed.sql
   ```
   **Do not run `wrangler dev --remote` while `preview_database_id` is still the placeholder
   string.** Whether wrangler errors out or silently falls back to the prod `database_id` in that
   case has not been verified in this session — confirm `wrangler.toml`'s `preview_database_id` is
   the real id from step 1 before ever passing `--remote`.

5. Confirm dev uses scratch, not prod — run the matching mode from step 4:
   ```
   wrangler dev            # local — reads the local emulated D1 you just seeded with --local
   wrangler dev --remote   # remote — reads the real scratch D1 you seeded with --remote
   ```
   Then hit a read route (e.g. `/v2/api/loading-assignments?job_id=job-scratch-1`) — you should
   see the seeded scratch rows (`job-scratch-1` / `INV-SCRATCH-1`), not real prod data. If the
   board looks empty, check `showAll` ("Show all" toggle) before assuming the seed failed — see
   the date-staleness note at the top of `seed.sql`.

## Dev-auth cookie (host-pinned cookie problem)

`xpanda_session` is `SameSite=Lax` with **no `Domain` attribute** — it only travels to the exact
host that set it (prod `www.xpandaops.com`). Under `wrangler dev` (`localhost:8787`), there is no
such cookie, so `validateSession()` returns `null` and every gated route 401s.

**Fix (per dev session):** in your browser's dev tools, manually add a cookie for the
`wrangler dev` origin (e.g. `http://localhost:8787`):

```
Name:  xpanda_session
Value: DEV-SCRATCH-SESSION
```

This matches the seeded `sessions` row (→ `user-devtest`, role `role-administrator`,
non-expiring) — the dev browser is now authenticated as the scratch admin dev user against the
`wrangler dev` origin specifically. This cookie does nothing on prod (different host, and the
token doesn't exist there).

## Seeded scratch data (dummy, safe to commit — no real credentials)

- `role-administrator` — admin role, bypasses all permission checks per platform convention.
- `user-devtest` / `devtest` (plaintext dummy password) — linked to the admin role.
- `DEV-SCRATCH-SESSION` — non-expiring session token for the above user.
- 3 loading bays (`Bay 1`–`Bay 3`).
- 2 scratch jobs: `job-scratch-1` (INV-SCRATCH-1, status `loading`, has a bay + BOL) and
  `job-scratch-2` (INV-SCRATCH-2, status `done`, awaiting queue — no bay yet).
- 2 loading assignments (one bayed/loading with `bol_count > 0`, one awaiting).
- 1 BOL row on `job-scratch-1` (`bol-scratch-1`) so `bol_count > 0` renders correctly.
- 1 loading board note row.

None of this is real production data — customer names, addresses, and PO/INV numbers are all
fabricated (`Scratch Customer A/B`, `123 Scratch St`, etc.).
