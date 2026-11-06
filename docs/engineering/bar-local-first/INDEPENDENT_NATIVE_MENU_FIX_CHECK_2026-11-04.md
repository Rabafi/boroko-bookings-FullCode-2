# Independent check of EV-202 Menu corrections — 4 November 2026

This is a follow-up to `INDEPENDENT_NATIVE_MENU_REVIEW_2026-11-04.md`; its original reproductions remain historical. No customer database, running app, hosted service or product-code change was involved in this verification.

## Finding status

1. **Generated direct-link/pack recipes mistaken for authored recipes: corrected and independently verified at adapter level.** `nativeHposMenu.js` now excludes stock-linked products only from the legacy `recipes` classification projection while preserving their full config. Expanded adapter fixtures cover base links, pack links and an authored recipe. The original independent direct-link fixture now yields `direct` and `hasRecipe=false`, retaining its actual product `track_stock` and tax fields.
2. **Tax/stock/archive state overwritten during limited edits: corrected and independently verified at adapter/source level.** The menu view now carries `tax_rate` and actual product `track_stock`; recipe saves forward current tax/stock/active fields. `HposProductWizard` supplies those authoritative read fields and archival state. `HposMenu` archival passes the product's current tax/stock flag. The original fixture now captures `0.14` rather than `0`, and the archived false/stock flag remain unchanged. Persistent SQL mutation and subsequent-sale tax are still unverified.
3. **Link-mode edit clears the selected stock ID: source corrected, database acceptance still pending.** Migration 0082 now explicitly preserves the validated link identity before the create-mode branch. This removes the previously identified nulling control flow. It does not prove that the whole migration, edit/pack transaction, stock depletion, rollback and retry behave correctly in PostgreSQL. Keep this acceptance item PARTIAL until executed in a positively identified new disposable cluster.

## Executed independent checks

- `node --test services/bar-local/tests/native-hpos-menu-adapter.test.mjs`: **7/7 PASS** (mocked runtime boundaries).
- `node --test --test-name-pattern="^(production client allowlists|every registered command has|command handler mappings|internal SQL helpers|every registered query has)" services/bar-local/tests/contract-surface-parity.test.mjs`: **5/5 PASS**, non-database registry/source parity.
- `node --test tests/bar-local/normal-hpos-local-routes.test.mjs`: **6/6 PASS**, source assertions rather than rendered screen acceptance.
- `node docs/engineering/bar-local-first/evidence/independent-2026-11-04/native-menu-fix-probe.mjs`: original synthetic direct-link and taxed-edit reproductions now pass corrected expectations; archive outgoing fields checked in source. The original bug-reproduction script is preserved unchanged.
- `npm.cmd run test:bar-local-electron`: **110/110 PASS**, journal/runtime/helper/render/source mixture, not installed native-screen-to-database acceptance.

Main/renderer typechecks and production/service builds reported by the author were not independently repeated in this focused follow-up. No new blocking defect was established in this limited check; it is not a comprehensive Menu parity audit.

## Still pending

C: measured 3,837,579,264 bytes free (approximately 3.57 GiB) during this review, below the 4 GiB guarded database-runner requirement. No database initialization, migration, guard relaxation or cleanup was attempted. Migration 0082 database acceptance, original Stock and Till integration, rendered original-screen/IPC/database acceptance and mixed-business offline sessions remain open. Continue those source changes while storage blocks DB runs. Do not apply this unverified migration to Rabafi as a test.

The original Menu route is retained; the simplified component must not become the operational fallback. Customer commissioning remains NO-GO. Physical additional-PC qualification, customer PDF/guide updates and hosted activation retain their existing deferred/unauthorized boundaries. No commit or push was performed by this review.
