# B02-D assignment — Manager PWA build-information pilot

Date: 2026-10-12. Prerequisites: B01, B02-A, B02-B and B02-C ACCEPTED.
Read evidence/B02C-acceptance.md, PLAN.md, AGENTS.md, PROJECT_STATE.md and docs/ARCHITECTURE.md before work.

## Objective

Establish isolated Manager PWA browser checking over exactly manager-pwa/src/lib/buildInfo.js and narrowly describe its two real Vite build globals. Production JavaScript changes are comments/JSDoc only. Preserve all build identity, URL, fallback and service-worker metadata behaviour.

This checks one Manager PWA helper, not React/JSX, the full PWA, offline queues or update lifecycle. The app is not globally read-only; its approved operational writes and device-local queue remain separate untyped paths. Do not edit them. Preload, booking site, Legacy and Edge Function configurations remain unassigned. Cumulative production coverage would be five distinct JS files plus one explicit type-only declaration file.

## Verified current facts — reconfirm

buildInfo.js has no imports and contains:

- fallback(value, replacement): trims nonempty strings; otherwise returns the replacement unchanged.
- APP_VERSION and APP_BUILD_ID: fallback applied to __BOROKO_APP_VERSION__ and __BOROKO_APP_BUILD_ID__ with development/dev-local replacements.
- shortBuildId(value = APP_BUILD_ID): fallback to unknown, truncates strings over 18 characters to 18 plus an ellipsis.
- serviceWorkerUrl(): /sw.js? plus URLSearchParams with version/build in existing order and encoding.
- getWorkerBuildInfo(worker): missing/falsy scriptURL -> {}; otherwise parses new URL(worker.scriptURL, window.location.origin); returns version/buildId string or undefined; any exception inside the try -> {}. Optional fields do not guarantee worker/app build agreement.

manager-pwa/vite.config.js defines both globals with JSON.stringify. Version comes from root package.json; buildId comes from configured/source identifiers or the existing time-derived fallback. Confirm root version is a nonempty string and the buildId expression is string-producing. Do not execute the Vite config merely to read this contract, expose environment values, or change how identifiers are chosen.

Callers: App.jsx imports serviceWorkerUrl/shortBuildId; More.jsx imports constants/shortBuildId; appUpdate.js imports constants/getWorkerBuildInfo and passes registration.waiting/active/installing, possibly null/undefined. Trace these paths and registration.update/updateViaCache behaviour, but do not edit/check those callers or public/sw.js. Preserve the distinction between installed and waiting identity and the existing runtime asset cache.

Runtime constraints: no registration, refresh, reload, worker messaging, skipWaiting, cache clear, URL/caching/version changes, update activation or deployment. Missing globals on raw unbundled import currently throw; typing declarations must not add runtime defaults/typeof guards or make raw execution appear supported.

## Capture and preserve

Save actual byte-exact inert snapshots and SHA-256 hashes BEFORE editing for buildInfo.js, root package.json, STATUS.md, PROJECT_STATE.md, and the two editorial files below (localDate.js and B02C-report.md). Save timestamped HEAD/full porcelain status and absent planned paths in new evidence/B02D-baseline.md, B02D-status-before.txt and B02D-snapshots/.

Record preservation hashes for root/Manager lockfiles, Manager package.json/vite.config.js/public/sw.js, earlier checker/config/fixture files and accepted sources. Do not copy .env, profiles, real queues, browser storage, tokens or customer records. Large dirty work must survive unchanged.

## Exact editable scope

- manager-pwa/src/lib/buildInfo.js: @ts-check, truthful comments/JSDoc only.
- NEW manager-pwa/src/types/build-info.d.ts.
- NEW manager-pwa/tsconfig.typecheck.json.
- NEW scripts/typecheck-manager.mjs.
- NEW tests/typecheck/manager-build-info/valid.ts, invalid.ts, tsconfig.invalid.json.
- Root package.json: exactly two script entries; no dependency/version/other-script changes.
- Migration STATUS.md, one scoped PROJECT_STATE entry and new evidence/B02D-* artifacts.
- Editorial only: localDate.js offset comment must say coercion may yield NaN OR throw (e.g. Symbol or a throwing conversion hook), with behaviour unchanged.
- Editorial only: B02C-report.md runtime-matrix self-review wording must not claim explicit throw-case coverage from a matrix that contains none. Preserve the original matrix and history; comment-free syntax equivalence establishes unchanged throw implementation.

Do not edit root/Manager lockfiles, Manager manifest/build config/service worker/callers, other accepted executable checkers/configs/fixtures, shared source, SQL, manuals or earlier reviews/acceptances. No installs, type-package upgrades, renamed source or runtime extraction. Preserve accepted localDate contract and its @ts-check; only the assigned prose changes there.

## Type contracts

Add active @ts-check above the existing buildInfo code. Keep its ESLint global comment. Truthful JSDoc:

