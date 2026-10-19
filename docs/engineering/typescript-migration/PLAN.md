# Tsa Bonno HospitalityOS: gradual TypeScript migration

Prepared: 2026-10-09. This is an implementation and review plan, not deployment authorization or a statement of release readiness.

## 1. Outcome

Introduce useful strict TypeScript checking while preserving application behaviour. Keep payments, bookings, stock, authorization, reports, hardware, and offline contracts intact. Complete connected feature and contract families in large implementation batches, with independent review of stable milestones.

The end-to-end target covers maintained production code in desktop main/preload/renderer, shared packages, Manager PWA, public booking site, Legacy POS, and existing Supabase Edge Functions. JavaScript with checked JSDoc is acceptable when raw Node consumers or compatibility make that the better choice. Renaming every file is not the success metric.

SQL stays SQL. Third-party/generated code, archived applications/migrations, scratch output, and document-generation tools are outside the application migration unless a later assignment includes them. Tests/build scripts need conversion only when necessary to support checking/execution. Record exclusions explicitly.

The original first assignment authorized B00 and B01 only. Subsequent human authorizations and the execution amendment below govern current work; the original restriction is historical.

### 1.1 Human-approved end state and execution amendment — 2026-10-16

This amendment records the user's instruction to retain the gradual approach, clarify its end state, and accelerate implementation without restarting or discarding completed work. It supersedes conflicting older operational directions in this document about small batches, per-file approval, manual cross-chat relaying, and agent use. Historical evidence and earlier acceptance limitations remain intact.

**End state.** Strict checking covers all maintained production application code across the runtimes listed above. Use native `.ts`/`.tsx` for complex application modules and contracts where it improves maintainability; retain strictly checked JavaScript/JSDoc where raw Node execution, package consumers, or runtime compatibility make that useful. This is a deliberate mixed end state, not a requirement to rename every file or retain every file as JavaScript. A clean subset, added comments, or a changed extension does not establish completion.

**How to convert.** Resolve a connected contract through its real producers and consumers. Within an owned family, choose native TypeScript when it simplifies complex annotations and the existing toolchain can execute/build it correctly. Check imports, package entrypoints, emitted/runtime paths, tests and runtime-specific targets before changing extensions. Preserve raw Node consumers and Legacy compatibility; do not mass-rename files, introduce an unrelated toolchain overhaul, or rewrite working business logic to satisfy types. Existing useful JSDoc work is retained and can support later native conversion. Document compatibility exceptions once per family rather than producing a report for every file.

**Implementation unit.** Workers complete coherent feature families: for example, RPC/query producers, successful and fallback envelopes, IPC/preload contracts, renderer state/props, and connected callers together. They continue through the shared diagnostic causes rather than handing off after a few scalar annotations. File count is not a quota. Maintain exclusive ownership and use the existing multi-agent model; the implementation coordinator owns shared contracts, integration, and full checks. Do not overlap writers or full compiler jobs.

**Verification cadence.** Workers use source inspection and relevant focused checks while implementing. The coordinator runs full compiler profiles and builds serially at meaningful integrated checkpoints, not after each helper. Reuse applicable passing evidence for unchanged code. For annotation-only work, use executable-syntax equivalence and appropriate checking; reserve behavioral tests for runtime/import/build changes and critical financial, authorization, offline and recovery contracts. Do not add elaborate per-module checker runners or repeated evidence packets where an existing family-level safeguard suffices. Preserve strict options, actual-program inventories, negative fixtures and runtime/global isolation.

**Review and continuation.** Luna and its workers implement; the reviewer independently inspects stable changes, verifies relevant evidence, and sends concrete corrections or acceptance directly to Luna under the user's standing authorization. Current L01 foundations and L02 desktop main/preload plus connected renderer callers may proceed in parallel. L03 and L04 follow their existing milestone assignments after the relevant independent acceptance. No per-file approval gate is reintroduced. Routine corrections are folded into active large batches without stopping unrelated owners. Never call an implementer PASS independent acceptance.

**Completion evidence.** Report actually checked production coverage, whole-profile diagnostics at fixed or explicitly explained inventories/settings, newly clean sources, completed connected contracts, relevant behavior/build results and open blockers. Resolve all required checks or explicitly approved exclusions before declaring migration completion; finish L04 coverage/CI/final integration and independent review. Do not infer a completion percentage from renamed/edited files, directive counts or isolated passing fixtures. Deployed schema parity, hardware verification and release readiness require their own evidence.

All preservation and security boundaries remain in force. No deployment, signing, version bump, production database/provider/hardware action, commit or push is authorized by this amendment. Customer releases require independent verification and separate release authorization.

### 1.2 User-approved removal of milestone acceptance gates — 2026-10-18

