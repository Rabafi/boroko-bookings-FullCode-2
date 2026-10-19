# B02-B revision prompt — R1/R2 only

Copy the following prompt to the implementing model in its existing chat.

---

B02-B independent review is CHANGES REQUIRED. Read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, docs/engineering/typescript-migration/B02B_ASSIGNMENT.md and evidence/B02B-independent-review.md. Earlier B01/B02-A acceptances stand. Implement R1/R2 only; no later batch, app behaviour changes, npm installation, database, deployment, commit or cross-chat message.

## 1. Preserve the current state

Before editing, capture HEAD, full timestamped porcelain status and actual byte-exact inert snapshots/hashes of scripts/typecheck-main.mjs and each documentation file you will edit. Save new evidence/B02B-correction-baseline.md, B02B-correction-status.txt and appropriately named correction snapshots/logs. Preserve original B02B snapshots/logs and the independent review unchanged. Do not copy .env, profiles, queues or customer data.

Editable existing scope: scripts/typecheck-main.mjs; migration STATUS.md; evidence/B02B-report.md; evidence/B02B-baseline.md only if adding an honest final-resolution clarification; the B02-B PROJECT_STATE entry only. New correction evidence is allowed under evidence/B02B-correction-* paths. Preserve root manifest/lock, source modules, all fixtures/configs and all B01/B02-A executables. No new checker framework/helper file is needed.

## 2. R1: test the actual Node version validator

The current wrong-typings-major guard contains its own hardcoded Number('25.5.0'...) test. Replace it: it must call the actual checkNodeTypesVersion function used by positive and negative programs.

One small acceptable design, wholly within the current runner:

- Add a readRootManifest() function that performs the existing JSON read of root package.json.
- Let checkNodeTypesVersion(label, getManifest = readRootManifest, getResolvedVersion = readResolvedNodeTypesVersion) read through those callbacks.
- Retain the existing missing-direct-declaration, major-24 and exact resolved/declared checks inside that single function. Preserve production calls checkNodeTypesVersion(label) so their defaults still read the real files.
- Use callbacks returning inert synthetic metadata in guards. Do not alter actual package.json, lockfile, installed dependency metadata or source files.
- Alternatively use an equivalent design that tests the same complete validator without mirroring its implementation.

Required cases, with intended error messages verified:

1. Declared 24.19.1 and resolved 24.19.1 accepted.
2. Declared 24.19.1 and resolved 25.5.0 rejected with the actual "major is 25" message.
3. Missing direct @types/node declaration rejected with "declares no direct @types/node".
4. Declared 24.19.1 and resolved 24.19.0 rejected with the resolved/manifest pin mismatch message.

Preserve all existing option, inventory, source-checking and diagnostic guards; do not reduce the existing strict checks or suppress errors. Update guard counts from what actually runs rather than retaining a magic historical 13.

Prove sensitivity independently of the success log:

- In a disposable/in-memory copy, replace the actual checkNodeTypesVersion body with a no-op. The new wrong-major guard must now fail because the validator did not throw, yielding nonzero exit and the intended guard-failure message. Never weaken the live runner for this probe.
- Run an integrated probe on the corrected unmodified runner with installed version metadata simulated as 25.5.0 while real manifest stays pinned 24.19.1. It must exit nonzero with the real major rejection before compiling programs. Use injectable reads or a fresh child process with a narrowly scoped read interception; do not write node_modules/package files. Report how metadata simulation was achieved and that live files were unchanged.
- Finish with the normal unmodified main commands green. Save bounded outputs with command, exit and intended message in correction evidence. Any temporary file must be removed exactly; validate containment before recursive scratch cleanup.

## 3. R2: align documentation with the actual dependency tree and safe rollback

The reviewer observed root node_modules/undici-types@7.24.6, not a nested new package. Verify locally without reinstalling. Record the compiler closure precisely: 171 files = 59 compiler libs + 66 Node declarations + 43 root undici declarations + 1 buffer shim + source + fixture, unless an actual inspected change gives a different total.

The actual before/after lock entries changed are only:

- Root empty-string package entry, for the added dev dependency.
- node_modules/@types/node: 25.5.0 -> 24.19.1.
- Removed node_modules/electron/node_modules/@types/node@24.12.4.
- Removed node_modules/electron/node_modules/undici-types@7.16.0.
- node_modules/undici-types: 7.18.2 -> 7.24.6.

png-to-ico's nested @types/node@22.19.17 and undici-types@6.21.0 were retained. Correct the final report's location language and rollback locations. The baseline's original "nested resolution expected" statement is historical: preserve it as a pre-install expectation and add the observed outcome, rather than silently rewriting history.

Remove the recommendation that npm uninstall is a safe exact inverse. Document targeted inverse edits/hunks for the reviewed manifest keys and those five lock entries, using the actual saved B02-B baseline values. Require checking current affected content before applying: if later work changed an affected hunk, reconcile it rather than overwrite it. Preserve every other key, formatting where practicable, earlier accepted work and subsequent edits. Never restore the entire file from HEAD or the snapshot. No rollback, uninstall/reinstall, npm ci, lock regeneration or installed-tree reconciliation is authorized in this correction. Distinguish future local installed-tree reconciliation from source/lock rollback.

For diff checks, distinguish batch scope from the whole dirty tree. The reviewer found unrelated Bar documentation whitespace in whole-tree diff --check; do not repair it. State exact scope/result honestly.

Update STATUS and only the current B02-B PROJECT_STATE entry to corrections implemented / PENDING RE-REVIEW. Keep original implementation/build evidence labelled honestly; builds remain implementer-reported to the reviewer. Do not change the independent review or earlier acceptance files.

## 4. Validate serially from repository root

Inspect the real scripts first, then run and retain durable exit/output summaries:

~~~text
node --check scripts/typecheck-main.mjs
npm run typecheck:main
npm run test:typecheck:main
npm run typecheck:pilot
npm run test:typecheck:pilot
npm run test:typecheck:pilot-guards
npm run typecheck:shared
npm run test:typecheck:shared
npm run workspace:check
npm run test:products
npm run test:release-architecture
npm run products:list
~~~

Run the two R1 sensitivity probes described above and rerun the main duo green afterward. Verify original source/config/fixture/manifest/lock hashes remain unchanged from correction baseline (record comparison). Check whitespace/escape patterns on the actual correction files, accounting for intentional probe strings rather than treating them as real suppressions.

Builds need not repeat for checker/documentation-only corrections; report that decision. Do not rerun the broad brand audit or generate new secret-bearing logs. Earlier brand audit failures and release limitations remain recorded, not waived. Manual impact: No manual update required because these are checker and evidence corrections with no customer-facing behaviour change.

## 5. Return and stop

Return a correction packet mapping R1/R2 to exact changed files, same-validator guard evidence, integrated wrong-major rejection, mutation sensitivity, command exits, immutable-file hashes, real dependency locations, corrected rollback wording and all remaining limitations. Correct the self-review table honestly; do not self-approve.

STOP with status PENDING RE-REVIEW. No B02-C, other B02 work or B03 is assigned yet.
