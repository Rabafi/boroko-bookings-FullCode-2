# Independent original Menu wiring review — 4 November 2026

Scope: user-pasted continuation for original Menu adapters, migration 0082, modifier/recipe/promotion integration and Stock panel count/waste controls. Earlier reviews remain historical. Source and focused adapter/registry checks only; no customer DB, hosted services, running app or product remediation was used.

## Verdict

**Real progress, incomplete and not yet safe to qualify.** `/hpos/menu` now mounts the actual original `HposMenu` component (`LocalBarHposShell.jsx:157`), rather than the simplified replacement. `/hpos/pos` and `/hpos/stock` still mount `BarLocalWorkspace`. Migration 0082 and its database acceptance have not been executed in this review. Three actionable defects remain below.

## Prioritized findings

### P1 — Valid direct stock links are exposed to the original Menu as conflicting recipes

`src/main/bar-local/nativeHposMenu.js:81` maps all service product recipe lines into the UI's `recipes` list, including the generated depletion recipe for a direct stock link. Although `config.products[].stock_linked` is marked separately, the `recipes` projection does not distinguish that internal representation.

The original Menu builds `recipeMenuItemIds` from every positive ingredient line (`HposMenu.jsx:614` onward). `stockMethodFor` at line 1056 marks an item with both `inventory_item_id` and such a recipe as `conflict`. `openWizardFor` at line 411 also passes `hasRecipe=true`; `HposProductWizard.jsx:395` consequently selects the restricted recipe-edit branch and hides stock/pack controls rather than the stock-linked product workflow.

Executed synthetic adapter probe reproduces `classification:"conflict"`, `wizard_has_recipe:true` for a valid direct stock-linked product whose generated recipe consumes its base stock. This is adapter execution plus traced original UI predicates, not a rendered Chromium/database reproduction. Fix the compatibility projection/classification to distinguish generated direct-link depletion recipes from independently authored recipes; keep database protection intact. Test initial load, post-mutation refresh and wizard reopen for base products and packs, alongside actual recipe products.

### P1 — Recipe editing silently resets the tax rate; archival also overwrites tax

`nativeHposMenu.js:129` constructs `catalogue.upsert` for `local_recipe_update` with `tax_rate:'0'`, `track_stock:false` and `active:true`, regardless of the authoritative current product. A probe of the actual adapter confirms an input carrying the existing `0.14` tax rate is sent as `0`. The current wizard does not pass the current tax through this branch either. Thus existing taxed products cannot retain their tax contract by this path. The query `menuRow` projection also omits tax_rate, making a faithful round trip unavailable.

The local archive branch at `HposMenu.jsx:907` likewise sends `tax_rate:'0'` while ostensibly only archiving. It uses UI-derived `track_stock` (based on stock link) rather than necessarily the actual catalogue flag. Preserve unrelated authoritative fields rather than rewriting them during limited edits or archival. Add narrow scoped/versioned commands or complete validated readback where appropriate; do not force a financial default. Verify taxed product editing/archive against PostgreSQL and subsequent sale tax, not only spy output.

Executed probe confirms the outgoing recipe-edit mutation; the database mutation and resulting sale were not executed. Existing committed sale records were not changed by this review.

### P1 — Existing linked-stock edits clear the stock ID in migration 0082

`0082_atomic_bar_product_save.sql:321-339`: inside the existing-menu edit branch, only `v_mode='create' AND track_stock` retains/creates a stock identity; its `ELSE` sets `v_stock_id := NULL`. This also runs for valid `stock_mode='link'`, despite the stock row and versions having been validated and locked earlier.

The subsequent link/recipe update is skipped; enabled pack recipe writes later use that null stock ID as ingredient, conflicting with required recipe identity, and the receipt at line 455 reports null inventory identity. At minimum the intended linked edit semantics are not preserved. The authored database test at `db-atomic-bar-product-save.test.mjs:92` explicitly exercises this link-edit plus enabled pack case, but has not run.

This is a source-confirmed control-flow defect; SQL execution/observed error remains unverified. Preserve the selected locked stock identity for link mode, then verify depletion changes, exact shared inventory, packs/barcodes, availability, no repeated opening stock, stale-write refusal and rollback on errors. Do not apply this migration to Rabafi as a way to test it.

## Independent executed checks

- `node --test services/bar-local/tests/native-hpos-menu-adapter.test.mjs`: **6/6 PASS**. These use mocked runtime boundaries, not a database. Current direct-link test has no recipe lines and therefore misses finding 1.
- `node --test --test-name-pattern="^(production client allowlists|every registered command has|command handler mappings|internal SQL helpers|every registered query has)" services/bar-local/tests/contract-surface-parity.test.mjs`: **5/5 PASS**. Static/source/registry parity only; not migration execution or HTTP/DB role enforcement.
- Reviewer probe `node docs/engineering/bar-local-first/evidence/independent-2026-11-04/native-menu-adapter-probe.mjs`: reproduced two issues above, not feature passes. It uses synthetic records and captured commands; no network/DB. Initial attempt failed before execution because the review script's relative import had one extra parent directory; fixed and rerun successfully. This was a reviewer harness error.
- Initial parity invocation used an overly broad name pattern and also selected its DB-dependent HTTP test. That test refused before connection because no isolated target was configured; the five parity checks passed. Corrected selection above passed. This is an environmental guard result, not a failed HTTP functional assertion.
- Scoped `git diff --check` passed (line-ending advisory only). Author-reported 17-test total, typechecks and builds were not independently repeated in full at this checkpoint.

## Other scope and limitations

Physical count and approved lot waste controls are present in the local operations panel, mapped to `stock.stocktake` and `stock.lot.waste` with selected product/lot/version/reason/PIN inputs. This does not connect original `HposStock`, nor does source prove real approval/stock/audit behavior.

C: readings fluctuated during review, from approximately 1.35 GiB to 2.61 GiB free; both are below the 4 GiB isolated-runner minimum. No DB runner, cleanup, customer migration or runtime restart was performed. Missing DB execution remains an explicit gate. Proceed with source fixes and original Stock/Till adapters without bypassing the guard. Physical-PC and user-deferred PDF/guide work remain pending. Hosted activation, push and release remain outside this review.

Implementation completeness: **incomplete**. Customer commissioning: **NO-GO**. Keep the original Menu route and complete its local semantics rather than returning to simplified UI.
