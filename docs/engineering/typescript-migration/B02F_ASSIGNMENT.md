# B02-F assignment — Legacy POS shared error formatter

Date: 2026-10-12. Prerequisites: B01 and B02-A through B02-E ACCEPTED.
Read evidence/B02E-acceptance.md, PLAN.md, AGENTS.md, PROJECT_STATE.md and docs/ARCHITECTURE.md. Preserve standing historical evidence limitations.

## Objective

Establish an isolated Legacy shared-pure checker over exactly legacy-pos/src/shared/errors.js. Add active @ts-check and truthful JSDoc only. Preserve every error message, branch, regexp, redaction, whitespace rule, truncation and throw behaviour.

This is one Legacy shared helper, not Electron APIs, Node APIs, React 18/JSX, preload, hardware, offline queues or the Legacy financial contract. Legacy remains a separate Electron 22/React 18 application with its own Node16/Chrome108 build targets and ia32 release lifecycle. No modernization or reuse of root Electron/React/Node ambient declarations.

The checking profile uses ES2020 as a conservative common library/language floor for this pure helper. It does not change emitted build targets or certify every API of the historical runtime. Cumulative accepted production coverage would become seven JS files plus the existing Manager declaration.

## Reconfirmed facts and callers

errors.js has no imports and one export: sanitizePosError(raw).

- Falsy raw -> existing generic Sync retry guidance.
- String(raw), then existing network/session/duplicate regex branches with unchanged advisory strings.
- Other messages: existing UUID-shaped text replacement, whitespace collapse/trim and truncation beyond 160 UTF-16 units to 157 plus three dots.
- Unknown input is deliberate. Objects use their existing String conversion, not raw.message extraction. Exotic conversions can throw; this is not a total no-throw function or a complete sensitive-data sanitizer. Duplicate advice remains provisional wording, not server-confirmed financial state.

Trace the actual module imports/calls. Reviewer observed POSTerminal.jsx importing @shared/errors.js and calling sanitizePosError(err?.message); main/index.js imports it (do not infer a call if none exists); the actual Legacy regression script imports it and exercises network/auth/duplicate cases. Record actual trace without editing/checking consumers.

Verified local metadata/config: installed legacy-pos/node_modules/electron package version 22.3.27; package manifest React/ReactDOM 18.2.0; electron.vite.config.js main/preload target node16 and renderer target chrome108; package main out/main/index.cjs. Reconfirm from local files. Actual historical hardware/runtime execution is not claimed by metadata or a modern development-Node test run.

## Evidence before edits

Inspect dirty tree; save timestamped HEAD/full porcelain status. Save byte-exact inert snapshots BEFORE edits of errors.js, root package.json, STATUS.md and PROJECT_STATE.md. Generate tables from saved bytes with canonical source path/hash; verify each snapshot equals live at capture. Record planned files absent.

Use new evidence/B02F-baseline.md, B02F-status-before.txt, B02F-snapshots/ and B02F-logs/. Resolve the log root, enforce containment and absent-destination checks, verify files after writes and before handoff. Never redirect into an earlier directory or paste old metadata/hashes. Recreated current files are not pre-edit proof; copied earlier logs are references, not new runs.

Preserve/hash root/Legacy/Manager/booking manifests/locks, Legacy build/preload/renderer/main inputs, accepted checkers/configs/fixtures/globals/sources and historical C/D/E logs. Keep all reviews/acceptances/evidence. No .env/credential, customer profile/cache/queue or browser-storage copies. If pre-edit evidence vanishes, state the gap without fabrication.

## Exact editable scope

- legacy-pos/src/shared/errors.js: comments/@ts-check/JSDoc only.
- Root package.json: exactly two new script entries, no dependencies/version/other script change.
- NEW legacy-pos/tsconfig.typecheck-shared.json.
- NEW scripts/typecheck-legacy-shared.mjs.
- NEW tests/typecheck/legacy-errors/valid.ts, invalid.ts, tsconfig.invalid.json.
- STATUS.md, one scoped PROJECT_STATE entry and new evidence/B02F-* artifacts.

No prior-file editorials assigned. Do not edit Legacy manifest/lock/config/test, React/Electron versions, main/preload/renderer/queue/mesh/hardware source, shared financial modules, manual/customer text, SQL or any other project code/config. No installs, typings packages, renamed source, extraction or checker framework redesign.

## Type contract

Above the existing function:

~~~js
// @ts-check
/**
 * Format existing error guidance; input conversion and existing throws remain.
 * @param {unknown} raw
 * @returns {string}
 */
~~~

