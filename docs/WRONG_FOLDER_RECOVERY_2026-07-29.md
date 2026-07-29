# Wrong-folder recovery report

Date: 2026-07-29

## Repositories compared

- Canonical destination: `C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`
- Accidental source: `C:\Users\Botswapelo Studios\Documents\Work\Boroko Bookings`
- Shared remote: `https://github.com/Rabafi/boroko-bookings-FullCode-2.git`
- Canonical branch/HEAD: `codex/tsa-bonno-enterprise-foundation` at `37cc1ebf`
- Accidental branch/HEAD: `refactor/database-split` at `867d591`

The accidental branch is an ancestor of the canonical branch. The canonical
branch is 41 commits ahead and the accidental branch has no unique commits.
The recoverable July 29 work exists only as uncommitted files in the accidental
folder.

## Exact recovery bundle

Before selecting any code for integration, the complete non-ignored dirty state
of the accidental repository was preserved at:

- `recovery/boroko-bookings-2026-07-29.zip`
- `recovery/boroko-bookings-2026-07-29.zip.sha256`

The bundle contains:

- all 19 tracked modified files as complete files;
- all 52 untracked, non-ignored files as complete files;
- a SHA-256 manifest for all 71 files;
- the old repository path, branch, HEAD, remote, and capture metadata;
- the complete binary-capable tracked working-tree patch; and
- the original `git status --short` output.

The ZIP was extracted after creation and all 71 extracted files matched their
source SHA-256 values. Its SHA-256 is:

`634b379a573b8b02c9763edb5bad0d3a2e10f4a684987785187087ee97dd36e9`

Ignored secret/configuration files are deliberately not inside the ZIP.
They were audited separately without printing their values:

- the database password file matches;
- the release GitHub token shared by both folders matches;
- Booking Site and Manager PWA environment values match;
- the old root Supabase URL matches the canonical URL;
- the old root Supabase key differs, but the canonical project already has its
  own configured key and the user confirmed both folders use the same backend;
- the only old-only root setting is `BOROKO_TEST_TENANT=false`, which is now
  documented in the canonical `.env.example` and fails closed when absent.

No secret was copied into Git or the recovery archive.

The accidental folder also owns three old `.claude/worktrees`. Their branch
commits and tags are already ancestors of the canonical HEAD, and the only
dirty worktree settings files are byte-identical to copies already present
under the canonical folder. The copied `.git` pointer files under the canonical
`.claude/worktrees` still refer to the accidental folder and will become stale
after deletion, but they contain no unique source work and are ignored by the
canonical repository.

## Recovery decision

The July 29 work must not be copied wholesale.

It was implemented against the June 6 application and assumes that Restaurant
and Bar still use the old `POS.jsx`/`create_pos_order` architecture. The
canonical application has since moved to product-specific Hospitality POS
routes and the `create_pos_order_v3` contract, with catalog snapshots, event
folios, station routing, server tickets, daily order/receipt numbering, later
cash-up controls, Restaurant/Bar bundles, and additional inventory contracts.

Installing the accidental `src/main/domains/pos.js`, `POS.jsx`, inventory
domain, authentication domain, or July 29 SQL unchanged would overwrite or
bypass those later contracts.

## Safely recovered

The following missing, architecture-neutral Phase 0 safeguards were ported:

- `tests/integration/test-tenant-guard.mjs`
- `tests/integration/tenant-fixture.mjs`
- `tests/integration/phase0-test-tenant-guard.test.mjs`
- `scripts/test/seed-reset.mjs`
- `BOROKO_TEST_TENANT=false` in `.env.example`
- `npm run test:phase0-tenant-guard`

The recovered CLI was also corrected so `node scripts/test/seed-reset.mjs
--help` works. The guard has nine passing non-network tests and rejects the
known production Supabase project even if the caller accidentally enables the
test flag.

## Accidental work not copied unchanged

### Phase 1: device/operation/audit foundation

Potentially useful intent:

- stable registered-device identity;
- immutable operation receipts;
- server-derived audit identity and time;
- fail-closed disposable-tenant tests.

Why the raw migration and domain patches were not copied:

- the authentication replacements predate current product-membership and
  entitlement login changes;
- the canonical app already has stable per-profile device IDs, device health,
  POS financial operation logs, and product-aware authentication;
