# B02-B assignment — Node-only desktop-main pilot

Date: 2026-10-09. Prerequisites: B01 and B02-A accepted.
Read evidence/B02A-acceptance.md, the full migration plan and AGENTS.md before work.

## Objective

Establish a strict Node-only desktop-main configuration by checking src/main/domains/fileStore.js. Preserve every runtime statement, file format, fallback/error behaviour, import and export.

This is a one-module Node pilot, NOT coverage of all main-process code or Electron APIs. Cumulative production coverage will be three distinct files: product-config, brandIdentity, and fileStore.

## Current facts, to reconfirm

fileStore.js imports fs and path and exports ensureDir, readJsonFile and writeJsonFile. It is small and dependency-free beyond Node builtins.

- ensureDir does nothing for falsy input; otherwise creates a missing directory recursively.
- readJsonFile returns parsed data; on read OR parse error returns the caller's fallback unchanged.
- writeJsonFile ensures the parent directory, then writes JSON.stringify(value, null, 2) with utf-8 encoding.
- No runtime schema validation exists. Supplying a shaped fallback does NOT establish that successfully parsed data has that shape.
- Parsed primitives, null, arrays and objects remain possible. Do not replace unknown data with an unchecked generic T return.
- Writes can throw; arbitrary values are not guaranteed serializable. Do not introduce promises, swallow errors, change encoding, make writes atomic, or change serialization in this typing task.
- Callers: infrastructure.js re-exports the helpers; backupPolicy.js and profiles.js use them. Profiles includes local/cache/queue file paths. Trace but do not type or edit these callers yet.
- Reviewer runtime probe: installed Electron 42.11.10 uses Node 24.19.0; development Node is 24.14.0. Reconfirm actual versions, never infer from the manifest range.
- Currently resolvable @types/node is transitive 25.5.0, not directly declared. Select a verified exact released Node-24 typing version and declare it directly. Do not upgrade runtime packages to match typings.

## Capture before editing

Save actual byte-exact inert .txt snapshots and hashes of every editable existing file BEFORE edits: fileStore.js, package.json, package-lock.json, STATUS.md, PROJECT_STATE.md, and the two editorial files listed below. Record full timestamped status and HEAD in evidence/B02B-baseline.md and B02B-status-before.txt. Save durable baseline/final logs under B02B-logs/.

No .env copies, real profiles/queues, credentials or financial records. Preserve unrelated dirty work. Record planned new files as absent.

## Exact editable paths

- src/main/domains/fileStore.js: @ts-check and JSDoc ONLY.
- Root package.json: pinned @types/node development dependency and two new scripts.
- Root package-lock.json: only the justified dependency delta, preserving prior work.
- New tsconfig.typecheck-main.json.
- New scripts/typecheck-main.mjs.
- New tests/typecheck/main-file-store/valid.ts, invalid.ts, tsconfig.invalid.json.
- Migration STATUS.md; new evidence/B02B-* files/directories; one scoped PROJECT_STATE entry.
- Editorial only: src/shared/brandIdentity.js getter comment (“known IDs resolve their own brand; ordinary unsupported IDs fall back to LodgingOS”).
- Editorial only: evidence/B02A-report.md sabotage wording to distinguish changing the literal (marker failure) from widening the type (diagnostic-count failure). No fabricated historical logs.

Do not alter B01/B02-A executable checkers/configs/fixtures, existing callers, other main modules, release/build configs, app IDs/feeds, SQL, queue files, or customer manuals. No new helper outside the listed paths.

## Dependency discipline

Read install hooks and snapshot the lockfile before install. Verify the chosen @types/node 24.x exact version supports pinned TypeScript 5.9.3 and the current runtime APIs. Record package metadata/version/choice.

Use a narrow development dependency addition with save-exact and ignore-scripts. No floating range, audit fix, npm ci, lockfile recreation, or unrelated upgrades. If the update introduces unrelated churn, isolate/report it instead of accepting it silently. Existing Node-dependent packages may legitimately need a nested different @types/node version; document resulting resolution. The main checker must resolve the directly declared Node-24 types.

## Starting configuration

Create tsconfig.typecheck-main.json:
~~~json
{
  "extends": "./tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "checkJs": true,
    "types": ["node"]
  },
  "files": [
    "src/main/domains/fileStore.js",
    "tests/typecheck/main-file-store/valid.ts"
  ],
  "include": []
}
~~~

Keep inherited ES2022, strict, noEmit, lib ES2022, skipLibCheck:false and casing enforcement. NodeNext matches raw ESM Node consumers; no runtime emit/build change occurs.

This pilot does not need Electron declarations or DOM libs. Allow genuine Node typing dependencies such as undici-types where required by the selected package; do not mistake Node-provided URL/fetch declarations for permission to import browser application code.

## Type-only contract

