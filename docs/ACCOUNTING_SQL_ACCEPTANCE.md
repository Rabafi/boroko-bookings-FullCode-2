# Accounting SQL Acceptance (Phase C/D3)

Status: **EXECUTED on the isolated disposable cloud project
`repsrmlomedqrmrdsbga` 2026-09-09/10 — see "Executed record" below.**
Prior status (superseded, preserved for history): NOT RUN — no database
was available in this environment; suites refused/failed without one.

> Superseded history (unaltered original, kept as evidence of the prior
> state): `restaurant-accounting-behavioral` and
> `restaurant-recipe-depletion-behavioral` failed with `ECONNREFUSED
> 127.0.0.1:54322`; the cutover-activation suite refused with an explicit
> disposable-target safety message; Docker was not installed so the local
> disposable stack could not start; no database was touched, created, or
> reset in that pass.

## Executed record (disposable cloud target, 2026-09-09/10)

Target: `repsrmlomedqrmrdsbga` (eu-west-1, isolated, synthetic fixtures
only). Linked production `oicgpknsmtvcsjacymum` was never written by this
work. Chain: 441/441 timestamped migrations applied; history stamped;
`db push --dry-run` clean. Safety: `RESTAURANT_ACCOUNTING_DISPOSABLE_DB=1`
plus host-bound `RESTAURANT_ACCOUNTING_DISPOSABLE_ACK`; settlement ran with
`POS_SETTLEMENT_STRICT_RELEASE=1`. Full command/exit/SQLSTATE evidence is
indexed in `docs/ACCOUNTING_DISPOSABLE_EVIDENCE_INDEX.md` (nonsecret;
credentials never in logs).

## Exact approval request

To unblock real-role SQL proof, the owner must provide ONE of:

**Option A (preferred): a disposable local stack.**
1. Confirm Docker may be installed/started on this machine (or name a machine
   where it already runs).
2. Approve: `$env:RESTAURANT_ACCOUNTING_DISPOSABLE_DB="1"; npm run test:restaurant:disposable`
   - Effect: `supabase start` (local containers), `db reset` (deletes ALL data
     in the LOCAL disposable database only), applies every ordered migration
     in `supabase/migrations`, runs the behavioral suites, then stops the
     stack unless `RESTAURANT_ACCOUNTING_KEEP_DB=1`.
   - Recovery: the target is created empty by Docker; nothing of value can
     exist there. Risk is confined to operator error if the command is run
     against a non-disposable project — the script refuses without the
     explicit opt-in flag.
3. For the cutover-activation suite additionally export the explicit target
   acknowledgement (it refuses without all three; only the host is ever
   echoed, never credentials):
   `$env:RESTAURANT_ACCOUNTING_TEST_DB_URL="<disposable URL>"; $env:RESTAURANT_ACCOUNTING_DISPOSABLE_ACK="destroy-data-on:<host>"`
4. On green, record: migration list applied, suite outputs, timestamps.

**Option B: a designated disposable cloud project.**
1. Owner supplies: project ref, confirmation it holds no real data, and a
   connection string via `RESTAURANT_ACCOUNTING_TEST_DB_URL` (never committed
   to the repo or logs).
2. Approve: applying all ordered migrations to that project, then
   `node --test tests/restaurant-accounting-behavioral.test.mjs tests/restaurant-recipe-depletion-behavioral.test.mjs`
   with `POS_SETTLEMENT_TEST_DB_URL` set for the settlement runner.
3. The suites use synthetic lodges/users only and assert `current_user`,
   role privileges, RLS denials (exact SQLSTATEs), and RPC behavior under
   `authenticated` and `service_role` JWT claims.

Do NOT point either path at the linked production project.

## What the suites prove (D3 mapping, already written)

- `tests/restaurant-accounting-cutover-activation.test.mjs` (Task A managed-platform repair,
  authored, NOT EXECUTED — safety refusal verified locally, fails loudly
  without approval, never skips): pure safety-configuration matrix (valid/
  missing/wrong, no connection opened) plus integration refusal
  pre-connection; explicit entitlement provisioning (licenses + override
  rows, verified from a single JSON-extracted `get_lodge_entitlement`
  result — commercial identity and flag from the same fetch — never
  assumed from a seed); assertions under ACTUAL
  `authenticated`/`anon` database roles (SET ROLE + session GUCs,
  current_user/jwt-role verified) covering preparer, reviewer, second
  checker, read-only manager, anonymous, and cross-tenant actors; actual
  EXECUTE grants/denials on the 6-argument approval signature via
  has_function_privilege; null/blank expected-hash approval rejected
  (22023); self-approval naming the reviewed hash rejected (42501); stale
  hash rejected (23505) and the full reviewed revision approves with the
  committed hash echoed; source-only re-preparation rejected (23505, batch
  stays prepared) with renewed review succeeding; preparer-only change
  rejected (23505); stored-vs-audit drift rejected (55000); missing stored
  hash rejected null-safely (23505); concurrent approvers serialize to
  exactly one winner (loser 55000); concurrent applies on independent
  sessions post one journal set with stored replay; invalid posting data
  rolls back with before/after journal counts equal and the earlier posting
  retained; full readiness prerequisites (v2 mappings effective 2026-01-01)
  with ready=true asserted before activation; complete tuple readback plus
  future-effective scheduled state; suspension preserves applied history.
  Fixture entry probes narrow managed-platform prerequisites first
  (`tests/helpers/disposable-prerequisites.mjs`: static requirement list,
  read-only live prober, pure evaluator — no superuser assumption; a
  sufficient managed non-superuser proceeds, gaps fail pre-side-effect
  naming the exact capability). Safety tests are environment-independent (pure matrix + isolated
  child-process refusal/valid-gate checks); the integration entry keeps
  requireSafety() on the actual environment and never connects unapproved.