~~~js
/** @param {unknown} value @param {string} replacement @returns {string} */
// fallback arrow function, attached above existing const
/** @param {unknown} [value] @returns {string} */
// shortBuildId
/** @returns {string} */
// serviceWorkerUrl
/** @param {ServiceWorker | null | undefined} [worker] @returns {{version?: string, buildId?: string}} */
// getWorkerBuildInfo
~~~

A source-local typedef for the optional return object is allowed if equivalent. Do not mark fields required, guaranteed-valid, readonly/frozen or authoritative. Unknown is correct at shortBuildId's existing fallback boundary. No casts, any, generic assertions, ignores or expect-error. Browser ServiceWorker must come from real DOM declarations, not an invented stub interface.

Create build-info.d.ts with exactly these global declarations and no imports/exports, index signatures, Window augmentation or other declarations:

~~~ts
// Build-time constants supplied by manager-pwa/vite.config.js.
declare const __BOROKO_APP_VERSION__: string;
declare const __BOROKO_APP_BUILD_ID__: string;
~~~

These are type-only declarations of actual globals, not runtime values. Include them only in the new Manager configs. No Vite/client, React, Node or Electron declarations are needed for this module. Do not add @shared paths: this file does not use that alias. Alias/JSX/asset coverage remains future scope.

## Exact initial configuration and scripts

manager-pwa/tsconfig.typecheck.json:

~~~json
{
  "extends": "../tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "checkJs": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": []
  },
  "files": [
    "src/lib/buildInfo.js",
    "src/types/build-info.d.ts",
    "../tests/typecheck/manager-build-info/valid.ts"
  ],
  "include": []
}
~~~

Inherited target ES2022, module ESNext, moduleResolution Bundler, strict + nine defaults, allowJs/noEmit, skipLibCheck:false/casing:true stay enforced. No extends of the Node/main config; keep PWA globals isolated from desktop renderer/pilot/shared/main programs.

Root package scripts only:

~~~json
{
  "typecheck:manager": "tsc --project manager-pwa/tsconfig.typecheck.json --pretty false",
  "test:typecheck:manager": "node scripts/typecheck-manager.mjs"
}
~~~

Use pinned root TypeScript 5.9.3. Do not add a second compiler to Manager dependencies.

## Fixtures — compile only

valid.ts imports all five real exports via ../../../manager-pwa/src/lib/buildInfo.js. Prove string constants/results, optional/unknown shortBuildId input, serviceWorkerUrl string, and getWorkerBuildInfo with declared ServiceWorker/null/omitted input. Narrow optional metadata fields before string methods. Use real typed navigator.serviceWorker/URL/browser APIs without invoking register/update/activation. Every fixture is compile-only, never executed/imported by the runner.

Initial invalid.ts must be exactly:

~~~ts
import { APP_VERSION, getWorkerBuildInfo } from '../../../manager-pwa/src/lib/buildInfo.js';
const numeric: number = APP_VERSION;
const info = getWorkerBuildInfo(null);
const upper = info.buildId.toUpperCase();
getWorkerBuildInfo(42);
const nodeVersion = process.version;
const privileged = window.api;
void numeric; void upper; void nodeVersion; void privileged;
~~~

Reviewer in-memory preflight under pinned 5.9.3 observed TS2322 L2, TS18048 L4, TS2345 L5, TS2591 L6, TS2339 L7, with zero production-source diagnostics. Verify actual file/line/category/code; preflight is not implementation evidence.

Negative config:

~~~json
{
  "extends": "../../../manager-pwa/tsconfig.typecheck.json",
  "files": [
    "../../../manager-pwa/src/lib/buildInfo.js",
    "../../../manager-pwa/src/types/build-info.d.ts",
    "./invalid.ts"
  ],
  "include": []
}
~~~

No erroring imports or suppression directives as substitutes for intended misuses.

## Runner and safeguards

Use createRequire and the pinned local compiler API. Reuse existing STRICT_SUBOPTIONS/assertJsChecked/isStdLibFile by import without modifying accepted helpers. Do not import prior runners (they execute suites on import) or redesign a checker framework.

For every program assert exact enums ES2022/ESNext/Bundler, explicit types:[], ordered full-basename lib triple, strict/nine defaults, allowJs/checkJs:true/noEmit, skipLibCheck:false/casing:true. Require buildInfo + the sole globals declaration + the intended own fixture. Require active source @ts-check, zero positive/source diagnostics and exactly the five intended negative errors with no unrelated diagnostics.

Enumerate closure/provenance: intended JS source, intended fixture, the exact globals declaration and real pinned compiler libs only. No unrestricted node_modules allowance, shared/caller source, extra ambient declaration file, React/Vite/Electron/Node package or fictional bridge. Real DOM/DOM.Iterable libs must be present. Reviewer preflight had 62 files (59 libs + source + globals + fixture); record actual resolved inventory and classify each maintained file honestly.