The user has explicitly authorized implementation to continue through all remaining migration work without waiting for independent acceptance between L01/L02, L03, and L04. This supersedes only the acceptance-gating sentence in §1.1 Review and continuation and any later statement that implementation must stop between these milestones. CP49 and earlier reviews remain pending/unchanged where recorded; their pending status is not a reason to pause implementation. The reviewer may send corrections while work continues, and Luna folds concrete, scope-relevant corrections into the active batch after an ownership/freeze check. Independent acceptance remains separate from implementation and is still required before claiming migration completion or release readiness.

The original remaining assignments continue as authorized: L03 Agent A desktop renderer; Agent B Manager PWA and public booking site; Agent C Legacy POS, with the coordinator retaining shared contracts, runtime configuration, integration, and serial full checks. L04 remains coordinator-led: reconcile every maintained production file against actual program inventories; enforce strict per-runtime checking and positive-only aggregate coverage; add the dedicated typecheck CI workflow while preserving release/backup workflows; run applicable serial checks/builds; and prepare targeted rollback and final handoff. Current L01/L02 work may continue in parallel with independent review and across separate owned files. Preserve exclusive edit ownership, historical evidence, review findings, strictness, coverage safeguards, and every application behavior/safety constraint.

## 2. Repository facts to reconfirm

- Main desktop uses JavaScript/JSX, React 19, Electron, Node, and electron-vite. The database.js facade delegates to domain modules.
- Desktop writes pass through preload/IPC to authoritative RPCs. Manager PWA connects directly to Supabase and has a limited device-local operational queue. Public bookings use public server-enforced contracts.
- Legacy POS is separate, with Electron 22, React 18, its own cache/queue, authenticated mesh, and release settings.
- The main desktop queue is JSON/JSONL-backed. Do not invent a SQLite migration or new offline business model.
- Existing TypeScript includes supabase/functions/send-push/index.ts and supabase/functions/send-booking-confirmation/index.ts; these run in Deno.
- The inspected production folders contain approximately 552 JS/JSX/TS-family files and 220,000 nonblank lines. This excludes many repository tools and is not a migration complexity audit.
- There are extensive tracked/untracked changes, including package manifests/lockfiles, financial domains, IPC, tests, SQL, and Bar documentation. They belong to existing work and must survive.
- Current PROJECT_STATE.md records open release/runtime verification gates. Recheck current evidence; do not repeat historical pass/fail counts as fresh results.
- SHIP_READY_RUNBOOK.md contains older migration-tip descriptions. Do not infer live deployment facts from those descriptions or local SQL.

## 3. Roles and review handoff

Implementer: inspect current code, edit only the assigned scope, run checks, produce evidence, disclose uncertainty. Do not self-approve, spawn agents, or message other chats without explicit user authorization.

Reviewer: choose exact scope, trace contracts/callers, independently inspect the diff and verification, then issue ACCEPTED, CHANGES REQUIRED, or BLOCKED. Acceptance concerns the batch, not customer release.

Human: relay completion packets and reviewer assignments between separate chats. Neither model should assume it automatically sees the other chat or has permission to message it.

Every later assignment must contain: batch ID, objective, exact editable paths, preserved contracts, exact commands, runtime evidence required, and stop conditions. Every correction must identify a concrete defect and acceptance test.

Stop after each batch pending review. Within an assigned batch, proceed autonomously through ordinary reversible work; do not repeatedly request permission already supplied.

## 4. Mandatory rules

1. Read AGENTS.md, dated PROJECT_STATE.md, and docs/ARCHITECTURE.md; consult the release runbook for release-related requirements.
2. Record baseline status. Never reset, clean, stash, delete, or overwrite unrelated work. Do not commit/push unless asked. Use the existing checkout for the pilot: a clean checkout from HEAD would omit current uncommitted implementation.
3. Keep type-only changes separate from fixes. Record newly exposed behavioural defects and request a separate reviewer assignment. Do not change business logic or weaken types to conceal them.
4. Preserve exports, default values, import side effects, property presence, null/undefined semantics, exceptions, asynchronous sequencing, listener cleanup, retries, and serialization.
5. Preserve RPC names/payloads, stable operation IDs/idempotency keys, tenancy/outlet/capability checks, authoritative balances/statuses, and audit/ledger trails. Never create a new key after an ambiguous timeout.
6. Preserve desktop, Legacy, and PWA persisted queues and signed mesh payloads. No storage-format/version changes during typing.
7. No SQL changes, project relinking, secret changes, customer-profile changes, application/update-feed identity changes, version changes, Accounting activation, signing, publication, or deployment.
8. No production transactions. Inspect test launchers before execution. Database mutation/reset/financial fixtures require a currently authorized disposable environment, verified identity, and existing guardrails. Historical project-state entries are not new authorization. Respect explicit authorization already present in the implementing session.
9. No blanket any, @ts-ignore, @ts-nocheck, as unknown as, fake ambient modules, or optional-everything result types. Narrow unavoidable upstream any at a documented boundary. Use unknown honestly; narrowing must follow real runtime guarantees. New runtime validators need separate behaviour review.
10. @ts-expect-error is allowed only in intentional negative compile fixtures, with a description of the rejected usage. Production diagnostics must be resolved or reported.
11. Do not change money representation, arithmetic, rounding, date parsing, or time zones. Type the existing wire representation.
12. Record Bar manual impact. Compile-time-only work may state: “No manual update required: compile-time checking only; operator behaviour and guides unchanged.” Actual customer-facing changes require the full repository manual/package workflow.
13. Do not print/copy secrets, .env contents, tokens, real customer queues, or personal financial records into migration evidence.

