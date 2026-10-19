# Prompt to start B02-A

B01 has been independently ACCEPTED. Read docs/engineering/typescript-migration/evidence/B01-acceptance.md and implement ONLY docs/engineering/typescript-migration/B02A_ASSIGNMENT.md.

Start now within that exact scope. Preserve AGENTS.md, current dirty work, the migration plan, and accepted B01. Before edits, retain actual contents/hashes of each editable existing file and full status; do not repeat the earlier snapshot gap.

This batch creates strict shared-pure checking for product-config plus src/shared/brandIdentity.js. Keep all runtime statements/imports/exports unchanged; brandIdentity edits are comments/JSDoc only. No dependency/lockfile changes, file renames, financial/RPC/queue logic, deployment, or broader B02 scopes.

Important: arbitrary string getProductBrand lookups currently can return inherited prototype functions. The reviewer verified that pre-existing behaviour. Use the assignment's conservative unknown return/string-index type; do not claim every string returns ProductBrand and do not fix the runtime behaviour in this typing batch.

Implement the exact config, real-source positive/negative fixtures, two new scripts, and self-check runner described in the assignment. Assert effective checkJs:true for this scope while leaving B01's checkJs:false design intact. Require actual checking of both production files, strict/environment guards, precise intended diagnostics, file inventories, and failure sensitivity. Negative fixtures are compile-only.

Run the assigned baseline/final checks and builds serially, saving durable logs. Prove syntax/value equivalence against captured pre-edit source. Preserve all B01 regressions. Report baseline failures and unavailable checks honestly; never weaken tests/types or widen scope to get green results.

Record exact coverage, manual impact, honest getter uncertainty, attributable patch/rollback instructions, and full self-review. Update B01's recorded status with a link to acceptance; do not rewrite the historical independent reviews.

Return the B02-A packet and STOP with reviewer status PENDING. Desktop main/preload/renderer, PWA, Legacy, Deno configurations, and B03 are not authorized.