Attach truthful limitation prose if useful. Keep runtime literal messages and all regexes untouched. Do not add raw?.message handling, null fallback changes, truncation changes, redaction expansion, retry logic or exception swallowing. No any/casts/ignore/nocheck/expect-error, generic or branded security/length promises. Raw unknown inputs remain accepted; output is plain string.

## Exact configuration and scripts

legacy-pos/tsconfig.typecheck-shared.json:

~~~json
{
  "extends": "../tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "target": "ES2020",
    "checkJs": true,
    "lib": ["ES2020"],
    "types": []
  },
  "files": [
    "src/shared/errors.js",
    "../tests/typecheck/legacy-errors/valid.ts"
  ],
  "include": []
}
~~~

Inherited ESNext/Bundler describe existing ESM source checking; this import-free helper does not need an alias or Node resolution bridge. Strict/nine defaults, allowJs/noEmit, skipLibCheck:false/casing:true stay enforced. No DOM/Node/Electron/React/Vite globals. The bundler's separate Node16/Chrome108 targets and CJS output are untouched. Raw Node regression imports still consume .js directly.

Root manifest additions only:

~~~json
{
  "typecheck:legacy-shared": "tsc --project legacy-pos/tsconfig.typecheck-shared.json --pretty false",
  "test:typecheck:legacy-shared": "node scripts/typecheck-legacy-shared.mjs"
}
~~~

Use pinned root TypeScript 5.9.3. Do not install a second compiler or root Node24/React19 typings into Legacy.

## Fixtures — compile only

valid.ts imports the real helper via ../../../legacy-pos/src/shared/errors.js. Prove string return for string, Error, object/unknown, null, undefined and numeric inputs; string methods/length typed correctly. No financial result interpretation or guaranteed redaction assertion. Use only pure standard-library operations; no browser/Node globals needed. Never emit/import/execute fixtures through the checker.

Initial invalid.ts, no header:

~~~ts
import { sanitizePosError } from '../../../legacy-pos/src/shared/errors.js';
const numeric: number = sanitizePosError('fetch failed');
const message = sanitizePosError({ message: 'x' });
const success = message.success;
const nodeVersion = process.version;
const browserDocument = document;
const managerBuild = __BOROKO_APP_VERSION__;
void numeric; void success; void nodeVersion; void browserDocument; void managerBuild;
~~~

Reviewer pinned 5.9.3 in-memory preflight: TS2322 L2, TS2339 L4, TS2591 L5, TS2584 L6, TS2304 L7. Production source zero errors. Verify actual diagnostics by file/line/category/code; do not substitute erroring imports or suppression directives.

Negative config:

~~~json
{
  "extends": "../../../legacy-pos/tsconfig.typecheck-shared.json",
  "files": [
    "../../../legacy-pos/src/shared/errors.js",
    "./invalid.ts"
  ],
  "include": []
}
~~~

## Runner, provenance and meaningful safeguards

Use pinned compiler API and createRequire; import only existing STRICT_SUBOPTIONS/assertJsChecked/isStdLibFile helpers without edits. No prior-runner imports or new framework/helper file.

Per actual program assert ES2020 target, ESNext module, Bundler resolution, exact [lib.es2020.d.ts], explicit types:[], strict/nine defaults, allowJs/checkJs:true/noEmit, skipLibCheck:false/casing:true. Require source + own fixture, active directive, zero positive/source errors, exactly five intended negative errors and zero unrelated errors. Locate full misuse markers and verify line/category/code; fixtures remain compile-only.

Inventory permits only intended source/fixture and verified pinned ES2020 library closure. Do not accept every pinned standard lib indiscriminately: DOM could arrive via a triple-slash reference despite correct options. Add a small pure predicate inside this new runner that first verifies pinned compiler-library provenance, then permits only lib.es5.d.ts, lib.es2015 through lib.es2020 and their component libraries, plus lib.decorators.d.ts/lib.decorators.legacy.d.ts required by the pinned compiler. Reject lib.dom*, lib.webworker*, lib.scripthost*, ES2021+/esnext libraries and all external ambient packages/app/declaration files. Example basename family rule: lib.es20(15|16|17|18|19|20) with optional component suffix; verify actual compiler closure. Do not derive an allowlist from a potentially contaminated live program.

Preflight inventory was 47 files: 45 standard libraries + source + fixture. The two decorator declarations are compiler library dependencies, not proof of runtime decorator support. No Node24/Electron42/React19 compatibility claim.

Same-function guards must cover accepted baseline, wrong target/module/resolution, missing/extra lib, omitted/nonempty types, checkJs:false, disabled strict options, missing source/fixture, absent directive, wrong library provenance, real pinned DOM library rejected and unexpected maintained/ambient file. Use intended rejection messages.