## 5. Compiler design

Start with a separate checker, retaining the current build pipeline. Use strict checking, noEmit, and allowJs. For the pilot, leave global checkJs off and opt in the one JS module using @ts-check. TS fixtures are checked normally. Add accepted files deliberately; later checked scopes can use checkJs: true.

Select and pin a TypeScript version compatible with the installed development runtime; verify compiler options at implementation time. Add only necessary dev dependencies. Do not upgrade React, Electron, Vite, Supabase, or unrelated packages. Root postinstall currently rebuilds Electron dependencies: inspect install hooks and avoid unrelated install side effects where appropriate. Verify builds separately. Do not recreate a lockfile from scratch.

Use isolated configurations:

| Scope | Requirements |
|---|---|
| Shared pure code | Avoid unintended Node, DOM, or Deno globals |
| Desktop main | Installed Electron/Node APIs and actual module semantics |
| Desktop preload | Bridge types without expanding exposed privileges |
| Desktop renderer | DOM, JSX, React 19, assets, Vite globals/aliases |
| PWA / booking site | Each app's dependencies, browser globals, aliases and build constants |
| Legacy main/preload/renderer | Electron 22 / React 18 and current runtime/output target |
| Edge Functions | Real Deno checking, isolated from Node/browser configs |

Share only settings valid for all scopes. Match compiler resolution with real bundler/runtime resolution. Narrowly declare genuine build globals/assets. Do not globally inject window.api, Deno, DOM, or Node into every scope.

Include patterns do not limit imported dependencies: inspect the compiler's actual file list and report expansion. Empty/excluded scopes do not count as coverage.

Vite transpilation is not type checking. Keep explicit checker commands. Before renaming modules, define and verify the raw Node test/script execution strategy. Do not assume native TS support in an unverified Node runtime. Preserve JS/JSDoc entry points initially.

