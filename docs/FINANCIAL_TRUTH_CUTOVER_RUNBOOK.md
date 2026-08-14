# Financial-truth cutover runbook

Status: local implementation only as of 2026-08-07. This runbook is a controlled enablement procedure, not evidence that the linked database is ready.

The cutover tool is read-only by default. It uses the authoritative Supabase RPCs and posted journal/source rows through a service-role database connection; it never reads desktop caches or client estimates. The actor ID is required so audit context is explicit. Do not print or commit the database URL.

## 1. Dry-run historical coverage

Set a disposable or approved database URL and an independent accounting actor:

```powershell
$env:FINANCIAL_TRUTH_CUTOVER_DB_URL = "postgresql://..."
$env:FINANCIAL_TRUTH_CUTOVER_ACTOR_ID = "<accounting-operator-user-id>"
npm run audit:financial-truth-cutover -- --lodge-id <lodge-uuid> --cutover-date 2026-08-01 --period-end 2026-08-07 --output .\evidence\cutover-lodge-2026-08-01.json
```

The packet must include source counts and totals for candidate, posted, already-posted, reversible, missing-configuration, and unpostable-without-evidence records. It also records the source manifest hash, readiness, post-cutover coverage, journal balance drift, blocking reconciliation exceptions, and every account balance used in control reconciliation.

Any blocker is a no-ship result. A dry-run exit code of `2` means the packet was produced but is not safe to approve; connection, migration, capability, or query errors exit `1` and produce no approval evidence.

## 2. Prepare a deterministic batch

Opening balances must be a reviewed JSON array of objects with `account_id`, `equity_account_id`, `entry_date`, and non-zero `amount`. Preparation is an explicit mutation and captures the current dry-run source manifest and hash:

```powershell
npm run audit:financial-truth-cutover -- --prepare --lodge-id <lodge-uuid> --cutover-date 2026-08-01 --opening-balances-file .\evidence\opening-balances.json --operation-key cutover:<lodge-uuid>:2026-08-01 --output .\evidence\cutover-prepared.json
```

Preparation is idempotent by lodge/date and operation key. It cannot replace an approved or applied batch. It does not post historical rows or silently rewrite source history.

## 3. Independent approval

The preparer and reviewer must be different users. Review notes and the unchanged opening-balance/source manifest hashes are required:

```powershell
npm run audit:financial-truth-cutover -- --approve --lodge-id <lodge-uuid> --cutover-date 2026-08-01 --batch-id <prepared-batch-uuid> --review-notes "Reviewed source counts, evidence, mappings, control totals and opening balances." --expected-opening-payload-hash <hash> --output .\evidence\cutover-approved.json
```

Approval fails closed if any source lacks configuration/evidence or if the source manifest changed after preparation. The reviewer, notes, hashes, control totals and approval event are retained on the batch.

## 4. Activate only after all release gates

Activation first applies the approved opening balances through `post_restaurant_opening_balance` using deterministic `cutover:<batch-id>:opening:<account-id>` keys, then marks the batch applied and activates Accounting. It remains service-role-only until the exact vertical slice has passed and grants are restored one RPC at a time:

```powershell
npm run audit:financial-truth-cutover -- --activate --lodge-id <lodge-uuid> --cutover-date 2026-08-01 --batch-id <approved-batch-uuid> --configuration-version coa-v1 --policy-version bar-accounting-financial-truth-v1 --output .\evidence\cutover-activated.json
```

Before activation, the release owner must have: disposable migration/concurrency/isolation evidence, zero affected linked lint/advisor errors, authenticated role/lodge/outlet smoke evidence, policy/statutory sign-off, complete page exports, and the sale-to-close/AP/payroll/bank/tax/statement rehearsal recorded in `docs/DEPLOYMENT_EVIDENCE_MATRIX.md`.

After activation, rerun the dry-run packet for the post-cutover period and complete one internal/test-lodge close cycle. Do not restore commercial Accounting navigation until source coverage is 100%, statements and exports are complete, reconciliation exceptions are resolved, and the deployment matrix is signed off.
