# LodgingOS public-booking correction — independent verification

Date: 2026-10-22 (Africa/Gaborone). Verdict: **CHANGES REQUIRED**.

The local handover's passing tests/builds were independently rerun, but review found contract defects in the proposed migration and database verification artifacts. These findings are source-contract conclusions, not claims of live PostgreSQL reproduction. No application implementation was edited, no migration was applied, and no database records were written during this review.

## R1 — P1: private grouping rejects the actual lead booking key

`supabase/migrations/20261022090000_lodgingos_public_booking_server_group_and_child_tokens.sql:62` requires every booking's `create_idempotency_key` to equal `p_operation_key || ':' || room_id`.

The producer in `20260703153000_public_booking_offers.sql:348` intentionally writes the original bare operation key for the first child and a suffixed key for subsequent children. The new migration changes tokens, group creation, and the group key; it does not change that booking-key contract. Consequently the first child cannot join `v_expected_ids`, which becomes distinct from the supplied child IDs. Valid multi-room requests are rejected rather than grouped.

Correction: preserve the existing producer contract and validate the bare key for ordinality 1 and the exact room-suffixed key for later lines. Test a real two-child request through the public envelope; keep substitution, ordering, and scope rejection tests. Do not loosen this to an arbitrary key-prefix match.

## R2 — P1: private grouping checks the wrong guest-email field

The same migration at line 83 compares the customer email against `v_payload->>'email'`. The real booking form, public legacy producer (`20260703153000...:167`), and SQL acceptance all use `guest_email`. The wrapper stores the original request payload without renaming that field.

Correction: validate the same normalized `guest_email` consumed by the authoritative producer. A normal request has a nonempty customer email and no `email` property, so the current expression compares the actual email with an empty string and rejects the group independently of R1. Prove the actual form-shaped request succeeds and a substituted customer is rejected.

## R3 — P1: migration disables the desktop staff-session transport

The migration at lines 151–154 revokes PUBLIC/anon execution of `create_booking_invoice_group` and grants only authenticated execution. The desktop's custom backend session is not a Supabase Auth JWT: `src/main/domains/authClients.js` builds the data client using `SUPABASE_ANON_KEY` and the `x-boroko-session` header. `src/main/domains/bookings.js:195` directly invokes this RPC; line 249 queues the same RPC for replay.

After this migration those staff calls are denied at the PostgreSQL EXECUTE boundary before `app_require_lodge_role` can validate their app session. Keeping the function body unchanged does not preserve the workflow when its transport grant is removed.

Correction: retain the anon API-key transport required by legitimate custom staff sessions while preserving the RPC's in-body actor, lodge, role, and PWA restrictions. Prove an authorized desktop session succeeds and a genuinely unauthenticated anon caller is denied. Keep the new private helper revoked from public clients. The current source-text test asserting that anon transport must be revoked encodes the wrong requirement and must change.

## R4 — P1: required database runner still cannot validate the current contract

`scripts/verify-property-transitions-disposable.mjs:104` requires `classification_locked` to occur inside the commit definition. That marker belongs to the separate classification trigger function from migration 05, not the commit function from migration 04. Thus a correctly deployed current schema fails the new preflight.

Further obsolete behavior remains:

- Lines 166–168 call commit with both expectations null and expect success. The current server returns `VALIDATION_FAILED` with `expectations_required`.
- Lines 226–230 call preview with null expectations while counting 20 successful previews; current preview rejects these. The loop variable `from` never changes the actual source classification, so even removing the null expectations would not prove all 20 source/target pairs.
- A caught `23505` inside an explicit PostgreSQL transaction is followed by more queries without a savepoint/rollback; subsequent queries encounter an aborted transaction.
- Wrong-lodge verification directly reads the private transition ledger as anon. The previously verified disposable baseline denies that SELECT.
- Later trigger checks likewise assume direct anon UPDATE of settings, which that baseline denies; catching an UPDATE exception does not restore the transaction.