References: [allowJs](https://www.typescriptlang.org/tsconfig/allowJs.html), [checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html), [Vite TypeScript handling](https://vite.dev/guide/features.html).

## 6. B00 — inventory and baseline

Create docs/engineering/typescript-migration/STATUS.md and evidence/B00-baseline.md.

Record date, HEAD, dirty-tree summary, baseline state of B01-editable files, Node/npm versions, manifests, installed tools, source inventory, CI checks, and relevant prerequisites. Keep raw local diffs/snapshots for the files being edited so migration changes can be distinguished from pre-existing edits. Avoid secrets.

Trace packages/product-config/index.js. It exports frozen PRODUCTS and PRODUCT_IDS; its package exports ./index.js. Raw Node consumers include scripts/product-app.mjs, and electron.vite.config.js also imports it. Reconfirm these facts. Preserve the JS entry and runtime shapes.

Inspect B01 validation commands and test bodies for side effects, then record their baseline results. Identify exact existing failures and environmental limitations. Independent tooling can proceed beside a documented unrelated failure, but no green-release claim is permitted. If pilot behaviour cannot be established, stop the affected implementation.

Exit: baseline evidence, clear preservation of existing work, and safe verification prerequisites.

## 7. B01 — tooling plus a checked JavaScript pilot

This first batch keeps the existing JS entry point.

Editable paths:

- Root package.json/package-lock.json: pinned TypeScript dev dependency and new pilot scripts only; preserve existing edits.
- New tsconfig.typecheck-pilot.json.
- packages/product-config/index.js: @ts-check/JSDoc only, no runtime statement changes or rename.
- New tests/typecheck/product-config/ files.
- New scripts/typecheck-pilot.mjs: required compiler/fixture self-check runner.
- STATUS.md and evidence/B00-baseline.md, evidence/B01-report.md in this plan's folder.
- PROJECT_STATE.md: one accurate tooling-status entry; preserve existing content.

Implementation:

1. Add new typecheck:pilot and test:typecheck:pilot scripts. These scripts do not currently exist.
2. Derive product ID types from real runtime definitions where possible. Preserve IDs/modes and freezing exactly; do not create a second authoritative configuration.
3. Use an actual imported-module consumer to prove lodge-camp, hotel, and hospitality-pos are accepted while an unsupported product ID is rejected. Prove readonly typing rejects mutations of PRODUCT_IDS and frozen definitions. Unused standalone types do not count.
4. Check fixtures without executing intentionally invalid runtime calls. Expected diagnostics must be specific to the intended misuse. The checker must fail if a negative error disappears or fixtures are excluded; a typoed import is not useful type-safety evidence.
5. Compare runtime exports/freeze behaviour with baseline and verify raw Node imports still work. A temporary equivalence check is sufficient; avoid redundant tests that mirror unchanged constants.
6. Record exactly what production source is checked. Do not describe this small pilot as financial coverage or application-wide migration.

Validation; reconfirm existing scripts before running:

~~~text
npm run typecheck:pilot                  # new
npm run test:typecheck:pilot             # new
npm run workspace:check
npm run test:products
npm run test:release-architecture
npm run products:list
npm run build
node scripts/product-app.mjs hotel build
npm run build:hospitality-pos
~~~

Run the three product builds serially. No dist/publish/release/version/database commands. Inspect lockfile churn and actual checked-file lists. Record exit codes, expected-error evidence, runtime comparison, baseline failures, and Bar impact.

Exit: useful strict checking works, raw JS imports/builds remain compatible, and no application behaviour changes. STOP and return the B01 completion packet for review.

## 8. B02 — configurations and execution strategy

After B01 acceptance, establish each runtime configuration in separate assignments: shared pure code, desktop main, preload, renderer, PWA, booking site, Legacy, Edge Functions. Reviewer chooses exact modules/paths before each assignment.

Add matching type packages only where needed. Do not force React 18/19 or Electron versions into inaccurate shared globals. Preserve Legacy CommonJS output and old-hardware target. Use compatible Deno checking for Edge Functions; do not invent Deno ambient declarations to silence tsc.

Choose and verify future .ts/.tsx consumption by bundlers and raw Node tests/scripts. Keep direct Node entry points in checked JS initially. Any TS execution bridge, test runner change, or entry-point rename gets a separate reviewed batch.

Exit: a nonempty real checked scope in each environment with valid build/execution paths and isolated globals. Missing Deno/legacy-runtime prerequisites remain explicit gaps.

## 9. B03 — shared/external contract register

Create small batches covering IDs, current money/date wire representations, local pending versus confirmed records, RPC requests/results, report completeness, errors/denials, and queue envelopes.

For each contract record: producer, all consumers, authoritative evidence, schema/deployment boundary, nullability, failure variants, and legacy compatibility. Verify current source and later migrations rather than copying historical audits.

Include Electron IPC array metadata envelopes and renderer unpacking: the bridge can strip custom array properties. Preserve _source/_complete semantics instead of replacing them with plain arrays.

Use discriminated unions only when the existing data has a real discriminator. Do not add serialized tags/fields for typing convenience. Preserve omitted versus null. Failure/incomplete data must not become an empty successful report. Keep estimates distinct from server-confirmed truth.

Generated database types are optional. Generation needs a permitted read-only source identity; record which schema produced them. Local SQL is not proof of deployed RPCs. Without permitted verification, declare deployment parity unknown.

Exit: types connect to checked implementations/callers, intentional misuse is rejected, and runtime/wire behaviour remains unchanged.

## 10. B04 — desktop migration

Order small complete slices: pure utilities/read adapters, selected IPC methods end-to-end, operational domains, financial/stock domains, offline replay/mesh, then renderer components.

Each assignment traces main handler, preload method, renderer calls, applicable queued operations, and reporting. A window.api declaration unconnected to the implementation is not acceptance. Preserve channels, argument order, envelopes, events, unsubscribe functions, capabilities, errors, and recovery guidance.

Keep database.js compatibility and all product launch paths. Critical slices require evidence for same-key retry, ambiguous/lost response, conflicting payloads, persisted old-queue replay after restart, completeness, and authorization/tenancy as applicable. Types alone do not certify those behaviours.

Before renaming, search direct/dynamic imports, raw Node consumers, source-reading tests, harnesses, extension filters, and packaging globs. Update source-location assertions while preserving the original behavioural assertion; do not remove tests to make a rename pass.

Exit per slice: focused checker/tests/builds and independent review. Runtime proof is required for critical boundaries. Lack of a safe disposable environment blocks critical acceptance, not unrelated type-only work.

## 11. B05 — Manager PWA and public bookings

Migrate apps separately: utilities/read models, hooks/forms, RPC wrappers, operational mutations. Keep browser code free of Node/Electron/service-role dependencies. Preserve aliases/assets/build globals.

PWA keeps direct Supabase access and limited lodge-scoped local queue. Verify reconnect/retry, legacy localStorage entries, pending states, and capability denials. Do not route through desktop database.js or add unsupported financial capabilities.

Public bookings preserve server-authoritative availability/pricing/payment and public validation. Verify duplicate/retry, incomplete/error response handling, and confirmation integration in an approved synthetic environment. Do not send real guests test emails.

Exit: accepted checked scopes, lint/tests/builds, relevant runtime journeys, and safe recovery behaviour.

## 12. B06 — Legacy POS and existing Edge Functions

Legacy batches cover utilities, main/preload, renderer, cache/queue, mesh, financial and hardware boundaries. Preserve Electron 22/React 18, 32-bit packaging, output/runtime targets, authenticated mesh, stable keys, receipts/till behaviour, and dedicated update feed. Runtime modernization is separate.

Edge Functions already use TS. Add real Deno checks and strengthen verified request/auth/error contracts without changing secret or notification behaviour. Do not deploy or trigger live email/push.

Exit: Legacy tests/build and compatible-runtime smoke, plus actual Deno checking. Unavailable older-OS/hardware evidence remains a release limitation.

## 13. B07 — coverage and CI enforcement

Inventory each maintained production file: runtime, checked/un-checked, strategy (TS/checked JSDoc), batch, evidence, and exception reason. Reconcile inventory with actual compiler file lists. Finish gaps or record reviewer-approved exceptions and follow-up; silent exclusion is not completion.

After scopes are stable, add per-surface scripts and aggregate typecheck. These are new scripts to implement later. Integrate checks into current CI/development workflow while preserving existing test/release gates. Changes to release automation need their own assignment.

Add engineering guidance for new modules, type-only imports, runtime validation, direct Node compatibility, and exceptions. Update architecture/project state with accepted coverage and remaining risks.

Exit: meaningful checks run normally; new production files in accepted scopes are checked; no blanket suppression or empty scope conceals work.

## 14. B08 — integration, release handoff, rollback

Run relevant final gates and current runbook requirements. Separate baseline failures, introduced failures, unavailable/skipped checks, source/build evidence, packaged-runtime evidence, and actual deployment evidence.

Use synthetic test profiles with preserved queues to exercise upgrade/restart, pending desktop/Legacy/PWA work, stable-key retry, errors/denials, reports/exports, login/lodge/outlet isolation, and affected hardware. Do not replace or clear customer profiles/queues.

Record Bar manual impact and approved offline guide packaging/open/save evidence where release rules require it. Internal typing does not waive existing product release blockers.

Keep a per-batch patch/file record. Roll back only migration patches, in reverse dependency order, preserving all unrelated code and data. Never reset/clean the checkout or clear queues/caches. This migration should need no storage/schema/data transformation; any proposed transformation is a separate design/approval task.

Prepare a release handoff only. Signing, publishing, deployment, activation, and customer messaging require separate authorization and current release gates. Migration coverage completion and customer release readiness are separate outcomes.

Exit: reconciled coverage/exceptions, final evidence, rollback instructions, manual assessment, and accurate deployment matrix. Do not claim full coverage while maintained source is silently unchecked or release readiness while required gates remain open.

## 15. Validation matrix

These scripts existed when this plan was written. Reconfirm current manifests and inspect side effects/prerequisites. Pick relevant checks per batch; do not rerun every costly suite for every annotation. Broaden at integration or when failures/new dependencies justify it.

| Area | Existing commands |
|---|---|
| Product boundaries | npm run workspace:check; npm run test:products; npm run test:release-architecture |
| Product builds | npm run build; node scripts/product-app.mjs hotel build; npm run build:hospitality-pos |
| Desktop guardrails | npm test; npm run test:release-behavior; npm run test:enterprise |
| Finance/bookings | npm run test:financial-integrity; npm run test:financial-truth; npm run test:customer-credit-reschedule; npm run test:hotel-folio-intents; npm run test:luna-sql-source-contracts |
| Offline/stock/mesh | npm run test:offline-queue-critical; npm run test:offline-pos-critical; npm run test:queue-replay-authority; npm run test:inventory-offline-sync; npm run test:mesh-multi-room |
| Reports/import | npm run test:import-critical; npm run test:financial-reconciliation-authority; npm run test:financial-validation-persistence |
| Bar/restaurant | npm run test:bar; npm run test:restaurant; npm run test:pos-hardware-adapter; npm run test:bar-guides; npm run test:bar-guide-behavior |
| Browser apps | npm run manager:lint; npm run manager:build; npm run booking:test; npm run booking:build; npm run test:web-surfaces |
| Browser integration | npm run test:e2e:pwa; npm run test:e2e:booking-site (inspect hosts/profiles first) |
| Legacy | npm run legacy-pos:test; npm run legacy-pos:build |

Orchestrators such as test:restaurant can invoke database-backed children. Inspect before running. This table does not authorize database probes, SQL mutations, disposable resets, or live production access. Missing safe infrastructure is reported; never point fixtures at production.

The reviewer supplies exact new type-check commands and feature checks for each later assignment. Source-pattern tests do not replace critical runtime/concurrency/security evidence.

## 16. Completion packet and reviewer checklist

Provide for each batch:

~~~text
Batch ID / implementation status (not self-approved):
Baseline HEAD and dirty-tree caveat:
Files changed by this batch:
Pre-existing edits preserved:
Contracts and callers traced:
Compiler configuration and checked production files:
Type safety demonstrated (valid/rejected examples):
Runtime/serialization/import behaviour comparison:
Commands, exit codes, counts, evidence paths:
New failures versus baseline failures:
Unavailable runtime/hardware/database checks and acceptance impact:
Suppressions/casts/third-party exceptions (or none):
Bar manual-impact decision:
Deployment/publication/activation actions: none:
Unresolved questions:
Suggested next batch (not started):
Rollback patch/file record:
Reviewer decision: pending:
~~~

Reviewer independently inspects the attributable diff; confirms types describe real contracts and connect to producers/consumers; checks null/error/legacy variants, serialization, async sequencing, and privilege boundaries; examines deliberate negative diagnostics; and runs appropriate verification. Return concrete corrections or acceptance before another batch.

A large green count does not establish correctness if required journeys were skipped or mocked.

## 17. Effort and completion policy

Preliminary estimate: 2–5 working days for first tooling/pilot implementation plus review; several weeks for selected critical contracts; several months for thorough application-wide checking. Revise after B01/B02 based on actual diagnostics and runtime verification availability.

An accepted partial milestone is useful but must be labelled partial, with explicit coverage and remaining work. Keep existing release/financial blockers separately visible. “TypeScript introduced” does not mean “financial correctness certified.”

## 18. Technical pilot specification (mandatory)

This section makes B01 executable without broad design decisions. If current repository facts contradict it, report the specific contradiction rather than inventing a replacement migration. Later batches also need a similarly exact reviewer task packet.

### 18.1 Pre-edit checklist and dependency change

1. Record git status --short and git rev-parse HEAD. Record existing diffs for the B01-editable files before editing; do not treat the final whole-file diff as exclusively your work.
2. Read the actual root manifest/lockfile, product-config source/package export, scripts/product-app.mjs, electron.vite.config.js, and relevant product-boundary tests.
3. Record node --version, npm --version, installed compiler/tool versions, and missing prerequisites. Verify whether TypeScript is already installed directly/transitively; do not mistake a transitive compiler for a declared reproducible tool.
4. Run the existing B01 checks before changing files. Preserve their logs/exit codes. Do not run install/build tools concurrently.
5. Select an exact released TypeScript version supported by the current Node runtime and the required options. Inspect package engine requirements and official documentation. Record the choice and why. No floating latest/range.
6. Use the following command only after filling the verified version; the placeholder is not literal executable code:

~~~text
npm install --save-dev --save-exact --ignore-scripts typescript@<verified-version>
~~~

Do not run npm ci in the dirty checkout as a shortcut or use npm audit fix. If a lock update changes unrelated dependency versions, isolate the cause and report it. Preserve existing manifest/lockfile work; do not restore them from HEAD. Avoid network-backed npx fallback for the compiler: npm scripts must resolve the pinned local dependency.

### 18.2 Exact initial configuration

Create tsconfig.typecheck-pilot.json with the following starting configuration; verify options against the selected compiler:

~~~json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": [],
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false,
    "forceConsistentCasingInFileNames": true
  },
  "files": [
    "packages/product-config/index.js",
    "tests/typecheck/product-config/valid.ts"
  ],
  "include": []
}
~~~

