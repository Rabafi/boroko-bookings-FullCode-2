# B02-C assignment — browser renderer utility pilot

Date: 2026-10-10. Prerequisites: B01, B02-A and B02-B ACCEPTED.
Read evidence/B02B-acceptance.md, PLAN.md, AGENTS.md, PROJECT_STATE.md and docs/ARCHITECTURE.md.

## Objective and scope

Establish an isolated browser renderer checking configuration over exactly src/renderer/src/utils/localDate.js. Add truthful checked JSDoc only; preserve every runtime statement, export, timezone choice, coercion and error/rollover behaviour.

This utility lives in the desktop renderer and is imported by real UI components. The fixture will also prove DOM APIs are available and Node globals are absent. This is a browser utility pilot, not full renderer/React/JSX/assets/IPC typing. Preload remains unassigned: its large existing bridge must receive a separate bounded contract assignment rather than a blanket @ts-check change now. B02 environment order is reviewer-selected under PLAN section 8.

Cumulative production coverage after acceptance would be four files. Do not widen any accepted program to include this file, and do not include its callers in the new program.

## Current implementation and semantic constraints

localDate.js has no imports, four exports and no top-level side effects:

- formatLocalDate(value = new Date()): accepts Date or Date-constructor string/number input; formats LOCAL year/month/day. Return is string, not a validated date brand. Invalid Date inputs currently produce NaN components.
- localToday(): delegates to formatLocalDate() using the local clock.
- localDateStringFromOffset(days = 0): uses new Date(), Number(days || 0), local setDate and formatLocalDate. It is calendar-day arithmetic, not UTC or fixed 24-hour arithmetic. Existing coercion is intentional scope to preserve, not a new input validator.
- parseLocalDateInput(value): falsy input returns null; String(value) is split and parseInt is applied; nonfinite components return null; otherwise new Date(year, month - 1, day). It may accept partial numeric components, roll out-of-range dates, or return Invalid Date for extreme values. Date | null does not promise a valid calendar date.

Do not replace local formatting with toISOString, impose Africa/Gaborone globally, tighten parsing, reject rollover, change Date handling, change falsy/default handling, or add server wire-date assumptions. No financial calculations, booking date logic, RPCs, queue payloads or reports change.

Trace actual callers with rg, excluding generated bundles when discussing maintained code. Known callers include timeAgo.js, App-facing components such as Bookings/Housekeeping/Rooms/POS/DataImport and operational components importing localToday. Reports.jsx and several restaurant components have separate local implementations: do not claim they call this helper. Do not edit/type any caller.

## Capture before any edit

Inspect the dirty tree and save HEAD/full timestamped porcelain status. Actual byte-exact inert snapshots and SHA-256 hashes are required for every editable existing file: localDate.js, package.json, STATUS.md, PROJECT_STATE.md and B02B-report.md for the sole editorial clarification below.

Record root package-lock.json and accepted checker/config/fixture hashes for preservation checks; do not edit the lockfile. Save baseline snapshots/status as new evidence/B02C-* files, and durable baseline/final logs under evidence/B02C-logs/. Planned new files must be recorded absent. Never copy .env, profiles, queues or customer data. Preserve pre-existing dirty work.

## Exact editable paths

- src/renderer/src/utils/localDate.js: comments/@ts-check/JSDoc ONLY.
- package.json: exactly two script entries only; no dependency/version/other script change.
- NEW tsconfig.typecheck-renderer.json.
- NEW scripts/typecheck-renderer.mjs.
- NEW tests/typecheck/renderer-local-date/valid.ts, invalid.ts, tsconfig.invalid.json.
- Migration STATUS.md, new evidence/B02C-* artifacts, one scoped PROJECT_STATE entry.
- Editorial only: B02B-report.md rollback bullet for node_modules/@types/node must explicitly include dependencies.undici-types (~7.18.0 in the pre-install snapshot) with other changed entry fields, as clarified by B02B-acceptance.md. Preserve historical submission/check counts and original logs.

Do not edit package-lock.json, accepted B01/B02-A/B02-B executable files, preload, App/components/callers, build configs, env declarations, SQL, other project manifests/locks, manual files or earlier reviews/acceptances. No npm installs, new type packages, runtime renames or helper extraction.

## Checked JSDoc contract

Add // @ts-check and these contracts, with prose explaining the existing limitations:

