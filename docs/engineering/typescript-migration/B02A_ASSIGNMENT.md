# B02-A assignment — shared pure configuration and branding metadata

Date: 2026-10-09. Prerequisite: evidence/B01-acceptance.md.
This is the first bounded B02 sub-batch, not authorization for all B02 runtimes.

## Objective

Establish a real strict shared-pure checker covering:
1. packages/product-config/index.js (already checked; unchanged).
2. src/shared/brandIdentity.js (newly checked through comments/JSDoc only).

Keep runtime JavaScript, build pipelines, persisted data, launch identities, names, fallback behaviour, and customer workflows identical. No TS file renames, financial/RPC/IPC/queue changes, new runtime validation, or dependency upgrades.

## Before editing: capture actual evidence

Read AGENTS.md, latest PROJECT_STATE.md, architecture, the migration plan, and B01 acceptance. Reconfirm current working-tree changes and scope.

Create evidence/B02A-baseline.md, evidence/B02A-status-before.txt, and evidence/B02A-snapshots/. Save the actual current contents and SHA-256 of EVERY existing file you may edit before any edits, including package.json, brandIdentity.js, STATUS.md, and PROJECT_STATE.md. Record absent planned files. Keep snapshots as inert .txt data; do not copy secrets, environment files, or customer records.

Record HEAD, tool versions, full porcelain status, inspected commands, baseline tests, import/caller trace, and existing failures. Keep durable logs under evidence/B02A-logs/. Preserve pre-existing dirty work; a current git diff is not a saved earlier baseline.

## Exact permitted paths

- src/shared/brandIdentity.js: comments/JSDoc only, no runtime statement changes.
- New tsconfig.typecheck-shared.json.
- New scripts/typecheck-shared.mjs.
- New tests/typecheck/shared-brand/valid.ts, invalid.ts, tsconfig.invalid.json.
- Root package.json: two new script entries only.
- Migration STATUS.md; new evidence/B02A-* files/directories; one scoped PROJECT_STATE.md entry.

No changes to package-lock.json, installed dependencies, B01 source/configs/fixtures/helpers, build configs, caller source files, SQL, customer docs, release scripts, or other production modules. The new script may import B01's pure STRICT_SUBOPTIONS, assertJsChecked and isStdLibFile helpers without editing them.

If an additional path is required, report the concrete need before expanding scope. Do not invent another executable helper outside this list.

## Verified runtime contract and important typing trap

brandIdentity.js exports frozen ECOSYSTEM_BRAND, frozen PRODUCT_BRANDS, and getProductBrand(productId = 'lodge-camp'). PRODUCT_BRANDS has three known product keys and frozen name/shortName objects.

The current getter uses:
~~~javascript
return PRODUCT_BRANDS[productId] || PRODUCT_BRANDS['lodge-camp']
~~~

Unsupported ordinary strings fall back to LodgingOS. However, inherited keys such as constructor and toString currently return functions via Object.prototype. The reviewer confirmed this existing behaviour. This is NOT authorization to fix it during typing.

Do not type every arbitrary string lookup/getter result as a guaranteed ProductBrand. Represent uncertainty honestly. Record the edge case as pre-existing; never change the object prototype, add hasOwn checks, coerce keys, or alter fallback/default behaviour in this batch.

Current consumers:
- src/shared/productIdentity.js imports brand constants; desktop main/renderer and Manager PWA consume it.
- Desktop main email/hardware helpers and Hotel renderer also import brand constants.
- Brand/product-boundary tests import them directly.
- No getProductBrand call sites outside its definition were found in inspected production/test folders; recheck.
The compiler program must not expand to productIdentity.js or its consumers in this batch.

## Starting configuration

Create tsconfig.typecheck-shared.json:
~~~json
{
  "extends": "./tsconfig.typecheck-pilot.json",
  "compilerOptions": {
    "checkJs": true
  },
  "files": [
    "packages/product-config/index.js",
    "src/shared/brandIdentity.js",
    "tests/typecheck/shared-brand/valid.ts"
  ],
  "include": []
}
~~~

The inherited strict/noEmit/ES2022/ESNext/Bundler/no-DOM/no-ambient options remain mandatory. This config explicitly overrides files; it does not pull pilot negative fixtures into a green program.

Keep brandIdentity.js as .js and add active @ts-check. Global checkJs:true must be asserted for THIS scope; do not reuse a B01 assertion expecting false or misrepresent the effective options.

## Suggested type-only annotations

The reviewer compiled this approach in memory with TypeScript 5.9.3 against the existing source; it produced zero diagnostics. Reconfirm it yourself.

Add typedefs:
~~~javascript
/** @typedef {(typeof import('../../packages/product-config/index.js'))['PRODUCT_IDS'][number]} ProductId */
/** @typedef {{readonly name: string, readonly shortName: string}} ProductBrand */
~~~

Immediately before PRODUCT_BRANDS:
~~~javascript
/** @type {Readonly<Record<ProductId, ProductBrand>> & Readonly<Record<string, unknown>>} */
~~~

Immediately before getProductBrand:
~~~javascript
/**
 * @param {string} [productId]
 * @returns {unknown}
 */
~~~

