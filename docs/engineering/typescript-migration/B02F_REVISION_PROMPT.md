# B02-F revision prompt — R1 only

Copy this prompt into the implementing model's existing chat.

---

B02-F independent review is CHANGES REQUIRED. Read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, docs/engineering/typescript-migration/B02F_ASSIGNMENT.md, evidence/B02F-independent-review.md and evidence/B02F-reviewer-probes.json. Address R1 only. No next batch, cross-chat messages, installs, dependencies, runtime changes, DB, hardware, queues, mesh, builds, deployment, signing, publishing or commits.

## 1. Capture authentic correction baseline before editing

Save HEAD, UTC time and full porcelain status. Save inert byte-exact pre-correction copies of scripts/typecheck-legacy-shared.mjs and every existing documentation file you will edit. Generate hashes/tables from those actual saved bytes with canonical paths; verify copies match live at capture. Use NEW evidence/B02F-correction-baseline.md, B02F-correction-status.txt, B02F-correction-snapshots/ and B02F-correction-logs/ with containment and absent-destination checks. Do not reuse an earlier batch's table, hashes or logs. Do not label current/post-edit copies as earlier snapshots.

Record preservation hashes for source/config/three fixtures, all four lockfiles and subproject manifests, root manifest, accepted scripts/helpers/configs/declaration and earlier evidence. Preserve all original B02F snapshots/logs, reviewer artifacts, historical reviews and acceptances unchanged. Never print/copy .env, generated Legacy config contents, customer caches/profiles/queues or browser storage.

Editable code: ONLY scripts/typecheck-legacy-shared.mjs. Existing docs: STATUS.md, B02F-report.md, B02F-baseline.md additively if needed, and the current B02-F PROJECT_STATE entry/additive correction note. New B02F correction evidence is allowed. No production source, config, fixture, manifest, lockfile, prior checker/helper or Legacy build-input changes; no new helper/framework file.

## 2. Make actual inventory protection testable and reuse it

Keep the existing isAllowedLegacyLib predicate: pinned compiler-library provenance first, then static ES2020 family/decorator closure; reject DOM/webworker/scripthost/ES2021+/esnext and external ambient/app files. Never allow every pinned lib, infer an allowlist from a live program, add Node/Electron/React globals or weaken strict options.

Inside this runner extract a small PURE THROWING assertion, for example assertProgramInventory(fileNames, requiredAbsPaths, label):

- Call the existing required-file assertion or equivalently require every intended source/own-fixture path.
- Permit only those intended paths and libraries accepted by isAllowedLegacyLib.
- Throw an Error naming unexpected files and label when contamination exists.
- Return a reporting value if necessary, but do not exit/log success inside the assertion.

Both real positive and negative checkProgramInventory paths must call THIS function. Inventory enumeration/logging remains in the CLI wrapper; wrapper catches assertion errors and uses existing fail(). Keep the 47-file valid inventories and diagnostic assertions intact. Do not retain a second independently reconstructed filter in guards/probes.

Change unexpected-ambient-file guard to call the real extracted assertion with source, fixture and synthetic totals.js. Its expected rejection must name totals.js. Add or route these same-function inventory cases:

- Real accepted inventory accepted.
- Missing production source rejected by its path.
- Missing fixture rejected by its path.
- Unexpected app/ambient file rejected by its path.
- Pinned DOM library rejected through inventory, despite being from the correct compiler directory.

Keep all existing option/strict/file/directive/library/diagnostic safeguards; guard count comes from cases actually run, never an old hardcoded count. Existing low-level predicate guards may remain, but cannot replace inventory-assertion coverage.

## 3. Integrated DOM and no-op sensitivity must fail for intended reasons

For the existing in-memory triple-slash variant, first confirm the actual variant program loads the pinned lib.dom.d.ts. Then call the SAME inventory assertion with that program's real file list and intended source/fixture paths through expectThrow. Require the resulting rejection to name lib.dom.d.ts and unexpected files. Printing a bad-file list is not proof of rejection. No deliberate DOM addition on disk.