~~~js
/** @param {Date | string | number} [value] @returns {string} */
// formatLocalDate
/** @returns {string} */
// localToday
/** @param {unknown} [days] @returns {string} */
// localDateStringFromOffset
/** @param {unknown} value @returns {Date | null} */
// parseLocalDateInput
~~~

These are comment templates attached to existing functions, not permission to replace functions. Unknown parameters preserve the existing coercion boundary; do not invent narrower accepted inputs for the parser or offset function. No any annotations, casts, suppression directives, generic assertions or branded valid-date claims.

The reviewer sanity-checked these contracts using an in-memory compiler program without changing the source. Production source had zero diagnostics. Reconfirm from your actual files; the sanity check is not implementation evidence.

## Exact initial renderer configuration

Create tsconfig.typecheck-renderer.json:

~~~json
{
  "extends": "./tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "checkJs": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": []
  },
  "files": [
    "src/renderer/src/utils/localDate.js",
    "tests/typecheck/renderer-local-date/valid.ts"
  ],
  "include": []
}
~~~

Inherit target ES2022, module ESNext, moduleResolution Bundler, strict + its nine defaults, allowJs, noEmit, skipLibCheck:false and casing enforcement. This matches the existing renderer's bundler consumption; it does not alter electron.vite.config.js or emitted runtime targets. This utility does not require JSX, React, Vite/client, aliases, assets or window.api declarations. Those remain separate later scope. Do not add speculative globals.

Root Node typings remain installed for the accepted main checker. Explicit types:[] and the renderer inventory must keep Node/Electron declarations out of this program. DOM APIs are intentionally enabled only here; preserve shared/pilot/main boundaries independently.

Add exactly:

~~~json
{
  "typecheck:renderer": "tsc --project tsconfig.typecheck-renderer.json --pretty false",
  "test:typecheck:renderer": "node scripts/typecheck-renderer.mjs"
}
~~~

## Fixtures — compile only, never execute

valid.ts imports all four real exports via ../../../src/renderer/src/utils/localDate.js. Demonstrate Date/string/number/omitted formatting, string results, localToday, offset calls with omitted/number/string inputs, parser returns Date | null and can be safely narrowed with a null check before getDate. Demonstrate typed browser usage of document.createElement, window.matchMedia, localStorage and DOM collection iteration. Those browser calls must never execute in Node tests.

Create invalid.ts with this exact initial text (line positions include no header):

~~~ts
import { formatLocalDate, parseLocalDateInput } from '../../../src/renderer/src/utils/localDate.js';
formatLocalDate(true);
const parsed = parseLocalDateInput('2026-10-10');
const day = parsed.getDate();
const numeric: number = formatLocalDate(new Date());
const nodeVersion = process.version;
const privileged = window.api;
void day; void numeric; void nodeVersion; void privileged;
~~~

Reviewer-observed pinned TypeScript 5.9.3 diagnostics from in-memory preflight:
TS2345 line 2; TS18047 line 4; TS2322 line 5; TS2591 line 6; TS2339 line 7. Verify actual file/line/category/code. window.api absence means this pilot does not declare the actual preload bridge; the app still exposes its existing runtime API. Do not add a broad Window index signature or fictional bridge to make the misuse disappear. Do not import Node/Electron in the negative fixture: erroring imports are not substitutes for intended misuse and would pollute the compiler closure.

The negative config extends ../../../tsconfig.typecheck-renderer.json and overrides files to ../../../src/renderer/src/utils/localDate.js plus ./invalid.ts, include:[]. No expect-error/suppression.

## Runner and meaningful guards

Use pinned local TypeScript 5.9.3 via createRequire/compiler API. Reuse STRICT_SUBOPTIONS, assertJsChecked and isStdLibFile from the accepted pure helper without modifying it. Do NOT call assertPilotOptions unchanged: that accepted pilot deliberately forbids DOM, while this scope deliberately needs DOM.

Parse effective inherited options for each program and assert exact target/module/resolution enums, explicit checkJs:true, allowJs/strict/noEmit, all nine strict sub-options not false, skipLibCheck:false/casing:true. The effective lib array must be exactly lib.es2022.d.ts, lib.dom.d.ts, lib.dom.iterable.d.ts; explicit types must be []. Do not accept missing types, an arbitrary endsWith match for DOM names, or extra ambient entries.

