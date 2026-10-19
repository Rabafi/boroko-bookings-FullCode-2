# B02-E assignment — public booking pure URL/slug utilities

Date: 2026-10-12. Prerequisites: B01/B02-A/B02-B/B02-C/B02-D ACCEPTED.
Read evidence/B02D-acceptance.md including standing evidence limitations, PLAN.md, AGENTS.md, PROJECT_STATE.md and docs/ARCHITECTURE.md.

## Objective and boundaries

Establish an isolated public booking browser checker over exactly booking-site/src/lib/utils.js. Add active @ts-check and truthful JSDoc only; keep every runtime statement, import/export, regular expression, URL rule and null/throw behaviour intact.

This is one pure helper module, not public booking/payments/guest-portal/API validation or full React/JSX coverage. Server-enforced public RPCs remain authoritative. Do not touch publicApi.js, hooks, telemetry/errorTracker, components, pricing, dates, booking availability or database contracts. Preload/Legacy/Deno configurations and B03 remain unassigned. Cumulative accepted production coverage would become six JS files, plus the existing Manager type-only declaration.

## Existing functions — trace/reconfirm, do not fix

utils.js has no imports and exports four functions plus SLUG_REGEX:

- buildWhatsAppUrl(number, {defaultCountryCode='267'}={}): String(number || '') with nondigits removed; empty -> null; some seven/eight-digit values prefixed; returns wa.me URL. It does not validate international numbering, identity or ownership. Passing unknown to String can still throw for exotic conversion hooks. Options/default handling must remain as implemented; null country code disables prefixing.
- sanitizeWebsiteUrl(value): falsy -> null; new URL(value) inside try; only http/https accepted and normalized; errors -> null. This is a scheme allowlist, not proof of trust, same-origin or absence of credentials. Do not broaden protocols, strip extra data or add a base URL.
- buildCalendarUrl(booking): optional string check_in/check_out with hyphens removed; missing/empty -> null; metadata interpolated/encodeURIComponent into Google Calendar URL. It does not validate calendar dates, timezone, availability, confirmed-booking status or ownership. Existing missing metadata can render undefined. Null/undefined booking objects or unsupported field conversions can throw; no new catch/validator.
- isValidSlug(value): typeof string, existing length limits and existing exported regexp test; returns boolean. Do not introduce a branded identifier, type predicate, frozen regexp or server authorization claim.

Trace actual utility consumers and existing src/test/utils.test.js, using maintained source only. Do not change callers/tests or imply separate helpers call this file. Generated output is not maintained source. No URL is opened, message sent, network request made, calendar created or booking changed by this assignment.

## Evidence discipline before edits

Inspect current dirty tree and record timestamped HEAD/full porcelain status. Save actual byte-exact inert snapshots of utils.js, root package.json, STATUS.md and PROJECT_STATE.md BEFORE any edit; record planned new files absent.

Use new evidence/B02E-baseline.md, B02E-status-before.txt, B02E-snapshots/ and B02E-logs/ only. Generate snapshot/hash tables from the saved files themselves, with canonical source path and filename. Verify snapshot bytes equal live bytes at capture, then hash actual copies. Do not paste another batch's table/header/hash or describe current recreated copies as pre-edit evidence. If a pre-edit capture cannot be established later, preserve current state and label the gap honestly; never reconstruct history from new runs.

Record preservation hashes for root/booking/Manager locks, subproject manifests/build configs and all accepted checkers/configs/fixtures/globals/production JS. Hash historical C/D log directories before/after and explain any delta; none should change here. Keep reviews/acceptances, original logs and evidence limitations unchanged.

Resolve the NEW B02E log root and assert every output path stays underneath it. Fail if a destination already exists unless that exact current-run overwrite is explicitly planned; do not redirect into another batch directory. Verify files present and hashes readable after writes and again before handoff. New logs must record actual command/date/state/exit; a copied old log is not a new run. Preserve donors if making an explicitly labelled reference copy. No .env, credentials, real profiles/queues, browser storage or customer data in evidence.

## Exact editable paths

- booking-site/src/lib/utils.js: comments/JSDoc only.
- Root package.json: exactly two new script entries; no dependency/version/other script change.
- NEW booking-site/tsconfig.typecheck.json.
- NEW scripts/typecheck-booking.mjs.
- NEW tests/typecheck/booking-utils/valid.ts, invalid.ts, tsconfig.invalid.json.
- STATUS.md, one scoped PROJECT_STATE entry and new evidence/B02E-* files/directories.