Integrated/in-memory probes must demonstrate:

- Positive fixture with a virtual DOM triple-slash reference is rejected by actual inventory, not silently accepted because the DOM file is pinned.
- Node types leakage is rejected by the actual option/inventory boundary.
- Removed @ts-check is rejected on a real SourceFile.
- A real output-contract error disappears: replace numeric number annotation with string in a virtual negative fixture while retaining the original full marker in a same-line comment. Actual source stays error-free; five fixture errors become four; the actual negative assertion fails for that gap.
- Removing validation from the actual negative assertion (keep any reporting result shape needed to avoid incidental TypeError) makes the disappearance safeguard fail for the intended reason. Use child stdin for large scripts and preserve real repository/compiler anchors.

Do not weaken production source on disk. Save ORIGINAL new fixture/config bytes before sabotage, then prove missing valid fixture, excluded negative fixture and all-benign fixture fail, restore from those saved original bytes and verify full hash equality. A newly regenerated reference is not a creation-byte restore. Normalize compiler-host/read-interception paths consistently.

## Runtime equivalence

Compare actual pre-edit/current source with pinned removeComments transpilation and raw diff; runtime output must be identical. No deleted runtime or customer strings.

Optional fresh-child synthetic matrix may compare falsy inputs, network/session/duplicate cases, case-insensitive matching, UUID replacement, whitespace cleanup, 160/161 boundaries, generic objects, Symbol input and genuinely throwing conversion hooks. Preserve String conversion semantics; do not assume every object is treated as Error.message or every unknown input is safe. No queues, profiles, browser/network/hardware or app launch. Keep scratch containment/cleanup verified. No redundant permanent tests for unchanged runtime code required.

## Real Legacy validation and build side effects

Inspect actual script bodies/prerequisites first. Existing root scripts legacy-pos:test and legacy-pos:build delegate to the Legacy package's real test/build commands; do not invent a name or use db:probe/dist/release.

The regression script executes pure helpers/buffers and reads source contracts; inspect current hardware-related sections before running and do not introduce actual device activity. Existing error-helper cases cover network/auth/duplicate output. Do not modify tests to satisfy typing.

Build calls prepare:config then electron-vite. The existing preparation hook reads current environment files and regenerates legacy-pos/build/generated/legacy-pos-runtime-config.json (Supabase URL/key fields plus generatedAt); it is a local build side effect, not customer state or deployment. Do NOT print/copy .env or generated config contents into evidence. Record path/hash/warnings only, and disclose expected generated timestamp/output changes. Do not substitute credentials, link projects, contact the database or activate/install the app. Build logs should not contain credential values.

Before and after, serial from root:

~~~text
node --check scripts/typecheck-legacy-shared.mjs     # new at final
npm run typecheck:legacy-shared                    # new at final
npm run test:typecheck:legacy-shared               # new at final
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
npm run legacy-pos:build
~~~

Record new commands absent at baseline, current Legacy test counts/build output/warnings, and actual CJS output path. Ensure source .js raw imports remain compatible and build targets/dependencies/config hashes unchanged. A modern development-Node run/build is not a POSReady7/32-bit hardware journey; state that limit.

If existing tests/build fail, retain before/after evidence and identify identical/new failures; no unrelated repairs, installs or fake green claims. Desktop/Manager/booking sources/dependencies untouched, so their prior builds remain prior reports; no fresh broader builds required. Do not rerun broad brand audit or produce secret-bearing logs. No db:probe, live DB/hardware, queue replay, mesh traffic, dist/sign/publish/version/deploy/activation. Manual impact: No update required if customer text/behaviour/equipment support stays identical.

## Completion and stop

Add B02-E acceptance link and B02-F section additively to STATUS; one scoped PROJECT_STATE entry. Full packet/self-review must include precise shared-only coverage, raw Node vs emitted CJS consumption, actual pre-edit snapshots/status/preservation hashes, diagnostics/inventory, meaningful guard/original-byte restore evidence, runtime equivalence, real Legacy tests/build before-and-after, local generation effects, manual impact and limitations. No self-approval or claim of full Legacy/main/preload/React coverage.

Document exact targeted rollback for new config/runner/three fixtures, two scripts, annotations and scoped state/evidence additions, with current-content preconditions. Directories only if empty. Preserve accepted batches/locks/manifests/build configs/reviews/acceptances/unrelated/subsequent edits; never whole-file restore or broad deletion. Generated build artifacts are separate local outputs and must not be confused with customer state. Do not actually roll back.

STOP B02-F PENDING REVIEW. No Legacy queue/financial/hardware/main/preload/React migration, desktop preload, Deno, other B02 or B03 authorized; no cross-chat messages.