## Task B POS attribution resume (migration-chain halt, not Accounting)

- Halt: `20260730100000_shared_till_operator_attribution.sql` stopped Task B's chain (P0001, contract-not-in-expected-form). Locally reproduced as a CRLF-matcher vs LF-definition mismatch, not a missing contract. Repaired in Task A (newline-portable strict transformation; zero/multiple-match errors kept; explicit already-installed branch; output verified before EXECUTE). New raw hash `da19b27f35272ce2854afb68ac32ba70c0744bdf2cd5602b11e24cec06a5178d` (canonical-LF `92e09d5632870f22540b8e69846f932d3e12118d0eb5efaa7314d71805ee4a4a`).
- Task B must NOT auto-replay changed already-applied files: this halt file is UNEXECUTED, so validate the new hash and resume within existing scope after confirming no partial effects on the SAME disposable project. The definer `20260711120000` (applied prefix) is untouched. Record committed transaction behavior, file-level execution status, and any checksum gaps separately; phantom-write reconciliation from the earlier incident stays Task B's lane, as do runner edits.
- Task B SQL acceptance for the resumed migration (disposable project only): capture `pg_get_functiondef('public.create_pos_order_v3(jsonb)')` BEFORE and AFTER; assert the new line `v_operator_id := coalesce(v_shift.cashier_id, v_actor_id);` present exactly once, the old `coalesce(v_actor_id, v_shift.cashier_id)` line absent, signature/security-definer/search-path/grants unchanged; then demonstrate behavior with a manager-unlock
+ PIN-staff shift order asserting operator = shift owner and audit actor = manager.
- Task B acceptance sequence must include the checkout-independent portability regression (`node --test tests/bar-migration-line-ending-portability.test.mjs`, also collected by `npm run test:bar`; final test hash `2401551ED20B981D45D5F195D48B96594035F9D426A432EFA5EAA3881D935408`) before final certification, so it is not omitted for sitting outside the old `restaurant-*` discovery pattern.
- Cross-lodge denial + payroll privacy under a real `authenticated` session
  (exact `42501`), capability matrix reads.
- Balanced immutable journals, payload-safe retry (same entry id +
  `replayed`), same-key/different-payload rejection (`23505`), direct
  mutation of entries/lines rejected (`55000`), audited reversals.
- POS order posting exactly once with replay (`replayed`), tender/category
  mappings, source references.
- AP invoice uniqueness, partial payments, overpayment/concurrency locks,
  payment journals with immutable links.
- Bank import duplicate control, match propose/approve separation, settlement
  matching, reconciliation completion rules.
- Tax versioned configuration, working papers from complete sources,
  amendments preserving history.
- Budget versions, statements reconciling (assets = liabilities + equity),
  exports matching UI totals.
- Payroll scoped reads/exports, prepare/approve/post/settle separation, no
  self-approval, statutory configuration presence.
- Period close/reopen enforcement with locks and audited reasons.
- Tenant-B isolation via IDs, filters, exports, and replay.
- Settlement atomic runner (`tests/run-pos-settlement-sql.mjs`): release CI
  must set `POS_SETTLEMENT_STRICT_RELEASE=1` so a missing
  `POS_SETTLEMENT_TEST_DB_URL` fails instead of skipping (both modes
  verified locally).

## Local preparation already complete

- `docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md`: 99 IPC operations mapped to
  exact deployed signatures, capabilities reconciled, anon excluded
  (executable guards in `tests/bar-accounting-matrix.test.mjs`, 7/7).
- Activation workflow UI + revision-bound review/approve + explicit apply
  step + fail-closed read-back reconciliation for both apply and approval
  (browser W0/W0b/W1/W1b–W7 plus X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b plus
  Y1/Y2/Y3, node activation tests 21/21).
- Forward migrations authored, NOT applied:
  `20260907010000` (timestamp repairs, scoped reads, authenticated grants),
  `20260908000000` (mandatory reviewed-hash binding on approval, grants
  nothing), and `20260908010000` (revision binding: drops the weaker 4-arg
  approval overload; single strong 6-arg form with null-safe source and
  preparer validation; authenticated + service_role on the new signature
  only).
- Strict skip behavior verified for both settlement and disposable runners.