This is an isolated checker for the pure pilot, not a universal Node/bundler template. Runtime module semantics and target are unchanged because noEmit is enabled. Explicit files make a missing fixture an error; imported dependencies can still expand the program. types: [] avoids ambient @types pollution; lib excludes DOM. Do not turn skipLibCheck on or add Node/DOM types merely to hide an unexpected dependency. [Explicit files](https://www.typescriptlang.org/tsconfig/files.html)

Use @ts-check in the JS source. Prefer inference for frozen literals. If JSDoc is necessary, use supported annotations and derive types from the real exports; do not add an unchecked cast to claim invalid runtime data has the desired type. [JSDoc reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)

Root scripts:

~~~json
{
  "typecheck:pilot": "tsc --project tsconfig.typecheck-pilot.json --pretty false",
  "test:typecheck:pilot": "node scripts/typecheck-pilot.mjs"
}
~~~

Merge only these entries into the existing scripts object. Do not replace it.

### 18.3 Valid consumer fixture

Create tests/typecheck/product-config/valid.ts:

~~~typescript
import { PRODUCTS, PRODUCT_IDS } from "../../../packages/product-config/index.js";

type ProductDefinition = (typeof PRODUCTS)[keyof typeof PRODUCTS];
type ProductId = ProductDefinition["id"];
type ListedProductId = (typeof PRODUCT_IDS)[number];

const accepted: readonly ProductId[] = [
  "lodge-camp",
  "hotel",
  "hospitality-pos"
];
const exportedIds: readonly ProductId[] = PRODUCT_IDS;
const hotelId: "hotel" = PRODUCTS.hotel.id;
const listedHotel: ListedProductId = "hotel";

void accepted;
void exportedIds;
void hotelId;
void listedHotel;
~~~

This imports real production exports; there is no runtime duplicate definition. Do not broaden ProductId to string or annotate the constants as any to obtain a pass.

### 18.4 Unsuppressed rejection fixtures

For a clearer self-check, prefer separate unsuppressed negative fixtures over @ts-expect-error in B01.

Create invalid-product-id.ts in the same fixture directory:

~~~typescript
import { PRODUCTS, PRODUCT_IDS } from "../../../packages/product-config/index.js";

type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]["id"];
type ListedProductId = (typeof PRODUCT_IDS)[number];

