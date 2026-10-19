# B02-F R1 follow-up — actual program list, one code change

Copy into the implementing model's existing chat.

---

R1 is partially corrected; B02-F remains CHANGES REQUIRED for one guard input. Read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, the existing B02F assignment/revision prompt, evidence/B02F-R1-rereview.md and evidence/B02F-R1-rereview-probes.json. Follow this narrowed assignment only. No next batch or cross-chat messages.

## Exact scope and baseline

Code editable: ONLY the inventory-accepted guard in scripts/typecheck-legacy-shared.mjs. Do not alter assertProgramInventory, checkProgramInventory, isAllowedLegacyLib, options/diagnostics/directives, fixtures/configs/production source/manifests/locks/helpers or other guards. The new assertion and DOM rejection wiring are already verified and should be preserved.

Docs: B02F-report.md, additive correction in B02F-correction-baseline.md, current STATUS/B02-F PROJECT_STATE correction note. New evidence/B02F-R1-followup-* baseline/status/snapshots/logs allowed. All original snapshots/logs and all reviewer/acceptance/prompt artifacts stay byte-identical. No installs, builds, app launch, DB, devices, queues, mesh, deployment, signing, publishing or commits.

Before editing, capture timestamp/HEAD/full porcelain status and authentic byte-exact copies/hashes of runner and each existing doc to edit. Generate the table from saved bytes, verify equal at capture, record exact paths. Use a NEW contained follow-up directory and refuse existing destinations. Hash source/config/fixtures/manifest/all four locks/prior checker inputs and historical evidence for preservation. No .env or generated-config contents/customer data copies.

## One code change

inventory-accepted currently passes positive.fileNames, the config's two root files. Replace that input with ALL file names from the already constructed actual positiveProgram:

~~~js
expectPass('inventory-accepted', () => {
  assertProgramInventory(
    positiveProgram.getSourceFiles().map((f) => f.fileName),
    [ERRORS_SOURCE, VALID_FIXTURE],
    'guard',
  );
});
~~~

Do not filter libraries, make a new clean program, use configured roots as a stand-in or broaden the allowlist. This guard must validate the actual normal 47-file closure AND detect unexpected library files if the CLI wrapper stops checking. Preserve 23 as the dynamically counted number of existing cases; do not hardcode it.

The reviewer tested this exact change in memory: normal suite remains 2/2 + 23; the original wrapper-disabled/DOM-injection case becomes exit 1 at inventory-accepted with lib.dom.d.ts in the intended error.

## Required bounded proof, no disk mutations

Use fresh child stdin, real runner/root/compiler/helper anchors, normalized Windows paths and reliable ESM fs synchronization or equivalent host overrides. Scaffolding adaptations must be documented separately from the single semantic mutation. Fixtures are compile-only, never executed. Controls must prove real checking is reached; missing package/root/import/TypeError failures do not count.

Save command/mechanism/exit/intended message for:

1. Adapted unmodified corrected runner control: exit 0, 2/2 + 23.
2. The ACTUAL unmodified corrected runner reading positive valid.ts with ONLY a virtual leading DOM triple-slash reference: exit 1 at positive unexpected-files inventory for lib.dom.d.ts.
3. EXACT original reviewer failure case: ONLY checkProgramInventory body replaced with a no-check body returning program.getSourceFiles().map(f => f.fileName), plus the same positive-fixture DOM read override. Leave assertProgramInventory and every guard unchanged. Must exit 1 with guard inventory-accepted: expected acceptance, threw, naming unexpected lib.dom.d.ts. Do not swap this mutation for the extracted-assertion mutation.
4. ONLY assertProgramInventory body non-validating (return fileNames, reporting shape preserved), no DOM injection: still exit 1 at missing-production-source expected-rejection safeguard. This remains separate proof and must not replace case 3.

Prior negative-assertion no-op proof was independently reverified and its code is unchanged; retain it, no need for another run unless you change something relevant. Hash real files before/after probes; remove only your own verified contained scratch harnesses, if any, and prove cleanup. Prefer stdin/in-memory variants without disk scratch.

## Focused verification

Run serially from root and save authentic follow-up logs:

~~~text
node --check scripts/typecheck-legacy-shared.mjs
npm run typecheck:legacy-shared
npm run test:typecheck:legacy-shared
~~~

Run scoped diff --check and changed-code escape scan, distinguishing intended probe strings from actual suppressions. Confirm unchanged hashes for all preserved inputs. All earlier accepted suites, workspace/product gates and 219 Legacy tests were freshly green in the independent re-review; with this one guard-only change they remain prior results, not new follow-up runs. Do not repeat builds, brand audit or broader runtime tests without a new change/failure that justifies them. Report any failure honestly.

## Documentation and return

Append the R1 continuation to B02F-report: extracted-assertion mutation already failed correctly, but original wrapper+DOM pair remained green because the acceptance case used configured roots. Actual program list now closes that original pair. Link re-review/probe evidence, distinguish both mutations and saved before/after hashes, record unchanged coverage/runtime/23 guards.

Fix metadata label additively in B02F-correction-baseline: EBA6D6DF0F42B1FD2AE4B635207B72A6491E44A3745A71E56D7BB980E31BFF3B belongs to legacy-pos/tsconfig.typecheck-shared.json; 8159372A4D156DFB8737DC18985EE8C812C7BC21010633C0CD01B4F62352C9FC belongs to tests/typecheck/legacy-errors/tsconfig.invalid.json. Both are unchanged. Preserve historical snapshots/table facts; this is a label correction, not an invented earlier hash. Qualify the old top-level 21/every-assertion report text as pre-correction and show current 23 accurately. No generic documentation rewrite.

Current status and scoped PROJECT_STATE: implementation corrected / PENDING RE-REVIEW, never self-accepted. Manual impact: none, checker/evidence only. Earlier builds remain implementer-reported; old-hardware and B00/D evidence limitations stand. Record exact inverse guard edit as correction rollback with current-content preconditions; do not perform rollback or delete history.

Return concise packet with the single code change, all four intended proof results, syntax/duo exits/counts, authentic baseline/preservation hashes, tiny wording corrections and limitations. STOP PENDING RE-REVIEW. No B02-G, other scope, B03 or cross-chat messages.
