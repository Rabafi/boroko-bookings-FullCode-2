# B02-D revision prompt — R1/R2 only

Copy this prompt into the implementing model's existing chat.

---

B02-D independent review is CHANGES REQUIRED. Read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, docs/engineering/typescript-migration/B02D_ASSIGNMENT.md and evidence/B02D-independent-review.md. Address only R1/R2. No next batch, app changes, installs, dependency edits, DB, build/update activation, deployment or cross-chat messages.

## 1. Capture before correcting

Save HEAD, timestamped full porcelain status and actual byte-exact snapshots/hashes of scripts/typecheck-manager.mjs and each documentation file to be edited. Use new B02D-correction-baseline/status/snapshot/log artifacts; preserve all original packets/snapshots/reviews/acceptances.

Before touching historical logs, save a manifest of BOTH B02C-logs and B02D-logs: exact relative path, size, SHA-256 and available timestamps. Retain copies of their current content in a new correction evidence snapshot location if needed. Do not print/copy .env, profiles, queues or customer data. Do not overwrite/move/delete any surviving C/D log during investigation.

Editable code scope: scripts/typecheck-manager.mjs only. Existing docs allowed: STATUS.md, B02D-report.md, B02D-baseline.md additively, the current B02-D PROJECT_STATE entry, and an additive evidence-limitation note in B02C-report.md/B02C-baseline.md if provenance recovery requires it. New correction/incident evidence allowed. No source/config/fixture/global-declaration/manifest/lock changes needed. Historical log recovery is limited to the exact eleven missing B02-C paths listed in the review, subject to proven provenance and absent-destination checks. Preserve original donors.

## 2. R1 — enforce the actual globals contract

checkGlobalsDeclaration must reject every declaration statement that does not have EXACTLY the declare modifier and no other modifiers. Continue requiring const, one plain identifier per statement, explicit string type, no initializer, the two names and no extra statements. Reject export/default/other modifiers; absence of declare must not rely on a later compiler diagnostic.

Reject actual compiler-recognized suppression directives in the globals SourceFile: active @ts-nocheck and @ts-ignore/@ts-expect-error. Use pinned TypeScript SourceFile metadata or another precise directive check; ordinary prose mentioning these words or intentional probe strings elsewhere are not actual suppressions. Comments remain permitted. Do not weaken/import broad globals to compensate.

All new guards call THIS SAME function, used by both real programs. Add:

- Missing declare modifier.
- Exported declare const declarations.
- Active nocheck declaration input.
- Actual ignore directive input.
- Actual expect-error directive input.

Retain all 27 existing guards/probes and update the displayed count from cases actually run, without magic historical counts. Preserve all option/source/diagnostic/inventory checks. A globals AST function no-op must fail the guard suite for an intended wrong-shape rejection.

Remove GLOBALS_DECL from the negative-program unrelated-diagnostics exemption, or separately require zero compiler diagnostics on that declaration. Only the five intended fixture diagnostics may survive. Do not suppress negative/global errors or add casts.

Integrated proof: unmodified corrected runner, globals file simulated in memory with declare keywords removed plus active // @ts-nocheck, must fail with the intended globals-validation message. No on-disk declaration/package/source mutation. Use normalized Windows path interception plus explicit ESM synchronization, a compiler-host override, or a safely resolved disposable runner variant. Demonstrate that the production globals check runs before success; a missing compiler/wrong root is not proof. Save command/exit/intended message and unchanged-file hashes.

## 3. R2 — investigate and state log provenance honestly

The reviewer observed 22 B02-C logs before this batch. Eleven baseline files are now missing there; the eleven remaining are final/equivalence files. The report's claim that the accepted inventory was eleven and was fully restored is false.

Investigate whether the eleven same-named files now in B02D-logs are actually moved B02-C originals, newly generated B02-D logs, or overwritten originals. Use authentic available records/snapshots/hashes/content chronology. Matching filenames/sizes or a fresh command yielding similar output are not byte identity/provenance proof. Do not silently guess.

If authentic originals can be established, copy them to their exact missing B02-C paths with an absent-destination precondition, preserving donor content and recording source/destination hashes and basis of authenticity. Do not move them out of D or overwrite a surviving historical file. If authentic identity cannot be established, leave uncertainty explicit and record unrecoverable baseline evidence as a standing limitation. Do not manufacture old C logs from B02-A/B02-B or current reruns.

If a D log is found to be an old C log, correct its interpretation in a provenance manifest/report rather than claiming it records a D baseline. A new current run can establish present correctness only; label it correction verification with its actual date/state. It cannot replace the missing pre-change history.

Update B02D-report, STATUS/current PROJECT_STATE and self-review claims: distinguish independently verified application/type behaviour from historical evidence completeness. Preserve B02C-acceptance and all reviews/acceptances byte-identical. Add an incident/provenance report listing original expected paths, surviving files, any verified recovery and unresolved loss; link it from current docs. Do not edit existing log contents to make the story fit.

Also qualify the fixture-restoration claim: current-reference equality plus exact text plus green checks proves intended current content, not matching original creation bytes when the creation SHA differs. Record the unknown byte discrepancy, keep both hashes where available, and remove blanket "hashes restored" claims. Do not assert the unproven newline theory as fact; no fixture edits are requested.

Prevent repeat incidents in the evidence workflow: use a batch-specific resolved log root; assert every output stays under the intended NEW correction-log directory; fail if a destination already exists unless that exact overwrite is intentionally recorded for a current run; hash historical log directories before/after. Do not add a general framework or change prior scripts. Shell/tooling discipline in this correction is sufficient.

## 4. Validate serially and retain logs

Inspect actual scripts and then run from repository root:

~~~text
node --check scripts/typecheck-manager.mjs
npm run typecheck:manager
npm run test:typecheck:manager
npm run typecheck:renderer
npm run test:typecheck:renderer
npm run typecheck:main
npm run test:typecheck:main
npm run typecheck:shared
npm run test:typecheck:shared
npm run typecheck:pilot
npm run test:typecheck:pilot
npm run test:typecheck:pilot-guards
npm run workspace:check
npm run test:products
npm run test:release-architecture
npm run products:list
node --test tests/manager-pwa-build-contract.test.mjs
~~~

Perform R1 integrated/no-op sensitivity probes with intended failures and final unmodified Manager duo green. Verify source/config/fixture/globals/manifest/lock and prior checker hashes remain unchanged from correction baseline. Record any historical log recovery as a separate explicit delta, not as "all hashes unchanged".

Manager lint/build and desktop builds need not repeat for runner/evidence-only corrections; say so and retain prior implementer reports. Do not rerun broad brand audit or produce new secret-bearing logs. Scoped whitespace/type-escape scans only; unrelated dirty-tree whitespace is not yours to fix. No manual update required because app behaviour remains unchanged.

## 5. Return and stop

Return the R1/R2 correction packet with changed files, actual new guard count, exact integrated/no-op rejection evidence, durable command exits, immutable-file hashes, before/after log manifests, authentic recovery or explicit unrecoverable provenance gaps, qualified fixture byte-restoration limits and honest self-review statuses. Evidence loss may remain a documented historical limitation; do not conceal it or self-approve it.

STOP PENDING RE-REVIEW. No B02-E, other B02 scope or B03 authorized. Preserve the independent review unchanged and do not message another chat.