const invalidDefinitionId: ProductId = "unsupported-product";
const invalidListId: ListedProductId = "unsupported-product";

void invalidDefinitionId;
void invalidListId;
~~~

Create readonly-products.ts:

~~~typescript
import { PRODUCTS, PRODUCT_IDS } from "../../../packages/product-config/index.js";

PRODUCTS.hotel.id = "hotel";
PRODUCT_IDS.push("hotel");
~~~

Never import/execute either negative fixture at runtime.

Create tsconfig.invalid-product-id.json and tsconfig.readonly-products.json in that directory. Each extends ../../../tsconfig.typecheck-pilot.json, overrides files to the source plus its own fixture, and sets include: []. Example:

~~~json
{
  "extends": "../../../tsconfig.typecheck-pilot.json",
  "files": [
    "../../../packages/product-config/index.js",
    "./invalid-product-id.ts"
  ],
  "include": []
}
~~~

Use ./readonly-products.ts in the other config. Do not include negative fixtures in the ordinary green pilot config or future broad production glob.

### 18.5 Required self-check runner

scripts/typecheck-pilot.mjs is now required for this task, not optional. Use the pinned TypeScript compiler API or a carefully checked local compiler invocation. Prefer the API to avoid fragile text parsing.

Required behaviour:

1. Resolve paths relative to the script/repository, not a presumed caller working directory. Read configs using the compiler's config parser so extends/relative paths work correctly.
2. Fail on config parsing errors, missing fixtures, compiler initialization errors, and missing production source. Never catch these and report success.
3. Assert effective strict, allowJs, noEmit, checkJs and environment settings match the intended scope.
4. Compile the positive config and require zero diagnostics.
5. Enumerate program source files. Require the actual product-config source and valid fixture, permit compiler standard libs, and reject unexpected maintained app files/globals/ambient packages. Report the exact inventory.
6. Compile each negative config without emitting or executing it. For invalid IDs, require two assignment diagnostics on the two intended assignments (normally TS2322). For readonly usage, require a readonly assignment diagnostic (normally TS2540) and missing push-method diagnostic (normally TS2339) on their intended lines.
7. Verify diagnostic file, source line, category, and code. Reject unrelated diagnostics, including missing imports, config failures, or ambient-package failures. Diagnostic wording may vary; do not match full English sentences.
8. Require the normal source to remain diagnostic-free in negative programs. Check fixture presence in those programs.
9. Exit nonzero if an expected rejection disappears; exit zero only when all positive/negative checks match. Report a compact result count. An expected compiler nonzero status by itself is insufficient.

