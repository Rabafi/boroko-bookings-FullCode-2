# LodgingOS property adaptation — deployment status

Date: 2026-10-22 (Africa/Gaborone). Status: implementation corrections are in the working tree; deployment and live disposable acceptance are NOT verified.

No production migrations, customer reclassification, installer publication, or release deployment were performed. The approved disposable project could not be revalidated in this environment: no LUNA_REMEDIATION_TEST_DB_URL is configured, and the read-only Supabase Management API request failed at the network connection layer. The disposable marker was therefore not checked and no database mutation was attempted.

## Current feature migration sequence

The adaptation depends on the previously established booking, campsite pricing, public booking envelope, and invoice-group schema. The feature migration sequence is:

| Order | Migration | Purpose |
|---|---|---|
| 1 | 20261014010000_property_type_transitions.sql | Property transition ledger and preview/commit/status contracts |
| 2 | 20261014020000_property_type_transition_lodge_scope_deny.sql | Explicit lodge-scope denial in transition RPCs |
| 3 | 20261014030000_campsite_quotation_conversion_carry.sql | Carry tent occupancy through quotation conversion |
| 4 | 20261014040000_property_transition_receipt_first.sql | Receipt-first transition replay and guarded transition contracts |
| 5 | 20261014050000_settings_classification_guard.sql | Server-side settings classification guard |
| 6 | 20261014060000_campsite_priced_tent_kind.sql | Campsite-priced tent-kind parity across booking and quotation gates |
| 7 | 20261014080000_public_priced_tent_parity.sql | Public priced-tent parity and public room/rate validation |
| 8 | 20261018010000_public_booking_single_receipt_null_safe.sql | NULL-safe single-request receipt validation |
| 9 | 20261022090000_lodgingos_public_booking_server_group_and_child_tokens.sql | Unique child confirmation tokens and envelope-bound private invoice-group creation |

The latest migration is a forward correction. It is not recorded as applied in the available evidence. The 20261021090000_bar_addon_dependencies_and_prices.sql migration is unrelated Bar work and must not be included in a LodgingOS deployment.

The first eight entries were explicitly applied to the approved disposable schema during the supervised October 18 work, but those applications did not register migration-history rows. That is historical evidence only; the target and marker must be rechecked before any future mutation. Never infer schema state from migration history alone.

## One-time patch cautions

Several feature migrations use asserted function-body patches and are intentionally not safe to replay manually after successful application. In particular, the zero-fill patch in 20261014030000 and the asserted gate patches in 20261014060000 fail closed when their expected old fragments are absent. The 20261022090000 correction also asserts exact patch anchors in create_online_booking_legacy. Inspect the live function definitions and migration history before applying anything. Do not replay migrations 01/02 or historical patches through the acceptance runner; the runner must inspect the current schema only.

Before a future migration, verify the actual schema and exact migration status on the approved disposable project, confirm the marker row, and apply only the approved feature chain in dependency order. Do not use an unqualified db push while unrelated migrations are pending. Re-run the disposable acceptance after the forward correction is applied, then verify the linked production schema read-only. Production deployment requires a separate approved release decision and explicit migration plan.

## Verification status as of this handover

Fresh local verification is recorded in LOCAL-VERIFICATION-2026-10-22.md. The follow-up correction addresses all five findings in INDEPENDENT-REVIEW-2026-10-22.md: child idempotency keys, guest email field, custom-session staff RPC transport, transition runner contracts, and request isolation/populated-group preservation in public acceptance. Further reviews prompted fixes for approved project/endpoint pinning, safe pg client construction without raw URL query overrides, Supabase TLS certificate verification, transition-runner helper import, strict quotation SQL gating, and savepoint rollback around the expected quotation mismatch error. The final independent source review found no remaining source-level issue in these fixes. SQL acceptance itself remains unexecuted. `npm run test:property-transition-db`, `npm run test:public-booking-db`, and `npm run test:campsite-quotation-db` block with exit 2 because the required remediation database URL and identity configuration are absent. These guards never apply migrations; their local negative probes do not establish database acceptance.

Historical evidence is under evidence/supervised-2026-10-18/. Those results must not be presented as current acceptance. In particular, the October 18 public-booking acceptance failed on duplicate child confirmation tokens and staff-only invoice-group authorization. The new forward migration addresses those failure points in code, but the live behavior remains unverified until it is applied to a revalidated disposable target and the full SQL acceptance passes. The final source re-review is complete; disposable runtime acceptance and production read-only schema verification remain open.

## Bar manual impact

No manual update required. This change is confined to LodgingOS public-booking database contracts, idempotency, confirmation tokens, and an internal server-only invoice-group helper. It changes no Bar setup, navigation, controls, permissions, daily workflow, financial or stock behavior, recovery guidance, equipment support, or available Bar features. No customer manual was edited.

## Walkthrough and release boundary

Mounted React tests cover the production booking components; they are not an Electron walkthrough. No renderer or Electron workflow was changed by this database-focused correction. Any desktop verification should be reported separately from mounted tests and harness screenshots.

This repository state is not release-ready until the new migration is applied only after disposable marker verification, the required public-booking and quotation SQL acceptance suites pass on that disposable target, the linked production schema is checked read-only, and the release runbook gates are satisfied. No production deployment or installer publication is claimed.
