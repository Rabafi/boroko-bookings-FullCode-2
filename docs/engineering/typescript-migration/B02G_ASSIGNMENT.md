# B02-G assignment — checked desktop preload transport

Date: 2026-10-13 (Africa/Gaborone). Prerequisites: B01 and B02-A through B02-F ACCEPTED. Read PLAN.md, PROJECT_STATE.md, docs/ARCHITECTURE.md and evidence/B02F-acceptance.md. Follow current human/session instructions. This assignment authorizes B02-G only.

## Objective and deliberate scope

Establish a real checked preload transport using the actual installed Electron IpcRenderer type. Extract only the existing invoke/onIpc helper definitions into a small factory, wire the existing API to it, and verify transparency. This batch includes a SMALL RUNTIME EXTRACTION, not only annotations. Preserve all existing API members/channels/argument order, side effects, receivers, event/listener identity, promises, returned values and thrown errors.

src/preload/index.js is currently about 1,417 lines, already dirty, with one Electron import and a large API object. Do not annotate/migrate that whole object or invent request/result models here. Its API body and exposure branches stay byte-preserved apart from independently identified concurrent edits. Production checking covers the NEW transport helper, not the full bridge. Accepted coverage would become eight JS modules plus the existing Manager declaration. Deno checking, React, financial/queue contracts and later batches remain outstanding.

Reviewer evidence/B02G-reviewer-preflight.json contains the exact proposed helper/fixtures, real compiler inventories and synthetic VM preflight. It was generated IN MEMORY, with zero application code edits. It is assignment evidence, not implementer completion evidence. Preserve it. Reconfirm its results in your actual implementation.

## Facts checked by reviewer

- Installed root TypeScript 5.9.3, Electron 42.11.10 and @types/node 24.19.1.
- Root Electron declaration remains ^42.10.0; do not change this range or upgrade/install anything. Node typings declaration remains exact 24.19.1.
- Actual Electron type-only fixture compiles against the structural port with zero diagnostics.
- Each proposed program has 174 files: 61 pinned TypeScript libs + 66 root Node declarations + 43 root undici declarations + exact buffer/index.d.ts shim + exact electron/electron.d.ts + helper + own fixture.
- Current product preload build outputs are out/<product>/preload/index.mjs. Confirm actual output paths; do not assume .js/CJS from older notes.
- Two source-reading tests pin the current inline invoke helper: tests/production-guardrails.test.mjs and tests/bar-till-service.test.mjs. They need narrowly updated source-location assertions, with the original dumb-pipe behaviour retained and strengthened by executable transport tests.
- Other bridge/member/channel tests must remain unchanged. Do not fix the pre-existing bridge-contract parser or unrelated tests in this batch.

## Authentic baseline before edits

Inspect HEAD/full porcelain status and preserve the dirty tree. Save byte-exact inert pre-edit copies of src/preload/index.js, package.json, the two editable source-reading tests, STATUS.md and PROJECT_STATE.md. Generate path/hash tables from those saved bytes; verify equality at capture. Record all planned new implementation paths absent. Assignment/prompt/reviewer-preflight are intentionally already present.

Use NEW evidence/B02G-baseline.md, B02G-status-before.txt, B02G-snapshots/ and B02G-logs/. Resolve output roots; enforce containment and absent-destination checks; verify writes. No old-batch redirects, copied historical logs masquerading as new runs, or regenerated references masquerading as original snapshots. Capture before/after manifests of older migration evidence; never edit earlier logs/reviews/acceptances.

Hash all accepted sources/configs/fixtures/helpers/declarations/runners, all four lockfiles and subproject manifests/build configurations. Preserve the unrelated test:restaurant:ledger-disposable script added during Accounting work. If a live hash changes concurrently, identify the exact content delta and preserve it; do not restore from HEAD or assume newline-only drift. Overlapping transport/API edits require reconciliation before applying this extraction. Unrelated edits are not attributed to this batch.

## Exact editable scope

1. NEW src/preload/transport.js — exact helper factory below, active @ts-check/JSDoc.
2. src/preload/index.js — one local factory import, replace only the existing invoke/onIpc definitions with factory destructuring. No API/exposure/body edits.
3. NEW tsconfig.typecheck-preload.json.
4. NEW tests/typecheck/preload-transport/valid.ts, invalid.ts, tsconfig.invalid.json.
5. NEW scripts/typecheck-preload.mjs.
6. NEW tests/preload-transport.test.mjs — meaningful executable synthetic regression coverage, no real Electron import/device/network activity.
7. tests/production-guardrails.test.mjs and tests/bar-till-service.test.mjs — ONLY replace the old inline-helper location assertion with import/wiring + real helper forwarding assertions, retain adjacent financial/report/customer tests and no-error-cleaning assertions. Add the latter assertion on transport.js too where appropriate. No test deletion, relaxed channel checks or unrelated repairs.
8. package.json — exactly three new script entries below, no dependencies/version/other-script edits.
9. STATUS.md, one scoped PROJECT_STATE entry and new B02G evidence.

