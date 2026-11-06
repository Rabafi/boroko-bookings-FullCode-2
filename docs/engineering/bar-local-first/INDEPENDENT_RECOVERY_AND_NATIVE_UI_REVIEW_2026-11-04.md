# Independent recovery and native UI checkpoint — 4 November 2026

Scope: user-pasted handoff for commits `1ef32013`, `ca5e6890`, `9e5585ee`, `2d13996d`, plus current native-route status. Incremental review; earlier reviews are historical and unchanged evidence is reused only within its original scope. No product remediation, customer database access, app/service restart, hosted activation, push or cleanup was performed.

## Verdict

The interrupted-send recovery change is real and its maintained unit/runtime checks independently pass. The expanded Legacy real-service crash test is added and syntactically valid, but its database execution remains unverified. Training remains partial with its real-cluster test skipped. None of these results completes the user's requirement to run the original Bar UI throughout on local PostgreSQL.

Implementation completeness: **incomplete**. Customer commissioning: **NO-GO**, consistent with the handoff.

## Priority findings and remaining requirements

### P1 — Original Menu, Stock and Till integration is still unfinished

Current `src/renderer/src/components/hospitality-pos/LocalBarHposShell.jsx:156-158` routes Till and Stock to `BarLocalWorkspace` replacement panels; Menu routes to `BarLocalNativeMenu`.

`BarLocalNativeMenu.jsx:8-129` is a separate basic form/table implementation. It does not mount or adapt the original `HposMenu` component. The original `HposMenu.jsx:304` and associated UI contain established stock-method, pack/barcode, recipe and other functionality; the integration map explicitly says pack/outlet/recipe/modifier controls are not exposed in the local component. Thus a real service-backed product CRUD slice is progress, but is not preservation/parity of the user's original Menu screen. Component naming and the comment “Regular Menu screen” do not establish that acceptance.

Required work: connect the existing native screens and their agreed features through narrow local-authority adapters and missing atomic service contracts where required. Preserve cloud fencing and Restaurant behavior. Do not present hidden planned core functions or a new replacement form as completed parity. Exercise actual native forms through main/preload/service/PostgreSQL and check database/audit/stock effects, roles/outlets, same-ID retries and offline restart. The EV-196 rendered Menu HTTP evidence is author-provided historical evidence in this review; it was not independently rerun, and its bridge explicitly bypasses real Electron IPC/journaling.

### P1/PARTIAL — End-to-end crash acceptance remains incomplete

The new Legacy case at `services/bar-local/tests/api-real-clients.test.mjs:130-175` creates a child client that exits after a successful committed HTTP sale response but before the journal receipt checkpoint; it reopens JSONL, asserts uncertainty, retries the same ID, and checks one stored result/effect. This is a useful fault case, not the complete before-send/service-crash/power-loss/printing matrix. Syntax checking passed independently; the expanded database case was **not executed** here. A04 must remain PARTIAL. Prior Modern real-service evidence must not be relabelled as proof that this later expanded file passed.

### P2 — Database verification is currently blocked by storage

Independent C: reading showed **2,909,937,664 bytes free (approximately 2.71 GiB)**, below the 4 GiB test-runner guard in `services/bar-local/scripts/run-isolated-db.mjs:32-43`. This differs from the handoff's historical 3.98 GiB snapshot. No database runner was started; no reserve was reduced. About 1.3 GiB plus working headroom is needed to cross the guard. Treat this as a test-environment blocker, not a reason to stop source/native-adapter work. No additional files were deleted in this review. The reported prior cleanup and its exact stopped-process verification were not independently reconstructed retrospectively.

## Source and executed recovery evidence

- Modern `src/main/bar-local/intents.js:341-355`: after loading persisted SQLite or JSONL frames, interrupted `sending` records transition durably to `outcome_unknown` with `PROCESS_RESTART`. Existing envelope/operation identity is reused. SQLite load/recovery errors close storage and fail initialization.
- Legacy `legacy-pos/src/main/bar-local/intents.js:392-402`: loaded `submitting` entries transition to `uncertain` with `PROCESS_RESTART` through the existing durable transition path. No replacement operation ID is minted by this normalization.
- These changes do not independently resend financial operations or assert that an uncertain sale succeeded. The server remains authoritative and the same saved request must be reconciled/retried.
- `npm.cmd run test:bar-local-electron`: **110 PASS / 0 FAIL** independently. This is a mixture of journal/runtime/helper execution and source assertions, not 110 installed end-to-end workflows.
- `npm.cmd --prefix legacy-pos test`: comprehensive source regression passed and **54 Node tests PASS / 0 FAIL** independently.
- `node --test tests/bar-local/training.test.mjs tests/bar-local/training-integration.test.mjs`: **3 PASS / 1 SKIP** independently. A30 remains PARTIAL; the skipped real-cluster test is not qualification of practice setup/trade/restart/reset.
- `node --check services/bar-local/tests/api-real-clients.test.mjs`: PASS independently, syntax only.
- Git log confirms the four reported focused local commits. No remote/push state was verified or changed.

## Concrete continuation

Continue the original native Menu/Stock/Till integration and then all remaining agreed Bar screens. Keep explicit authority selection: local Bar credentials/operations stay local; Restaurant retains cloud auth, eligible offline sessions and scoped queues, including equal emails across both businesses. Finish same-app lifecycle and mixed-business acceptance using synthetic fixtures. Run the expanded Modern/Legacy crash case and real training integration only once sufficient space and a positively identified new disposable cluster are available. Do not use Rabafi's saved installation, an active application DB or hosted Supabase for test experiments.

The lack of an installed application in this author's environment is a limitation of installed saved-profile acceptance, not a blocker to developing and testing native React/main/IPC adapters with owned disposable fixtures. Physical extra-PC/Windows7/peripheral/power qualification and customer PDFs/quick-start/screenshots/manifest/package-guide edits remain deferred; no hardware or installed Windows claim is inferred from these checks.

## Subsequent original-Menu contract-gap check — 4 November 2026

The later handoff states tracing is ongoing and identifies an atomic product/opening-stock/pack gap. Source independently confirms that this is a real integration requirement: original `HposProductWizard.jsx:325-360,429` uses a stable operation key, stock/menu linkage, opening quantity/cost, pack options and barcodes through `pos.saveBarProductWithStock`; `HposMenu.jsx:729-744` also uses `pos.saveBarProductWithPacks` for direct-stock edits. Current local `catalogue.upsert` validation (`packages/bar-contracts/src/registry.ts:550`) and its versioned SQL implementation (`0034_catalogue_product_version_guard.sql`) only create/update catalogue product fields and audit/outbox them. `stock.receive` is a separate operation. Those two commands do not establish one atomic equivalent to the original combined workflow. No suitable combined contract was found in the inspected local registry/migrations.

This supports keeping the old cloud handler fenced while implementing the missing local contract. It does not justify stopping at tracing, hiding packs/opening stock, or keeping the simplified Menu as the final UI. Required continuation: one scoped/idempotent atomic local operation for the original workflow, compatibility reads/result mapping, adapters for the original components, and executable tests for rollback, duplicate/changed-payload retry, edit-without-reapplying-opening-stock and pack consumption of the shared base stock. Stock/Till native routes remain unchanged replacement panels in this follow-up. No unchanged suites were rerun for this tracing-only handoff. C: measured 3,397,390,336 bytes free (about 3.16 GiB), still below the 4 GiB database-test guard; no DB initialization or cleanup occurred.