Correction: rebuild the acceptance flow around the current RPC contracts, explicit request boundaries/savepoints, and verifier-only inspection of private records. Inspect the actual trigger binding/function instead of requiring its text in the commit function. Preserve complete expected timestamp precision when round-tripping through node-postgres. Schema inspection must not reapply historical migrations.

The configuration gate itself is improved: its invalid-URL subprocess test now independently passes with exit 2. That negative result does not prove a valid database can pass the remaining runner.

## R5 — P1: SQL acceptance cannot reach the claimed group checks accurately

`tests/public-tent-booking-acceptance.sql:278` generates `public-acceptance-transition-<uuid-without-hyphens>` as the property-transition operation key. The server requires a UUID and returns `INVALID_IDEMPOTENCY_KEY` before this preservation assertion can pass. Its settings fixture at lines 151–154 also omits `setup_complete`; the baseline defaults it to false, while the transition requires completed setup. This section precedes the mixed-group tests.

There is also request-context contamination: `luna_commit_property_type_as_admin` sets `app.session_token` at line 74 and never restores it. The public-call helper at lines 44–61 changes role/JWT role but does not clear that token. After the preservation transition, later purported anonymous group requests retain the admin app session until the outer transaction ends. This can hide the staff-session authorization defect the test is supposed to detect.

Correction: use a real UUID, a completed settings fixture, and explicitly isolate/clear app-session and request-header context for every anonymous call. Restore context after helper calls or use separate explicit request boundaries. Exercise a no-session public group and staff-authenticated grouping separately. Move preservation checks after a real group exists if preservation of populated groups is claimed; currently group counts are zero at that earlier checkpoint.

## Independently executed checks

| Check | Result |
|---|---|
| Focused Node command from the handover: disposable gate, quotation SQL, public group hardening, verified booking contracts | 32 tests: 31 pass, 1 genuine live-DB skip |
| Production BookingPage and PropertyTypeSection mounted tests | 42/42 pass |
| `npm run typecheck:shared` | Exit 0 |
| `npm run typecheck:renderer` | Exit 0 |
| `npm run test:offline-queue-critical` | Exit 0 |
| `npm run test:queue-replay-authority` | 9/9 pass |
| Root `npm run build` (lodge-camp) | Exit 0; main/preload/renderer built |
| Booking-site `npm run build` | Exit 0 |
| Independent source-backed contract counterexample script | Exit 1, reproducing four concrete contract contradictions; deliberately not presented as live SQL acceptance |
| Scoped `git diff --check` over the edited driver/tests/deployment note | Exit 2: deployment note line 48 has an extra blank line at EOF; minor, not a functional blocker |

The four public-group hardening tests primarily assert source text. They pass despite R1/R2 and explicitly assert the problematic transport restriction from R3. Mounted tests mock RPC responses and therefore do not execute the new PL/pgSQL helper. Passing these suites does not contradict the findings.

## Database verification limits

The Management API token is available. A sandboxed read-only marker probe hit network EACCES; an approved escalated retry reached Supabase but returned HTTP 544, connection timeout, before the marker could be read. The existing ignored disposable configuration was also tried through the guarded identity helper; it returned a suppressed PostgreSQL XX000 connection/marker failure. Neither path established a valid current target identity. No mutation or migration application was attempted.

Raw credential-free probe evidence and concrete source-contract counterexamples are under `evidence/independent-2026-10-22/`. No credentials are included in these reports. No fresh production-schema claim is made. No Electron walkthrough was performed in this review.

## Required next pass

Fix R1–R5, add behavioral regression coverage that fails on the current defects, and rerun the current-schema acceptance with a verified disposable target. Prove private-helper denial, authorized desktop staff-session access, genuinely anonymous public groups, exact replay, token binding, rollback of partial groups, and populated-record preservation. Run quotation SQL acceptance too. Then obtain another review before production deployment.

Bar manual impact for this review: no manual update required; only review artifacts and an engineering state note were written. The implementation's staff-transport effect is identified above rather than accepted as unchanged behavior.