Save two independent sensitivity demonstrations in new bounded logs:

1. Unmodified corrected actual runner, positive valid.ts read simulated in memory with a leading DOM triple-slash reference, exits 1 at positive inventory for lib.dom.d.ts. Preserve all anchors, normalized Windows paths and ESM builtin synchronization or a similarly reliable compiler-host override. Prove the control exits 0. A missing compiler, wrong root, unrelated diagnostic or import failure does not count.
2. Disposable stdin variant replacing ONLY the actual extracted inventory assertion body with a no-op. Keep any return shape needed by reporting so failure is an expected rejection missing, not TypeError. The control exits 0; mutated variant exits 1 with the inventory safeguard's expected-rejection message. Fail the probe if mutation unexpectedly exits 0 or fails for the wrong reason. Use pinned compiler AST or bounded exact replacement to identify the body, preserve real repo/compiler/helper anchors, and avoid Windows command-length limits by passing the script via child stdin.

Also replicate the reviewer's inventory-disabled plus DOM-input false pass and show the corrected architecture catches it through either the actual enforcement or the same-assertion guard as appropriate; state precisely which function is disabled. Do not change multiple validators to manufacture a result. Document scaffolding adaptations separately from semantic mutation.

Keep existing negative-assertion no-op and disappeared-rejection checks meaningful; rerun the non-validating negative assertion variant with reporting shape preserved and require its existing intended safeguard error. No permanent tests of copied filtering logic.

No files need be changed for these probes. If temporary harness files are unavoidable, use exact verified containment, remove only the files you created and prove cleanup. Hash real source/config/fixtures/manifests/locks and the corrected live runner before/after probes. Existing original-fixture copies remain the restore authority; no regenerated references or historical-log rewrites. Fixtures are compile-only, never executed.

## 4. Validate serially and retain authentic current logs

Inspect actual package scripts; from repository root run sequentially:

~~~text
node --check scripts/typecheck-legacy-shared.mjs
npm run typecheck:legacy-shared
npm run test:typecheck:legacy-shared
npm run typecheck:booking
npm run test:typecheck:booking
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
npm run legacy-pos:test
~~~

Capture command, exit, diagnostic/guard/test counts and bounded intended failures. Scoped diff --check and suppression/unsafe-cast scan on changed code; distinguish intentional in-memory probe strings from actual suppression directives. Whole-tree pre-existing Bar whitespace is not an instruction to fix unrelated files.

No builds required for a checker/evidence-only correction; retain the earlier implementer-reported Legacy builds, desktop/web reports and modern-Node/old-hardware limits honestly. No broad brand audit or new secret-bearing logs; no app/device/network/DB actions.

## 5. Correct claims, preserve history and stop

Link the independent review. Append the actual correction details to B02F-report and update its self-review: the original submitted inventory guards did not call the actual assertion and failed the reviewer's mutation sensitivity. Correct current status/current PROJECT_STATE wording; do not present initial 21-green results as proof of corrected enforcement or silently rewrite history. Record new actual guard count and controls/failure messages after correction, immutable file hashes, prior-source equivalence, unchanged coverage, targeted rollback and limitations. Do not edit the reviewer's review/probe JSON, revision prompt, original snapshots/logs or prior acceptances.

Manual impact: No manual update required, because only checker enforcement/evidence is changed and application runtime/customer messages are untouched. No release readiness, full Legacy/financial/offline/React/preload coverage or old-hardware certification claim.

Return a concise R1 correction packet with exact changed files, new assertion wiring, intended sensitivity results, all command exits/counts, before/after hashes, historical-evidence preservation and limitations. STOP PENDING RE-REVIEW. No other batch or scope started; no cross-chat messages. Reviewer acceptance is still required before any new assignment.