No other code/config/fixture/declaration/test/manual changes. Root/booking/Manager manifests other than the two root scripts and all lockfiles remain unchanged. No installs, new type packages, runtime renames, extraction/framework redesign, migrations or deployment.

## Truthful JSDoc

Attach comments to the existing functions; keep bodies unchanged:

~~~js
/**
 * @param {unknown} number
 * @param {{defaultCountryCode?: string | null}} [options]
 * @returns {string | null}
 */
// buildWhatsAppUrl, including existing destructured options parameter
/**
 * @param {string | URL | null | undefined} [value]
 * @returns {string | null}
 */
// sanitizeWebsiteUrl
/**
 * @param {{check_in?: string | null, check_out?: string | null, lodge_name?: unknown, reference?: unknown, room_number?: unknown}} booking
 * @returns {string | null}
 */
// buildCalendarUrl
/** @param {unknown} value @returns {boolean} */
// isValidSlug
~~~

An equivalent source-local CalendarBooking typedef is allowed. Do not make fields required merely to eliminate possible undefined strings, promise validated dates, narrow unknown metadata through unchecked casts, or mark data readonly/frozen. The caller owns the booking object; this utility performs no schema validation. Keep SLUG_REGEX inference as RegExp and literal runtime value unchanged.

No any annotations, ignores/nocheck/expect-error directives, assertions/casts, branded return values or fictional runtime globals. The reviewer preflighted these contracts in memory: zero production-source diagnostics; verify actual files yourself.

## Configuration and scripts

booking-site/tsconfig.typecheck.json:

~~~json
{
  "extends": "../tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "checkJs": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": []
  },
  "files": [
    "src/lib/utils.js",
    "../tests/typecheck/booking-utils/valid.ts"
  ],
  "include": []
}
~~~

Inherit ES2022 target, ESNext module, Bundler resolution, strict/nine defaults, allowJs/noEmit, skipLibCheck:false/casing:true. This matches the current Vite browser consumption without changing emitted targets/config. This utility needs no React/JSX, assets, aliases, Vite env declarations or Manager globals. Do not add speculative type packages or globals. Isolate from root Node typings and the approved Manager declaration file.

Root package.json additions only:

~~~json
{
  "typecheck:booking": "tsc --project booking-site/tsconfig.typecheck.json --pretty false",
  "test:typecheck:booking": "node scripts/typecheck-booking.mjs"
}
~~~

Pinned root TypeScript 5.9.3 only; no second compiler or dependency installation.

## Fixtures, compile-only

valid.ts imports all real exports via ../../../booking-site/src/lib/utils.js. Demonstrate WhatsApp unknown input and options/default/null-country-code; website string/URL/null/omitted input; calendar objects with string/null/missing dates and unknown metadata; plain boolean slug result and RegExp type. Keep nullable outputs as string|null or narrow before string methods. Add real URL/document/DOM collection typing so browser libs and DOM.Iterable are exercised. Never navigate URLs or execute/import fixtures in the checker.

Initial invalid.ts, no header:

~~~ts
import { buildWhatsAppUrl, buildCalendarUrl, isValidSlug } from '../../../booking-site/src/lib/utils.js';
const url = buildWhatsAppUrl('71234567');
const lower = url.toLowerCase();
buildWhatsAppUrl('71234567', { defaultCountryCode: 267 });
buildCalendarUrl({ check_in: 42 });
const numeric: number = isValidSlug('my-lodge');
const nodeVersion = process.version;
const privileged = window.api;
void lower; void numeric; void nodeVersion; void privileged;
~~~

Pinned reviewer in-memory preflight: TS18047 L3; TS2322 L4, L5, L6; TS2591 L7; TS2339 L8. Verify file/line/category/code in your actual program. Exact six diagnostics, no erroring imports or added replacement errors.

Negative config:

~~~json
{
  "extends": "../../../booking-site/tsconfig.typecheck.json",
  "files": [
    "../../../booking-site/src/lib/utils.js",
    "./invalid.ts"
  ],
  "include": []
}
~~~

Both fixtures compile only. Do not add them to Vitest's runtime test include or emit their JavaScript.

## Checker and meaningful safeguards

Use createRequire and pinned root TypeScript compiler API. Reuse STRICT_SUBOPTIONS/assertJsChecked/isStdLibFile by import, without altering helpers. Do not import prior runners or create a new framework.

Every real positive/negative program must validate effective enums ES2022/ESNext/Bundler, ordered exact lib triple, explicit types:[], strict/nine defaults, allowJs/checkJs:true/noEmit, skipLibCheck:false/casing:true. Require active @ts-check, intended JS + own fixture, zero positive/source diagnostics, exact six intended fixture errors and zero unrelated diagnostics.