If the selected compiler reports a different legitimate code, inspect and document it; do not accept “any compiler error.” The runner must be syntax-checked with node --check scripts/typecheck-pilot.mjs and run through npm.

### 18.6 Prove the checks cannot silently pass

Perform deliberate temporary sabotage after the implementation, recording each result:

- Remove/rename the positive fixture temporarily: the ordinary checker must fail. Restore it exactly and rerun.
- Replace the invalid IDs with valid IDs temporarily: the negative-check runner must fail because expected rejections disappeared. Restore the negative fixture exactly and rerun.
- Remove a negative fixture from its config temporarily: the runner must fail its fixture/diagnostic checks. Restore and rerun.
- Remove the readonly-invalid statements temporarily: the runner must fail. Restore and rerun.

These operations affect only newly created migration fixtures/configs. Do not weaken production types or alter pre-existing files to test the harness. No temporary sabotage may remain in the final diff. Preserve the check logs; tests that only pass without any proof of failure sensitivity are incomplete.

### 18.7 Runtime equivalence and build evidence

Capture the complete tiny product-config source in B00 evidence before editing. Compare the pre-edit and post-edit JavaScript syntax with comments ignored, using the installed TypeScript parser/printer/transpilation if helpful. Require identical runtime statements. Do not compare against HEAD when the file was already modified.

