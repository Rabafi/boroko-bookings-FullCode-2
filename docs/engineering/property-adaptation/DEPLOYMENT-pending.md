# Property adaptation — deployment manifest (awaiting deployment)

Date: 2026-10-15 (Africa/Gaborone). Status: **code complete, NOT deployed**.
No production migration applied, no customer reclassified, no installer
published in this pass. This note replaces the earlier deployment note that
recommended an unqualified single `db:push` and misdescribed the
quotation-carry patch as reapply-idempotent.

## 1. Production baseline (read-only evidence, 2026-10-15)

A SELECT-only probe (read-only transaction, rolled back, zero writes) against
the linked project `oicgpknsmtvcsjacymum` returned:

- latest applied migration: `20261005090000`
  (then `20261005080000`, `20261005070000`);
- present: `accommodation_booking_expected_total`, `create_campsite_booking`,
  `create_multi_room_booking`, `convert_quotation_to_booking_pre_intent_v1`
  (pre-fix form), tables `booking_accommodation_details`,
  `booking_create_intents`, `booking_group_create_intents`;
- absent: `preview_property_type_change`, `commit_property_type_change`,
  `get_property_type_transition_status`, table `property_type_transitions`.

Conclusion: the whole property-adaptation chain below is awaiting
deployment. (The Management-API SQL path timed out twice with 544; the
direct read-only probe above is the deployment evidence.)

## 2. Exact pending chain for this feature (apply in order)

| # | Migration | Contents | Depends on |
|---|---|---|---|
| 1 | `supabase/migrations/20261014010000_property_type_transitions.sql` | Transition ledger table + preview/commit/status RPCs + grants | Baseline through `20261005090000` (uses `settings`, `users`, `app_sessions`, app-session helpers) |
| 2 | `supabase/migrations/20261014020000_property_type_transition_lodge_scope_deny.sql` | Explicit lodge-scope deny on all three RPCs (redefines them) | #1 (redefines #1 bodies) |
| 3 | `supabase/migrations/20261014030000_campsite_quotation_conversion_carry.sql` | Part A: one-time zero-fill patch of `create_multi_room_booking`; Part B: full replacement of `convert_quotation_to_booking_pre_intent_v1` | Booking-intent migrations through `20261005090000` (`create_multi_room_booking` must exist in its pre-patch form) |
| 4 | `supabase/migrations/20261014040000_property_transition_receipt_first.sql` (NEW) | R1 receipt-first replay + full-precision fingerprint v2 (v1 dual-accept) + R2 source-family helper/checks + version-bound expectations; redefines preview + commit | #1 + #2 (redefines their bodies) |
| 5 | `supabase/migrations/20261014050000_settings_classification_guard.sql` (NEW) | R3 `BEFORE UPDATE OF property_type, business_type` guard trigger + owner-only guard function | #4 (references the `app.property_transition_writer` flag the commit sets; applies independently but must land with/after #4) |
| 6 | `supabase/migrations/20261014060000_campsite_priced_tent_kind.sql` (NEW) | R7 `_is_campsite_priced_kind` helper + eight asserted gate patches (expected-total, create/update/reschedule, multi-room x2, room-expected-total, quotation conversion, stay-total helper) | #3 (patch target `convert_quotation_to_booking_pre_intent_v1` must exist in its #3 form) + campsite pricing baseline (`20260711200000`, `20260904090000`) |

At apply time the six touch no existing bookings, ledgers, rates, stock or
settings rows (DDL + function replacement + asserted string patches only).
#3 Part A, #6 patches, and the #4/#5 redefinitions write no data rows.

## 3. Deriving the pending list (dry run first)

The repository's Supabase CLI (`node_modules/supabase`, v2.119.0 at the
time of writing) supports a dry-run flag — verified via
`npx supabase db push --help`:

```sh
npx supabase db push --dry-run
```

Expected dry-run result for THIS feature: exactly the six migrations in
§2, in order, and nothing else. If the dry run lists anything else, stop:
those are unrelated backlog and must be dispositioned separately (see §4).

## 4. Unrelated backlog must NOT ride along

The working tree contains other unapplied candidates that are NOT part of
this feature — notably
`supabase/migrations/20261015010000_pos_historical_sale_replay_v1.sql`
(POS historical-sale replay, unrelated product path) and any other
migrations outside the §2 chain. An unqualified `supabase db push` applies
EVERYTHING pending on top of the remote history, which would deploy
unrelated financial/Bar/POS contracts as an unreviewed side effect.

Rule: deploy exactly the §2 chain. If `db push` cannot be scoped to the
chain (its granularity is the whole pending set), apply the six files in
§2 order through the approved explicit-SQL path against the target and
record them in the migration history the same way `db push` would; do NOT
blanket-push while unrelated backlog is pending. Either way, re-run the
§3 dry run afterwards to confirm the feature entries cleared and nothing
unexpected moved.