Add active @ts-check and truthful JSDoc:
- ensureDir: supported Node PathLike/nullish optional input, void result; preserve no-op and mkdir semantics.
- readJsonFile: supported Node PathOrFileDescriptor input, optional unknown fallback, unknown result.
- writeJsonFile: string path (path.dirname needs a string), unknown value, void result; may throw.

Use types from the actual node:fs declarations, not manually invented aliases. If the selected type package uses a different alias, verify it and document it.

Do not use generic readJsonFile<T> returning T, assert parsed JSON is the fallback's type, or add casts. Unknown is required at the unvalidated JSON boundary. Caller narrowing/validators are future assignments.

No runtime guards, coercion, helper extraction, async changes, catch broadening, JSON schema changes or filesystem implementation changes.

## Fixtures and checker

Add:
~~~json
{
  "typecheck:main": "tsc --project tsconfig.typecheck-main.json --pretty false",
  "test:typecheck:main": "node scripts/typecheck-main.mjs"
}
~~~

valid.ts imports the real fileStore module. Compile-only examples:
- ensureDir with a string, null and no argument.
- readJsonFile with supported paths and an optional fallback; result retained as unknown even when fallback is a shaped object.
- writeJsonFile with string path and an ordinary object.
- Actual Node builtin imports resolve.
Never execute either fixture: the valid fixture also contains filesystem calls.

invalid.ts proves:
- Unsupported ensureDir input is rejected.
- Non-string writeJsonFile path is rejected.
- Reading a property from the readJsonFile result without narrowing is rejected.
- An ambient browser-only global such as document is unavailable.
Record exact intended line/category/code diagnostics from pinned 5.9.3. Erroring imports cannot substitute for intended misuse.

The negative config extends ../../../tsconfig.typecheck-main.json and overrides files to the production helper plus its own fixture, include:[].

The runner parses inherited configs and validates effective NodeNext module/resolution, ES2022 target/lib, esModuleInterop:true, checkJs:true, strict/default sub-options, noEmit, explicit types:["node"], installed compiler 5.9.3 and directly resolved Node typings major 24.

Require one production file plus intended fixture and verified compiler/Node declaration dependencies. Enumerate the actual dependency closure with provenance; no other maintained app files, DOM libs, renderer/PWA/Legacy/Deno declarations or extra ambient packages. Do not use an unrestricted node_modules exclusion to conceal unexpected globals.

Require active JS checking, zero positive diagnostics, exact intended negative diagnostics, and no production-source errors. Never emit/import fixtures. Preserve B01/B02-A independently.

Guard/failure checks must demonstrate:
- Wrong module/resolution/runtime typing major and added DOM/ambient package are rejected.
- checkJs:false, disabled strict settings, omitted source/fixture and suppressed negative errors are rejected.
- Failure has the intended reason, not a missing compiler/environment accident.
Use isolated copies or in-memory programs for production-source guard probes; never weaken actual source. Restore new-fixture/config sabotage exactly and rerun final green checks.

Do not redesign all checkers into a framework during this task. Small pure predicate reuse is permitted without editing prior helpers.

## Runtime equivalence and safe probes

Compare comment-free pre/post syntax. Runtime statements must match exactly.

If executing temporary equivalence probes, use a unique synthetic scratch directory whose resolved path is checked before recursive cleanup. Never read/write actual customer cache/profile/queue/config files.

Compare baseline/current behaviour for:
- Missing/existing directories.
- Valid JSON including primitives/null/arrays.
- Missing/malformed JSON returning the exact fallback object by identity.
- Omitted fallback remaining undefined on failure.
- Written bytes/indentation/encoding and existing thrown-error behaviour.

These may be temporary comparison probes; do not add redundant production tests just to mirror unchanged implementation. Preserve the helper's existing failure semantics. No new financial or offline-runtime claims.

## Validation

Inspect script bodies and prerequisites first. Baseline/final commands, serial:
~~~text
node --check scripts/typecheck-main.mjs
npm run typecheck:main                    # new
npm run test:typecheck:main               # new
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

Full builds run serially after dependency resolution changes. No publish/dist/deployment/version/database operations. Manager/PWA source is unchanged; repeat manager checks only if dependency resolution or another concrete concern affects it.

Do not rerun the known broad brand audit to validate editorial comments: retained baseline failures are already recorded, and that scanner included a sensitive environment preview. Avoid producing new secret-bearing logs.

## Completion and stop

Return the standard packet/self-review, actual snapshots/status/hashes/logs, attributable dependency diff and resolved Node type version, compiler file inventory, exact diagnostics/guard failures, runtime comparison, manual impact, baseline-versus-new failures, and exact rollback preserving accepted earlier batches.

Call this “one Node-only desktop-main helper checked,” not all main code or Electron IPC checked. Record B02-B reviewer status PENDING and STOP. Preload/renderer, remaining main modules, PWA/Legacy/Deno configs and B03 remain unassigned.