- replacing the current authentication functions would risk login and
  entitlement regressions;
- the new receipt/audit tables are not wired to the canonical v3 financial
  paths.

### Phase 2: POS sale v2

Not copied. The canonical app already uses the later `create_pos_order_v3`
contract. The accidental adapter would downgrade the app to a parallel v2 sale
path and lose current catalog snapshots, event folios, station routing, and
later receipt/order behavior.

### Phase 3: returns, voids, and approval proof

Not copied unchanged. The canonical repository already has authoritative
return/void contracts and later stock-disposition repairs. The accidental UI
expects a signed approval assertion but does not expose a complete operator
control that creates one. Its direct merge would also replace current return
and void behavior.

One current risk remains worthy of a dedicated forward fix: the existing
offline PIN-based compatibility path can place a PIN in a queued RPC payload.
That should be repaired against the current v3/return contract, not by
installing the accidental v2 files.

### Phase 4: inventory offline v2

Not copied unchanged. The canonical repository contains later purchasing,
stocktake, lot, expiry, location, transfer, recipe, and stock-depletion
migrations and UI. The accidental domain file is based on the older inventory
shape and would discard those later behaviors.

### Phase 5: shifts and cash-up v2

Not copied unchanged. The canonical repository contains later attendance,
shared-terminal, cash-tip, cash-up review, correction, and manager-PIN
contracts. The accidental migration creates an alternate shift/cash-up model
without reconciling those later rules.

### Phase 6: KDS tickets v2

Not copied unchanged. The canonical v3 sale already creates server tickets and
the later kitchen-station migration routes items by station. The accidental
work creates a second KDS table family and its own status RPCs, while its own
evidence document states that Electron replay and KDS convergence are not
complete.

### Phase 7: restaurant checks v2

Not copied. The migration accepts `unit_price` from the check-round payload and
settles through the older `create_pos_order_v2` path. That would bypass the
canonical v3 catalog snapshot and station-routing contract. Its own evidence
also states that merge, item voiding, the full renderer workflow, and live
concurrency tests are unfinished.

### Phase 8: Manager oversight/configuration

Not copied. The proposed `get_manager_pos_oversight` function is
`SECURITY DEFINER`, is executable by `anon`, and does not enforce caller lodge
access or a manager capability before counting lodge data. The proposed PWA
route is also not guarded by the current product/add-on access model.

### Phase 9: release

Not activated. The accidental release checklist correctly remains no-go until
an isolated database, concurrency/replay tests, builds, installer smoke, and a
seven-day supervised pilot pass.

## Evidence quality

The accidental `test:pos-phase-gates` command passes, but it only checks that
files and package scripts exist. Several Phase 2–8 tests are static SQL/source
pattern checks. The evidence documents themselves state that disposable
database, concurrency, cross-terminal, and supervised reconciliation proof is
still missing.

No July 29 database migration was deployed as part of this recovery.

## Canonical verification before commit

- `npm test` — pass
- `npm run test:phase0-tenant-guard` — 9/9 pass
- `npm run test:offline-pos-critical` — pass
- `npm run test:inventory-offline-sync` — pass
- `npm run booking:test` — 33/33 pass
- `npm run booking:build` — pass
- `npm run test:marketing-site` — pass
- `node scripts/product-app.mjs hospitality-pos build` — pass
- `npm run build` (Lodge/Camp) — pass
- `npm run manager:build` — pass
- `npm run manager:lint` — pass with 45 existing warnings and no errors
- `npm run test:restaurant` — reaches the known disposable PostgreSQL
  behavioral gate and stops because `127.0.0.1:54322` is not running

Installing Booking Site development dependencies from its lockfile reported
five npm audit findings (one moderate and four high). Dependency versions were
not changed automatically during this recovery.

## Safe forward path

1. Keep the canonical v3 sale, return, inventory, ticket, cash-up, entitlement,
   and product-bundle contracts.
2. Run the recovered disposable-tenant guard before any destructive or
   integration fixture work.
3. Re-audit the current v3 paths for the valid concerns raised by the old audit,
   especially queued plaintext approval credentials and best-effort audit
   writes.
4. Implement any confirmed gap as a new forward migration and focused
   canonical test, rather than reusing a migration that targets the June 6
   schema.
5. Do not claim the July 29 Phase 1–8 tranche as deployed or commercially
   complete.