Validate the globals declaration AST through a function used by real programs and guards: exactly two ambient const declaration statements, exact names above, each with string type and no initializer/extra binding/statement. Reject added Window.api/interface/index signatures, omitted/renamed global or wrong type. Comments are allowed; no runtime emit. This keeps the approved local declaration file from becoming an ambient escape hatch.

Guard tests must call these same assertions, not duplicate them. Cover accepted baseline; missing/extra browser lib; omitted/nonempty types; wrong enum/checkJs/strict options; missing source/globals/fixture; absent active directive; wrong globals shape; unexpected ambient file; fake compiler-lib path. Verify intended rejection messages, not simply a thrown error.

Integrated/in-memory sensitivity must prove:

- Missing build globals are rejected by actual program/required-file wiring, not accepted by inventing substitutes.
- Node ambient config leakage is rejected by the real option/inventory boundary.
- Removing source @ts-check is rejected on a real program SourceFile.
- A real negative rejection disappearing is detected: change getWorkerBuildInfo(42) to a benign call in an in-memory fixture, retaining the original marker in a same-line comment. Real production source must still have zero errors; the real negative assertion must fail for 5 -> 4 fixture diagnostics. Never compensate with another error.

New fixture/config sabotage only: missing positive fixture, negative fixture excluded, all misuses benign. Restore byte/hash exact and finish green. Production source/real globals are never weakened on disk. Document copy/data-URL resolution adaptations. Windows path comparisons in read interception must normalize separators/casing consistently, or use compiler hosts with resolved paths; a missing compiler/incorrect repoRoot is not a meaningful safeguard failure.

## Runtime equivalence, without operational side effects

Pinned comment-free transpilation and raw diff must prove identical pre/post runtime JS for buildInfo and the localDate editorial. No deletions or runtime statements changed.

A temporary fresh-child probe may compare inert baseline/current module text using synthetic globals and a fake origin/worker metadata object. Never load the real UI, register/update/message workers, touch browser caches/storage, use customer data or fetch URLs.

Compare normal/trimmed/empty identity strings and replacements; shortBuildId boundaries at 18/19 characters and unknown input; exact serviceWorkerUrl ordering/encoding; absent worker/scriptURL; relative/absolute/queryless/malformed URLs; optional metadata; parse exceptions. Compare own keys as well as values to distinguish {} from {version:undefined, buildId:undefined}. Missing globals on unbundled import should still throw identically. Confine synthetic global/window setup to the fresh child, never the user's app/session. If scratch files are needed, verify containment before exact cleanup and verify absent afterward. No redundant permanent runtime tests for unchanged code required.

## Baseline/final validation, serial

Inspect actual script bodies and existing test prerequisites first. Save bounded durable outputs/exit/summary. From repo root:

~~~text
node --check scripts/typecheck-manager.mjs        # new at final
npm run typecheck:manager                        # new at final
npm run test:typecheck:manager                   # new at final
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
npm run manager:lint
npm run manager:build
~~~

The focused Manager build-contract test exists and was inspected by the reviewer; it reads source contracts and runs three tests. Do not invent a package script name or change that test. New commands absent at baseline are expected.

Run Manager lint/build before and after because the changed source is bundled there. Report warnings and existing failures honestly. If unrelated baseline failures exist, preserve them, identify identical/new deltas and do not silently repair unrelated code or claim all release gates green.

No three desktop rebuilds required in this batch: their only permitted source change is the localDate prose clarification with independently byte-identical runtime output; B02-C retained product builds stand as prior implementer reports. State this decision, never claim fresh builds. Booking/Legacy/Deno untouched. Do not rerun broad brand audit or generate secret-bearing logs. No npm ci/install, deployment, DB, signing, publishing or activation.

Scan actual edits for unsafe type escapes and whitespace; intended negative marker strings are not suppressions. Preserve all baseline hashes except explicitly assigned comment/script/document changes; report old/new hashes where allowed. No manual update required if customer behaviour stays unchanged.

## Completion, rollback, stop

Add B02-C acceptance link additively in STATUS and one B02-D section; add one scoped PROJECT_STATE entry. Preserve historical blocks, original evidence and all reviews/acceptances. Report checked JS source separately from the type-only declaration and excluded runtime paths. Full packet/self-review must contain scope, snapshots/status/hash preservation, contracts/callers, globals provenance, diagnostics/inventory, real guard/sensitivity results, runtime equivalence, baseline/final checks, manual impact and limits. Do not self-approve.

Document exact-file rollback: remove only new config/runner/globals/three fixture files, two assigned scripts, source annotations/editorial comments and scoped status/evidence entries. Require current-content preconditions before inverse hunks; preserve unrelated/subsequent work, earlier batches, manifests/locks and history. Directories only if empty; no whole-file restore or broad deletion. Do not actually roll back.

STOP with B02-D PENDING REVIEW. No preload/React component, other PWA module, booking/Legacy/Deno or B03 work authorized; no cross-chat messages.