This gives the three real keys useful readonly types while keeping arbitrary lookup/getter results honest. JSDoc import is type-only; do not add runtime imports or duplicate product IDs in another runtime table. ECOSYSTEM_BRAND can retain its inferred frozen literal types.

Unknown here documents observed unchecked lookup semantics; it is not a blanket escape hatch. Do not cast the getter result back to ProductBrand to conceal the inherited-key behaviour. Any more precise overload design requires separate justification and review; the conservative approach above is sufficient.

## Required fixtures

valid.ts must import both REAL modules and demonstrate:
- Known product IDs remain compatible with actual PRODUCT_IDS.
- Every known ProductId maps to a readonly name/shortName object.
- ECOSYSTEM_BRAND.name and legalOwner are readable strings.
- PRODUCT_BRANDS.hotel.name is a string.
- getProductBrand(), getProductBrand('hotel'), and getProductBrand('unsupported-product') are accepted, with uncertain results retained as unknown.
- No runtime duplicate brand/product configuration.

invalid.ts must compile only, never execute, and contain:
- A derived ProductId assigned an unsupported ID (expected TS2322).
- PRODUCT_BRANDS.hotel.name assigned a new string (expected TS2540).
- A variable holding getProductBrand('unsupported-product') accessed as .name without narrowing (expected TS18046 with pinned 5.9.3).

Record actual intended lines/codes; unrelated import/config errors cannot satisfy a negative test. If compiler diagnostics differ, inspect the cause and report rather than accepting arbitrary errors.

tsconfig.invalid.json extends ../../../tsconfig.typecheck-shared.json, overrides files to the two production modules plus ./invalid.ts, and includes no other fixtures.

## New npm scripts and runner

Add only:
~~~json
{
  "typecheck:shared": "tsc --project tsconfig.typecheck-shared.json --pretty false",
  "test:typecheck:shared": "node scripts/typecheck-shared.mjs"
}
~~~

The runner must:
- Resolve paths from its own location and use the pinned local compiler.
- Parse inherited configs through TypeScript; fail on missing files/config errors.
- Validate effective strict/noEmit/allowJs/checkJs:true, exact target/module/resolution/lib, explicit types:[], and all nine strict defaults.
- Require exactly the two production sources plus the intended fixture and genuine compiler standard libs. Check active JS directives and actual compiler checking state for both production files.
- Require zero positive diagnostics and exact negative file/line/category/code diagnostics; no production-source diagnostics in the negative program.
- Never execute negative examples or emit runtime JS.
- Return nonzero if a required fixture is excluded, a rejection disappears, or checking weakens.

Keep B01 helpers/config/tests unchanged. Do not refactor both checkers into a general framework during this batch. Reusing narrow pure predicates is sufficient.

Include in-memory guard cases within the new runner, or test isolated copies, proving rejection of DOM/ambient types, disabled strict settings, checkJs:false, missing production source/fixture, and disappearing negative diagnostics. Also preserve final B01 guards. Tests should prove the new runner's integration as well as any imported predicate.

Temporary sabotage may touch only new fixtures/configs; production source changes for guard probes must use isolated copies/in-memory hosts. Assert intended failure messages, restore hashes, and rerun green checks.

## Runtime equivalence

Compare brandIdentity.js pre/post syntax with comments ignored; runtime statements must be identical. Compare export names, public strings, keys, order, freeze flags, defaults, unknown-key fallback, and the existing inherited-key cases using the saved baseline.

Do not turn the inherited-key observation into a business fix or falsely claim it is safe. Future behavioural remediation can be separately assigned. No customer manual update is required if runtime equivalence holds; record that assessment.

## Validation commands

Inspect actual scripts/tests first. Run before and after where applicable, serially:
~~~text
node --check scripts/typecheck-shared.mjs
npm run typecheck:shared                  # new
npm run test:typecheck:shared             # new
npm run typecheck:pilot
npm run test:typecheck:pilot
npm run test:typecheck:pilot-guards
npm run workspace:check
npm run test:products
npm run test:release-architecture
npm run test:brand-migration
npm run products:list
npm run manager:lint
npm run manager:build
npm run build
node scripts/product-app.mjs hotel build
npm run build:hospitality-pos
~~~

Run builds serially. No packaging/deployment. The brand suite reads existing package artifacts if present; disclose skips/stale-artifact failures without replacing artifacts or running a release. Missing unrelated prerequisites are reported honestly.

No blanket whole-app suite reruns. No database/hardware/Deno/browser mutation journeys are needed for comment-only metadata checking. Do not run live notification tests.

## Completion and stop

Return the standard batch packet/self-review table plus:
- Retained snapshots/status/hashes/log locations.
- Exact attributable source/config/script/manifest changes.
- Checked-file inventory and actual diagnostic/guard proofs.
- Runtime syntax/value equivalence, including uncertain getter semantics.
- Existing baseline failures versus new failures; commands and exit codes.
- Exact-file rollback preserving B01 and unrelated work.
- B01 remains accepted; B02-A reviewer decision PENDING.

STOP after B02-A. Do not start desktop main/preload/renderer configurations, PWA/Legacy/Deno checking, or B03. No automatic progression or messaging other chats.