Enumerate closure/provenance: only source/fixture and pinned compiler libs; no blanket node_modules exception, extra app/declaration/ambient file, Node/Electron/React/Vite/Manager globals or caller source. Require real pinned DOM and DOM.Iterable files. Reviewer preflight had 61 files (59 libs + two maintained files); record actual inventory rather than force an unexplained count.

Guards exercise the SAME functions used by real programs: valid baseline, missing/extra libs, omitted/nonempty types, wrong target/module/resolution, false checkJs, strict overrides, missing source/fixture, absent directive, unexpected ambient file and fake lib provenance. Include an isolated/in-memory program proving __BOROKO_APP_VERSION__ is unavailable here (TS2304), since Manager globals are not shared into booking.

Integrated failure probes:

- Actual program wiring rejects simulated Node types leakage and missing active directive.
- Actual negative assertion detects a disappeared rejection: change the wrong country-code 267 to a string in an in-memory fixture while retaining the original full marker in a same-line comment. Source remains error-free; six errors become five; fail for the intended count gap. No replacement error.
- Replacing the actual negative assertion with a no-op in a disposable/in-memory runner must make the disappearance safeguard fail. Preserve real repo/module/compiler anchors and document adaptations. Use child stdin for large scripts instead of oversized Windows data-URL command arguments.

Production source must never be weakened on disk. For NEW fixture/config sabotage only, demonstrate missing valid fixture (TS6053), excluded negative fixture (required-file failure), all benign misuses (marker-location failure), then restore exact saved ORIGINAL creation bytes/hashes. Keep an immutable copy before first sabotage; compare against that existing copy, not a freshly recreated reference. If bytes differ, diagnose the difference or report the unproven restoration; do not claim hash equality from a new canonical write.

## Runtime equivalence without messaging/network

Compare actual pre-edit/current source with removeComments pinned transpilation and raw diff: runtime output must match. Optional temporary fresh-child matrix uses inert source text and synthetic values only, with no UI/network/browser storage/URL opening or customer files.

Compare local/international/empty phone strings, explicit/null country-code options, unsupported website schemes and URL normalization, missing calendar dates/metadata and exact encoded query output, slug boundaries/non-string input and the regex literal. Include existing throws such as exotic string-conversion hooks or invalid booking objects if claiming throw coverage; otherwise label syntax equivalence as the evidence. Do not fix any observed legacy behaviour during typing. Verify temporary scratch containment/cleanup; no permanent redundant runtime tests required.

## Validation and real existing booking tests

Inspect actual scripts and src/test prerequisites before running. From repo root, serial baseline/final commands:

~~~text
node --check scripts/typecheck-booking.mjs        # new at final
npm run typecheck:booking                        # new at final
npm run test:typecheck:booking                   # new at final
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
npm run booking:test
npm run booking:build
~~~

New commands absent at baseline are expected. booking:test/build are real root scripts invoking the booking subproject's Vitest/build commands. Its existing utils.test.js is relevant regression coverage; do not invent names or alter tests to pass. Record actual test count/warnings/failures. If unrelated pre-existing test/build failures occur, retain baseline/final evidence and do not broaden scope, fake success or conceal them.

No fresh desktop/Manager builds required: their source/dependencies are unchanged here and prior reported builds remain prior evidence. Do not claim fresh checks you did not run. No broad brand audit, DB/hardware/Deno/live browser journey, npm ci/install, publish/sign/version/deploy. Retain known historical evidence and brand restrictions. Manual impact: no update required for comment-only helper typing with unchanged customer behaviour.

## Completion and stop

Add B02-D acceptance link and B02-E section additively to STATUS; one scoped PROJECT_STATE entry. Do not rewrite reviewer corrections/history. Full packet/self-review must distinguish actually saved pre-edit copies from current recovery copies, new verification from old reports, JS coverage from excluded surfaces and current correctness from unrecovered history. Include exact changed files, snapshots/status/hashes, caller trace, diagnostics/inventory, real guard/sabotage results, original-byte restorations, runtime equivalence, commands/manual impact and limitations.

Document exact targeted rollback: only new config/runner/three fixture files, two script entries, source annotations and scoped evidence/status blocks, with current-content preconditions. Directories only if empty; preserve earlier artifacts, reviews/acceptance, locks, unrelated/subsequent edits. No whole-file restore or broad delete. Do not actually roll back.

STOP B02-E PENDING REVIEW. No booking API/payment/React component, preload/Legacy/Deno, other B02 work or B03 authorized; no cross-chat messages.