Verify exports still contain exactly the same IDs, databaseProduct values, mode order, array order, and freeze behaviour. Verify ordinary Node import through the existing product commands. These are temporary equivalence checks, not a new business-rule test suite. Keep Node consumers and package exports pointing at the existing JS file.

Run B01 validation commands after the final edit. Record working directory, exact command, exit code, duration, and evidence path. A test pass followed by further edits is stale evidence for the changed files; rerun affected checks. Build the products serially. Do not run packaging/publishing to validate a checker-only batch.

## 19. Detailed requirements for later batches

These rules apply when the reviewer assigns B02 onward; they do not authorize starting those stages now.

### Runtime/configuration traps

- For raw modern Node scopes, match NodeNext module and resolution when appropriate; preserve explicit relative JS extensions and ESM/CJS semantics. For bundled browser scopes, use the verified bundler settings. Do not copy the pilot's resolution into every environment blindly. [Resolution reference](https://www.typescriptlang.org/tsconfig/moduleResolution.html)
- For renderer configs, match JSX transformation, DOM libs, Vite globals, stylesheet/assets, and actual aliases. A paths entry only informs TypeScript; it does not create a runtime alias.
- Preload types must match the actual exposed object, not invent a generic all-capabilities API.
- A configuration inherited from another app must override incompatible types/libs/JSX/dependency settings.
- A .d.ts declaration is a claim: trace its backing implementation and demonstrate a mismatch is rejected. Avoid declarations that make an untyped boundary look checked.
- Keep runtime imports separate from type-only imports when converting to TS. Do not import a server-only value into browser code just to obtain its type.
- No decorators, runtime enums, new classes, module reshuffling, optional-chain/default-value rewrites, or non-null assertions as incidental migration changes.
- Keep existing persisted JSON shape, signatures/canonicalization, undefined omission, timestamp strings, and RPC parameter names identical.

### Critical contract checklist

For each selected RPC/IPC/queue contract, document:

~~~text
RPC/channel name and exact argument order:
Current producer and all known consumers:
Request fields, required/optional/null/omitted semantics:
Stable operation/idempotency key owner and lifecycle:
Actual success, failure, pending, incomplete and legacy variants:
Tenant/outlet/actor scope and enforcement location:
Authoritative financial/stock fields versus local estimates:
Persisted queue versions/formats and old payload handling:
Retry/status/restart path:
Ledger/audit/report completeness consequences:
Evidence source and deployment uncertainty:
~~~

Inspect actual handlers and payload fixtures. Do not infer financial correctness or permissions from button visibility or a type name. Critical runtime tests must use approved environments and existing security guards; never bypass roles/capability checks to obtain a pass.

### Batch size and scope

Prefer at most five production files per batch, plus narrowly required configs/tests/types. If a complete contract crosses more files, the reviewer explicitly lists them before implementation. Do not split a producer/consumer change so that a knowingly mismatched runtime contract ships between batches.

When a large file causes hundreds of unrelated diagnostics, report the diagnostic categories and propose a smaller scope. Do not annotate the whole file with any or rewrite it wholesale. Changes exceeding the assigned surface or introducing runtime logic require a separate assignment.

## 20. Mandatory implementer self-review before submission

Perform this checklist after the last edit, not just while coding:

| Check | Required evidence |
|---|---|
| Scope | Attributable diff lists only assigned changes; pre-existing edits remain |
| Dependency discipline | Compiler pinned; no unrelated version/lockfile churn; install hooks accounted for |
| Config accuracy | Effective options and actual program file list, not just config text |
| Useful checking | Valid consumer passes; intended misuse fails for correct diagnostics |
| Harness sensitivity | Temporary sabotage fails; exact restoration and final green rerun |
| Behaviour preservation | Runtime statement/import/serialization comparison appropriate to batch |
| Unsafe escape search | Review new uses of any, ignore/nocheck, non-null assertions and casts |
| Cross-surface contract | Applicable producers, consumers, queues and reports traced |
| Regression evidence | Exact commands/exits; baseline versus introduced failures; skips disclosed |
| Temporary artifacts | No sabotage, generated runtime files, temporary credentials or secret logs left |
| Documentation | Actual scope/status, limitations, manual impact and rollback recorded |
| Handoff | No next batch begun; independent reviewer status pending |

Search the attributable diff for unsafe type escapes; do not blame pre-existing occurrences on the migration or mass-remove them. Review git diff --check for new whitespace errors, distinguishing pre-existing errors. Re-read every changed runtime line and every test weakened or removed; there should be no unapproved examples of either.

If a check fails, correct it within scope and rerun the affected checks. If correction needs additional scope or business changes, report the exact blocker and preserve independent completed work. Never describe a skipped/unavailable check as passed.

A completion packet must include this self-review table with PASS/FAIL/NOT AVAILABLE and evidence for each entry. Self-review is required but does not replace independent acceptance.
