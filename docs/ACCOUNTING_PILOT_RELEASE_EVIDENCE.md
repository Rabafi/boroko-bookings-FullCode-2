# Accounting Pilot Release Evidence

Status: **EMPTY — no pilot, activation, signing, or publishing has occurred.**
This file defines the exact record required before any release claim. Do not
fill it with local-build or mock evidence.

## Required approvals (one coherent release approval, before external changes)

- [ ] Exact Supabase project/environment and tenant(s) for pilot.
- [ ] Migration IDs to apply and their reviewed effects.
- [ ] Backup/restore checkpoint confirmed (with restore drill result).
- [ ] Activation effective date, configuration/policy versions, cutover
  decision (batch id or explicit no-history statement).
- [ ] Exact signed artifact + version (checksum + signature verification).
- [ ] Pilot devices/operators, product feed/channel, publish destination,
  rollout scope.
- [ ] Abort thresholds, responsible owner, rollback/suspension procedure.
- [ ] Product version number for the candidate (current tree: 1.5.7, unchanged).
- [ ] Code-signing inputs (`CSC_LINK`/`CSC_KEY_PASSWORD` or equivalent) and
  GitHub publish token/scope for `scripts/release.mjs publish`.
- [ ] Real-device inventory for acceptance (printers, scanners, drawers,
  network conditions) or explicit hardware exclusions.

## Ordered execution (typical)

1. Confirm backup/recovery readiness and current schema.
2. Apply reviewed forward migration to the approved target.
3. Verify deployed grants/functions/readiness using normal client roles.
4. Install the approved candidate on pilot device(s).
5. Complete approved tenant configuration/cutover/approval/activation.
6. Verify source-to-ledger reconciliation and permitted/denied access.
7. Publish to the approved channel when pilot criteria pass.
8. Verify feed metadata and the downloaded installed version/signature.
9. Monitor defined errors/reconciliation/activation failures; report evidence.

Abort on: authorization leakage, unbalanced posting, duplicate effects,
uncertain cutover, restore failure, signature mismatch, incompatible schema.
Suspend new posting via `suspendAccounting` (reason required); never
delete/reverse real history as a deployment rollback.

## Evidence slots (fill on execution)

| Step | Command/scenario | Role | Timestamp | Result | Evidence path |
|---|---|---|---|---|---|
| Migration apply | | | | | |
| Grant/readiness verify | | | | | |
| Clean install | | | | | |
| Upgrade + queue retention | | | | | |
| Activation journey (operator) | | | | | |
| Denied-role journey | | | | | |
| Connection-loss retry/restart | | | | | |
| Two-client concurrency | | | | | |
| Backup/restore drill | | | | | |
| Feed + signature verify | | | | | |

## Operator acceptance journey (synthetic venue, signed build)

Inactive → configured → ready → approved → active → ordinary posting →
suspend → authorized retained history, plus: restricted-operator denial,
connection loss during posting/activation with retry and restart, and
two-client concurrency affecting ledger source operations.