## 5. One-time-patch disclosure (corrected)

The earlier note called all three prior migrations "reapply-idempotent".
That was inaccurate for exactly one construct:

- `20261014030000` **Part A** (zero-fill replacement in
  `create_multi_room_booking`) asserts it found exactly one match site. On
  reapply it finds zero and RAISES — by design, fail closed instead of
  double-patching. The same holds for the eight gate patches in
  `20261014060000`. This is intentional one-time-patch behavior, not a bug.
- Everything else (`CREATE OR REPLACE` functions, `DROP TRIGGER IF EXISTS`
  + `CREATE TRIGGER`, re-issued grants/comments, `CREATE TABLE IF NOT
  EXISTS`) is safe to re-apply: normal forward migrations apply once via
  the history table, and re-running their DDL statements is harmless.

Operational consequence: a failed deploy that died INSIDE Part A or a #6
patch block rolls back its transaction; a deploy that COMPLETED them must
not be "re-applied from scratch" by hand-editing history — use §6 recovery
instead.

## 6. Rollback / recovery (no destructive ledger drops)

- #1/#2 (not yet deployed): rollback means "do not apply". After
  deployment, restoring the pre-#4 RPCs means re-applying the checked-in
  #2 definitions; the `property_type_transitions` table must NEVER be
  dropped while it holds rows — gate on
  `select count(*) from public.property_type_transitions` first and keep
  the ledger even if the RPCs are reverted.
- #3: pure function replacement. Recovery = re-apply the prior checked-in
  definitions (inner convert from `20260618180000`, multi-room from
  `20261005090000`). Effect: single-line campsite conversions silently drop
  occupancy again (the original gap) — a known, bounded regression, not
  data loss.
- #4: function redefinition only. Recovery = re-apply the checked-in #2
  definitions (restores stale-first ordering — reopens R1 until a fixed
  forward migration lands). The `_property_transition_family` helper can
  stay (nothing references it after rollback) or be dropped; either is safe.
- #5: trigger only. Recovery = `DROP TRIGGER
  settings_property_transition_guard ON public.settings` (plus optionally
  dropping the guard function). Safe at any time; ordinary saves return to
  domain-guard-only behavior.
- #6: asserted patches only. Recovery = targeted re-patch of each gate
  back to `= 'campsite'` / `<> 'campsite'` form (mirror the #6 blocks with
  swapped old/new fragments); the helper can stay or be dropped after the
  gates no longer reference it. No data UPDATEs are involved, so no
  backfill exists to undo; history is never repriced by #6 in either
  direction.
- In all cases: never drop `property_type_transitions`,
  `booking_accommodation_details`, or financial ledger tables as "rollback".
  There is no data migration to backfill.

## 7. Smoke checks (post-deploy: disposable first, then linked read-only)

1. `node --test tests/property-type-transition-sql.test.mjs`
   (needs `LUNA_REMEDIATION_*` disposable credentials; genuine skip
   without them)
2. `node --test tests/property-transition-receipt-sql.test.mjs`
   (same gate; R1/R2/R3 live matrix + always-on static marker guards)
3. `node scripts/verify-property-transitions-disposable.mjs`
   (same gate; Phase A base contract + Phase B forward corrections)
4. Routine-presence queries (read-only; run against disposable after
   apply, then against linked to confirm deployment):
   ```sql
   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and proname in ('preview_property_type_change',
                      'commit_property_type_change',
                      'get_property_type_transition_status',
                      '_property_transition_family',
                      '_property_transition_guard_classification',
                      '_is_campsite_priced_kind');
   select tgname from pg_trigger
    where tgname in ('settings_property_transition_guard',
                     'settings_provision_bar_mode_default_outlet',
                     'settings_bar_offline_trading_window',
                     'settings_trial_anchor_guard');
   select to_regclass('public.property_type_transitions');
   ```
   Expect all six functions, all four triggers, and the ledger table.
5. Re-run the §1 routine/table probe and confirm the seven routines +
   ledger table are present and the latest migration is `20261014060000`
   (for this feature's chain).
6. Desktop smoke (no customer reclassification): open Settings → Property
   type on an isolated fixture profile, preview a transition, confirm
   blockers render; convert a single-line campsite quotation on fixtures
   and confirm tents/vehicles + details row.

## 8. Release coordination

Desktop (Settings lifecycle, Bookings/Quotations carry), Manager PWA (no
change), booking-site (no change), Legacy POS (no change) and Supabase
migrations move independently per docs/ARCHITECTURE.md. The feature is
operational only when the desktop build containing this pass AND all six
§2 migrations are deployed. Migration application and releases require
explicit existing user authorization; this note does not authorize them.