No prior checker/helper redesign, source renames, main/renderer/PWA/booking/Legacy/Supabase/SQL changes, global window.api declaration, new package/types installation, actual application launch, customer profiles/cache/queues, DB, hardware, mesh, signing, publishing, activation or commits. No cross-chat messages.

## Exact helper recipe and semantics

Use the prototypeSource text in reviewer-preflight.json as the starting helper. It defines a structural IpcRendererPort with only invoke, on and off. Real Electron compatibility is proven by the type-only fixture, not by a fake ambient module. Port results/events/payloads stay unknown; Electron's upstream Promise<any> is projected to unknown at this boundary without a cast.

~~~js
// @ts-check
/**
 * @typedef {Object} IpcRendererPort
 * @property {(channel: string, ...args: unknown[]) => Promise<unknown>} invoke
 * @property {(channel: string, listener: (event: unknown, value: unknown) => unknown) => unknown} on
 * @property {(channel: string, listener: (event: unknown, value: unknown) => unknown) => unknown} off
 */
/** @param {IpcRendererPort} ipcRenderer */
export function createPreloadTransport(ipcRenderer) {
  /** @param {string} channel @param {...unknown} args @returns {Promise<unknown>} */
  const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  /** @param {string} channel @param {(value: unknown) => unknown} cb @returns {() => unknown} */
  const onIpc = (channel, cb) => {
    /** @param {unknown} _ @param {unknown} value */
    const listener = (_, value) => cb(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  }
  return { invoke, onIpc }
}
~~~

Preserve these details exactly:

- invoke is NOT async: return the actual invoke promise as-is, with no wrapper/await/adoption, response clone/unpack or error rewriting.
- Call ipcRenderer methods as members so their receiver is preserved. Do not destructure invoke/on/off from the supplied object.
- Each subscription creates one distinct listener; ignore the event and pass ONLY the second argument, by identity. Extra event args are ignored as before. Return the callback's actual return value; no await/swallowing/coercion.
- Cleanup uses the SAME channel/listener and returns off's actual value. DO NOT replace the expression with a void block or annotate it as guaranteed void. Existing off may return the IpcRenderer object. Repeated cleanup calls still call off; do not add once/idempotency flags or delayed registration.
- Preserve registration/removal/callback/invoke synchronous throws and rejection object identity. No catch, retry, timeout, validation or special channel allowlist is introduced.
- The factory has no top-level side effects or input validation. It merely creates closures; preserve existing deferred failure when a supplied method is unusable.
- No any/casts/suppression/generic response T/branded payload claims. No promises of financial truth or response shape.

In index.js add:

~~~js
import { createPreloadTransport } from './transport.js'
~~~

Keep the existing Electron import/destructure and metadata comment. Replace only the two inline helper definitions with:

~~~js
const { invoke, onIpc } = createPreloadTransport(ipcRenderer)
~~~

Everything from const api = { through EOF must match the actual saved baseline bytes unless an explicitly documented concurrent unrelated edit intervenes. API export/exposure names, webUtils, process.contextIsolated, fallback window.api and catch/error behaviour are untouched. No new exposed API method or privilege.

## Configuration, manifest and fixtures

~~~json
{
  "extends": "./tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "checkJs": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "files": [
    "src/preload/transport.js",
    "tests/typecheck/preload-transport/valid.ts"
  ],
  "include": []
}
~~~

Three manifest script additions only:

~~~json
{
  "typecheck:preload": "tsc --project tsconfig.typecheck-preload.json --pretty false",
  "test:typecheck:preload": "node scripts/typecheck-preload.mjs",
  "test:preload-transport": "node --test tests/preload-transport.test.mjs"
}
~~~

Use EXACT validFixture and invalidFixture strings in reviewer-preflight.json (no extra header shifting lines). They import the REAL helper and type-only IpcRenderer from the REAL installed electron package. Ambient declare const in a compile-only fixture supplies a real typed consumer, not a fake Electron implementation. Never execute either fixture (they include document/process and a non-runtime declared instance).

Positive proves actual Electron assignability, unknown promise/result/cleanup boundary, string narrowing, real Node+DOM+DOM.Iterable typing. Negative diagnostics under pinned 5.9.3:

- TS2345 L5: non-string channel.
- TS2345 L6: callback assumes payload string instead of narrowing unknown.
- TS2322 L7: unknown result cannot become Promise<string>.
- TS2339 L8: cleanup is a function, no invented missing property.
- TS2322 L9: cleanup's opaque result cannot become string.
- TS2304 L10: Manager build global is not injected.

Negative config:

~~~json
{
  "extends": "../../../tsconfig.typecheck-preload.json",
  "files": [
    "../../../src/preload/transport.js",
    "./invalid.ts"
  ],
  "include": []
}
~~~

## Real runner assertions and safeguards

Use root pinned TypeScript API. Reuse only pure STRICT_SUBOPTIONS/assertJsChecked/isStdLibFile helpers by import; no executable prior-runner imports/edits.

Both actual programs must use the same throwing assertions for:

- Exact effective ES2022/NodeNext/NodeNext enums, esModuleInterop:true, checkJs/allowJs/noEmit/strict true, skipLibCheck:false/casing:true, all nine strict defaults (explicit false rejected), ordered [lib.es2022.d.ts, lib.dom.d.ts, lib.dom.iterable.d.ts], explicit types:[node].
- Required helper + own fixture, active @ts-check on actual helper, no unintended production/app files.
- Pinned compiler 5.9.3; declared/resolved @types/node exact 24.19.1; real Electron declaration provenance and installed 42.11.10 against the existing ^42.10.0 manifest declaration. Report/stop on unexpected dependency drift; do not install or alter manifest range to force the preflight.
- Exactly zero positive diagnostics. In negative: zero production/dependency/other diagnostics; exactly SIX intended fixture errors, actual file/line/category/code. No declaration-error exemption.

Provenance: use the STATIC 61 TypeScript library basenames and actual dependency file inventories recorded in reviewer preflight, copied as literals to this runner (not a live-derived allowlist or a runtime read of the evidence file). Verify actual pinned library directory. Allow only real root @types/node/undici .d.ts provenance (or the exact recorded declarations), exact buffer/index.d.ts and exact electron/electron.d.ts. No blanket node_modules exception, nested Node22, fake Electron declarations, Vite/Manager/global API declarations or other app source. Record 174-file inventories/groups; any drift is investigated, not concealed by widening the rule.

Same-function guards: accepted REAL program file inventory (not config roots), missing source/fixture, unexpected app/ambient file, outside-directory stdlib/Electron impostor, unexpected pinned webworker/ESNext lib not in the static closure, wrong target/module/resolution, omitted/extra lib, omitted/wrong types, checkJs:false, each disabled strict sub-option, absent source directive, wrong/missing dependency metadata. Metadata probes call the SAME real validator with injectable inert readers/values, not a hardcoded independent check. Count cases actually executed; no required magic historical count.

Integrated variants: absence of directive fails actual source assertion; an unexpected declaration/reference fails actual inventory; replace the numeric channel misuse with string while retaining the full original marker in a same-line comment — actual source remains error-free, SIX -> FIVE fixture errors, actual negative assertion rejects that gap. Do not compensate with a new error.

For the integrated forbidden-library reference use exactly /// <reference lib="esnext.array" /> on a virtual positive fixture. Reviewer preflight confirms it adds ONLY lib.esnext.array.d.ts and causes ZERO compiler diagnostics, so the inventory safeguard must supply the rejection. DOM is required in this preload profile and is NOT a forbidden-library probe. The original wrapper-disabled pair must use this same esnext.array input and fail via inventory-accepted on the actual contaminated program, not from unrelated compiler errors.

No-op sensitivity must target the ACTUAL assertions with reporting shape preserved: extracted inventory assertion disabled must fail a required-file guard; real CLI inventory wrapper disabled plus a virtual forbidden library reference must fail accepted-real-inventory guard; actual negative assertion disabled must fail the disappeared-rejection safeguard. Normalize Windows paths and preserve real resolution anchors; use child stdin for large variants. Only intended failures count, never missing-root/import/TypeError accidents. Do not mutate the live helper/index for probes.

Save ORIGINAL new fixture/config bytes before fixture sabotage. Missing valid => TS6053/nonzero, excluded negative => required-file failure, all-benign => intended marker/count failure. Restore from saved ORIGINAL bytes, verify full equality, final green. No recreated reference substitution.

## Meaningful runtime tests and equivalence

New permanent Node tests import the ACTUAL helper and use synthetic receiver-sensitive ports. No real Electron runtime is loaded. Cover:

- Variadic channel/arg order, null/undefined/object identity, member receiver, exact invoke promise identity.
- Metadata-envelope/array payload identity including _source/_complete (transport passes opaque values, never unpacks/relabels them).
- Invoke synchronous throw identity and rejection object identity.
- Two subscriptions have distinct listeners; event object is never passed to callback; second value identity/extra-arg omission/callback return and throw identity.
- Cleanup exact channel/listener/receiver, off result identity, repeated calls and removal throw identity.
- Full live preload VM bootstrap uses the real imported factory and synthetic electron/process/window, proving helper wiring in BOTH contextIsolated branches, exposed name/key shape, representative invoke/event methods and existing exposure-error handling. Strip only the exact known import declarations with fail-closed match counts; do not evaluate a separately copied API object or real app. Compare baseline snapshot/current full API shape and the byte-preserved API/exposure suffix. Baseline bytes are inert evidence, never a customer profile.

Demonstrate the runtime tests catch at least two intentional semantic variants: async invoke (promise identity changes), event forwarded instead of value, or cleanup return discarded. Prefer fresh child Node registerHooks load interception for ONLY the real helper URL (nextLoad first, return a module source override), real tests unchanged; or an isolated disposable-copy harness with explicit real anchors. No disk sabotage of live production helper/index. Control must pass; variants must fail the intended assertion, not module-resolution errors. No duplicated test logic as proof. Restore/cleanup/hash-check any scratch artifacts.

Transpilation is NOT byte-identical for an extraction. Do not claim it is. Evidence is exact API-tail preservation, actual runtime equivalence tests, baseline-vs-current synthetic bootstrap and the real product builds. VM/mocks do not certify real contextBridge serialization, installed-device journeys or hardware; state that limitation explicitly.

## Validation and build gates (serial)

Inspect actual existing test bodies/scripts for side effects before running. Before edits capture:

~~~text
node tests/production-guardrails.test.mjs
node --test tests/bar-till-service.test.mjs
node --test tests/bridge-contract.test.mjs
node --test tests/enterprise-entitlement-gating.test.mjs
npm run build
node scripts/product-app.mjs hotel build
npm run build:hospitality-pos
~~~

After implementation:

~~~text
node --check src/preload/transport.js
node --check scripts/typecheck-preload.mjs
npm run typecheck:preload
npm run test:typecheck:preload
npm run test:preload-transport
node tests/production-guardrails.test.mjs
node --test tests/bar-till-service.test.mjs
node --test tests/bridge-contract.test.mjs
node --test tests/enterprise-entitlement-gating.test.mjs
npm run test:typecheck:legacy-shared
npm run test:typecheck:booking
npm run test:typecheck:manager
npm run test:typecheck:renderer
npm run test:typecheck:main
npm run test:typecheck:shared
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

Do not run concurrently against shared out trees. Record exits/counts/warnings and actual emitted preload paths. Builds regenerate local product out files; no dist/release/publish/version/sign/deploy/app launch. Existing unrelated baseline failures stay disclosed; compare exact failure before/after, do not alter tests/business logic to green them. A new transport/build regression blocks acceptance. Broad brand audit remains excluded because of the known secret-preview incident. No Manager/booking/Legacy builds needed, their code unchanged.

Keep durable batch-specific logs, no .env/key/profile/queue/browser-storage copies. Scoped diff --check/escape scan; report unrelated whole-tree whitespace without fixing it. If a prerequisite/check is unavailable, identify it honestly; do not report full preload or financial release readiness.

## Completion and stop

Report exact changed paths, helper wiring and real Electron compatibility, full compiler inventories/diagnostics, meaningful guard/runtime sensitivity, authentic baseline/restores, raw-Node consumption and three emitted product builds, failures versus baseline and concurrent-change provenance. Complete self-review per PLAN. Runtime/helper extraction is not a comment-only change.

Manual impact: no update required only if tests demonstrate identical customer-visible messages/navigation/behaviour/equipment support; explain this INTERNAL TRANSPORT EXTRACTION explicitly. If behaviour differs, stop and report a regression, do not update a manual to normalize it.

Targeted rollback instructions: inverse only the new import/factory binding and restore the two original helper definitions from their exact baseline hunk (never whole-file HEAD restore); inverse only the two test-location hunks; remove only three manifest scripts/new owned files with current-content/reference checks. Keep unrelated Accounting script, concurrent API edits and all accepted evidence/locks; directories only if empty. Do not perform rollback.

Update STATUS additively with B02-F acceptance link and B02-G PENDING REVIEW; one scoped PROJECT_STATE entry, baseline/report/logs/snapshots. Preserve every earlier acceptance/review/prompt/probe. STOP PENDING REVIEW. No B02-H/Deno, B03, whole API typing, financial/queue/hardware migration or cross-chat messages authorized.