Require exactly the intended production source and own fixture, active @ts-check, zero source diagnostics, zero positive diagnostics, exactly the five intended negative errors in the negative fixture and no unrelated diagnostics. Locate markers and validate diagnostics by file/line/category/code. Positive and negative fixtures must never be emitted/imported/executed.

Enumerate actual compiler source files with provenance. Only intended source/fixture and pinned compiler standard libs may appear. No node_modules exception for Node, Electron, React, Vite or other ambient packages. Independently require that real pinned lib.dom.d.ts and lib.dom.iterable.d.ts are present. The in-memory preflight yielded 61 files (59 standard libs + two maintained files); record actual inventory rather than asserting a fabricated count. No other application files or global declaration files.

Guards must exercise the SAME assertions used by real programs, with intended-message checks, not hardcoded duplicate conditions. Include baseline accepted, missing DOM, missing DOM.Iterable, added lib, missing/nonempty types, wrong target/module/resolution, checkJs:false, disabled strict sub-options, missing source/fixture, absent active directive and a fake compiler-lib path. Demonstrate production wiring using isolated/in-memory integrated probes for ambient Node leakage and absent @ts-check; actual source must remain untouched.

Sensitivity also needs disappearance of a real contract rejection: in-memory production variant widens formatLocalDate's JSDoc input to include boolean while fixture text/markers are preserved. The negative diagnostic count must drop and the runner must fail for the intended missing-rejection reason. Do not modify accepted/actual source for this probe.

For new fixture/config sabotage only, prove missing valid fixture, excluded negative fixture and all-benign negative fixture fail. Restore bytes/hash exactly and rerun green. Keep temporary-copy import.meta.url/createRequire resolution adaptations documented; a wrong repoRoot or missing compiler is not a meaningful failure. No checker framework redesign or separate new helper file.

## Behaviour equivalence

Compare comment-free pre/post syntax using pinned TypeScript transpilation: runtime output must match. Inspect raw diff to ensure comments only.

Optional temporary runtime comparison should import baseline/current from inert text in a fresh child process and use synthetic values only. Compare explicit local Date/string/number formatting, invalid dates, parse null/malformed/valid/rollover/partial numeric input, offset coercion and existing throws. Preserve the same timezone. Use a fixed clock in the child if testing localToday/default/offset outputs; do not change the user's global environment or timezone configuration. No customer files, browser storage, database or IPC. No redundant permanent runtime tests mirroring unchanged code are required.

## Validation and evidence

Inspect actual package script bodies/prerequisites first. Baseline and final serial checks from repo root:

~~~text
node --check scripts/typecheck-renderer.mjs      # new at final
npm run typecheck:renderer                     # new at final
npm run test:typecheck:renderer                # new at final
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
npm run build
node scripts/product-app.mjs hotel build
npm run build:hospitality-pos
~~~

Record new commands absent at baseline; do not label expected absence a regression. For existing build baselines, reuse retained B02-B final logs as immediate prior build evidence if working inputs are unchanged; say explicitly that they are prior implementer reports rather than newly executed pre-edit builds. Run three final product builds serially because the changed source is bundled by each. No dist/signing/publishing/database operations.

Do not rerun the broad brand audit; its known failure/secret-preview limitation remains. Manager/booking/Legacy sources and dependencies are untouched, so do not invent checks for them. If another concrete blocker emerges, report it honestly rather than broadening scope or silencing diagnostics.

Save command/exit/summary logs, guard/sensitivity outputs, inventory and restoration hashes; redact any unexpected secrets. Scope diff --check honestly: unrelated whole-tree Bar-document whitespace is not this batch's work. Manual impact: No manual update required if implementation remains comment-only with unchanged customer date behaviour.

## Return, rollback and stop

Update STATUS with B02-B acceptance linked additively and a B02-C section. Add one scoped PROJECT_STATE entry; preserve historical headings and previous entries. Return the full completion packet and honest self-review, exact changed files, baseline/final results, diagnostics/provenance, safeguard sensitivity, syntax/equivalence and unresolved limits.

Rollback instructions must remove only the exact new config/runner/three fixture files and assigned manifest entries/comments/status blocks/evidence files; directories only if empty. Preserve plan/prompts/reviews/acceptance, prior batches, unrelated/subsequent edits and the lockfile. No whole-file restore or broad directory deletion. Do not actually roll back.

STOP with B02-C status PENDING REVIEW. No JSX/React component, preload, other B02 environment or B03 work is authorized. No cross-chat messages.
