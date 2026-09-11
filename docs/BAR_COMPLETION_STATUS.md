# Bar Completion Status (implementation ledger)

> Addendum 2026-09-10 (disposable-cloud acceptance; Task B sole owner).
> The rows below predate isolated SQL execution; they are preserved as
> history and superseded as follows (all states target-qualified):
> - Phase C isolated target is now REAL: Supabase project
>   `repsrmlomedqrmrdsbga` (eu-west-1), chain 441/441 applied, history
>   stamped, `db push --dry-run` clean. Local Docker was never used.
> - D2/D4/D6 migrations (`20260907010000`, `20260908000000`,
>   `20260908010000`) are applied and behaviorally proven on the
>   disposable (F5 cutover suite 19/19 on real `authenticated`/`anon`
>   roles, exact SQLSTATEs). Production parity (separate party) is through
>   `20260908020000`; the repaired/new migrations await an explicit
>   deployment approval — nothing below is activated, packaged, or released.
> - Line 139/153 ECONNREFUSED notes and row C ("no database available")
>   are superseded for the disposable path: behavioral 11/11, recipe 1/1,
>   settlement strict green, portability 8/8, drift fresh-chain 9/9
>   (4 static + 5 DB-gated), matrix + activation 31/31, plus a live
>   manager-unlock/PIN-staff attribution demo. Full command/exit/role/
>   SQLSTATE evidence: `docs/ACCOUNTING_DISPOSABLE_EVIDENCE_INDEX.md`.
> - F&B drift repairs plus full-block verification (`20260909060000`),
>   payroll interval fix (`20260909040000`), and the filename guard are
>   implemented, applied, and reconciled per-migration on the disposable
>   (437/441 PASS + 1 accepted platform drift + 3 documented parallel-work
>   divergences, all itemized in the evidence index).
> Original rows follow unchanged.

Date: 2026-09-08 (verified-fix pass for
ACCOUNTING_VERIFIED_FIX_HANDOFF.md, WP1–WP5). Source revision: `0010b612` +
dirty worktree (uncommitted; no reset/discard/stage-everything performed, no
commit/stage/publish performed). Supersedes the 2026-09-07 second-pass
numbers below where they differ; unchanged rows are retained for history.

States are tracked separately per work item, in this order:
**implemented** (code exists) · **verified** (a stated check passed, with the
evidence class named: unit / behavioral / browser / SQL / device) ·
**activated** (server-side enablement on an approved target) · **packaged**
(signed versioned artifact) · **released** (installed/published + verified).

Nothing below is activated, packaged, or released.

| Phase | Work | Implemented | Verified (evidence class) | Activated | Packaged | Released | Blocker |
|---|---|---|---|---|---|---|---|
| A1 | Provenance-aware outcome classifier; domain/IPC provenance; post-commit cache guard | yes | yes — behavioral: real classifier matrix + real domain fns (stubbed Electron/RPC/fs), 10/10 `bar-tab-recovery-outcomes` | n/a | n/a | no | — |
| A1 | Split thrown-RPC-error conversion to unknown envelopes | yes (`splitBillEvenly` try/catch) | yes — behavioral: scripted throw stays `success:false/outcome:unknown` end to end | n/a | n/a | no | — |
| A2 | Immutable replay executor + archive + inbox + per-operation replay auth | yes (`posTabRecovery.js` executor, `HposOpenChecks.jsx` rework) | yes — behavioral (10/10 executor) + browser R1–R6 (real component, mocked IPC) | n/a | n/a | no | two-terminal live run (WP7) |
| A3 | Tenant binding require-match + trusted fetch/cache adapter + caller audit | yes | yes — behavioral: real validator, real fetch binder, real offline adapter (seeded fs + registry), 5/5 tenant tests | n/a | n/a | no | live server lease proof needs linked-schema check |
| A4 | Standalone Bar per-tab commercial+capability filter, denial, outlet-from-URL | yes (`workspaceTabAccess.js` + `RestaurantWorkspace.jsx`) | yes — behavioral (7/7 decision tests) + browser F1–F4 (real workspace mount, zero-call spies) | n/a | n/a | no | device walkthrough of base/add-on combos |
| A5 | Allowlisted bundle schema + context-aware scrub + free-text sanitize | yes (`supportBundleScrub.js` shape/scrub, `health.js` pipeline) | yes — behavioral (9/9 incl. real `getSupportBundle` with seeded synthetic secrets) | n/a | n/a | no | — |
| B | Ten-file restaurant triage (per-assertion capture, code/test fixes) | yes — 10 files green | yes — `test:restaurant:all` 37/39 files; 2 remaining are PostgreSQL-blocked | n/a | n/a | no | isolated PostgreSQL target (see Phase C request) |
| B | hpos-service-contract stale assertions | yes | yes — file passes | n/a | n/a | no | — |
| B | POS even-split missing `source_tab_version` (real gap found in triage) | yes — version forwarded, null-safe | yes — widened test pins both modes + version | n/a | n/a | no | live two-terminal stale-version run |
| B | RestaurantTables area-view toggle (missing, implemented) | yes | yes — 6.3 tests pin viewMode/tablesByArea/LayoutGrid behavior | n/a | n/a | no | — |
| D | Per-signature authorization matrix (99 IPC ops, reviewed) | yes — `docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md` + generator | yes — 7/7 executable matrix tests (mapping, lifecycle caps, definer/search_path, no-anon, handler gating, orphan set, cutover lifecycle) | n/a | n/a | no | live-schema confirmation (migration text ≠ deployment) |
| D | approve-cutover wiring (real maker/checker gap) | yes — domain + IPC map + UI | yes — behavioral domain args + browser W1/W1b + matrix regen | n/a | n/a | no | live approval flow proof on isolated target |
| D2 | Cutover batch list/detail + activation-state reads; explicit apply wiring (verified defects 1–2) | yes — `20260907010000` migration (NOT APPLIED) + domain + facade + `getCutoverBatches`/`getCutoverBatch`/`applyCutover`/`getActivationState` IPC ops + UI selector/apply step | yes — node mapping tests + browser W0b/W1/W1b/W2/W3/W4 + migration-text assertions | n/a | n/a | no | migration NOT applied; live read/apply proof on isolated target |
| D3 | Full-tuple activation reconciliation + readiness copy (verified defect 3) | yes — `src/shared/accountingActivation.js` snapshot/comparator + UI reconcile + ready===true copy | yes — node comparator tests + browser W5/W6/W7 | n/a | n/a | no | live tuple proof on isolated target |
| D4 | Second repair pass F1–F4: evidence-bound review, fail-closed comparator, URL lifecycle, apply-evidence rule | yes — review snapshot/preflight UI + `20260908000000` evidence-binding migration (NOT APPLIED, grants nothing) + comparator rewrite + session-scoped loaders + unified apply reconciliation | yes — node F1/F2/F4 + migration-text tests + browser X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b | n/a | n/a | no | migration NOT applied; live proof on isolated target |
| D6 | Third repair pass G1: revision-bound approval (source-only race closed atomically) | yes — `20260908010000` migration (NOT APPLIED; drops weak 4-arg overload, 6-arg null-safe revision binding, auth+service_role on new sig) + domain args + scoped snapshot UI + matrix row | yes — node G1 migration-text + domain null-source tests + browser Y1 | n/a | n/a | no | migration NOT applied; live proof on isolated target (Supabase task owns execution, waits for final snapshot) |
| D7 | Third repair pass G3/G4 (+H3): strict evidence validators + full-revision approval reconciliation | yes — blank-vs-null hardening, mandatory snapshot scope, strict fresh fields, shared `readSourceEvidence`, preparer + approver-independence + scope checks in `resolveApproveOutcome`, hash-router batch resolution | yes — node G3/G4/H3 tests + browser Y2/Y3/Z1 | n/a | n/a | no | live proof on isolated target |
| D5 | F5/G2/H1/H2 SQL acceptance: target safety, real restricted roles, independent-session concurrency, rollback atomicity, explicit entitlement | yes — rewritten `restaurant-accounting-cutover-activation.test.mjs` (pure safety matrix + child-process refusal/valid-gate isolation, SET ROLE sessions, two-client races, before/after rollback counts, license+override provisioning with JSON-extracted entitlement assertion, source-drift/revision coverage) | authored only — safety refusal verified, execution blocked | no | no | no | disposable-target approval (3 env inputs); Task B runs against final snapshot |
| E | Activation workflow UI (readiness/cutover/activate/suspend + read-back recovery) | yes — `RestaurantAccountingActivation.jsx` + route + entry link | yes — browser 35 scenarios (W/X/Y/Z series incl. HashRouter parity) + node validator/wiring tests 24/24 | NO — not activated anywhere | no | no | approved tenant + isolated target first |
| C | Isolated SQL target + real-role acceptance | prepared (strict mode, acceptance plan) | NO — no database available | no | no | no | **approval request below** |
| F | Release candidate (signed) | local unsigned build only | build exit 0, markers verified in bundles | no | NO — unsigned | no | version + CSC signing inputs + publish approval |
| G | Pilot activation + publishing | not started | no | no | no | no | Phase C–F approvals |

## Evidence commands and results (2026-09-09, Task A portability checkout fix J1)

- `node --test tests/bar-migration-line-ending-portability.test.mjs` → 8/8 in the CRLF working tree AND 8/8 in an isolated LF checkout (sparse worktree + forced re-checkout proving `.gitattributes` converts the committed CRLF blob to LF; repaired bytes overlaid as LF; worktree removed afterwards, main tree verified untouched).
- The file is named `bar-*` so the maintained bar gate collects it: `npm run test:bar` → 342 passed, 0 failed (was 334; +8).
- Repair keeps: real-artifact extraction, anchor correspondence, strict zero/duplicate failures, explicit already-installed branch, output checks, and the `execute-normalized` assertion for a genuine LF-definition/CRLF-matcher case (constructed explicitly, so the fallback stays covered on LF checkouts where raw extraction is LF).
- Migration bytes untouched: `20260730100000` still `da19b27f35272ce2854afb68ac32ba70c0744bdf2cd5602b11e24cec06a5178d`.
- Updated test hash `2401551ED20B981D45D5F195D48B96594035F9D426A432EFA5EAA3881D935408`; superseded `d20d158d659229f2d38b06dc7108ec95a0b1e359d20274ab3d7ec34d379c599e` must NOT be retained as final evidence.
- Task B sequence note: run `node --test tests/bar-migration-line-ending-portability.test.mjs` (now also inside `npm run test:bar`) before final acceptance certification, using the final test hash below.

## Evidence commands and results (2026-09-09, Task A line-ending repair — superseded where above differs)

- Root cause proven locally: the asserter `20260730100000` carries CRLF bytes (56 pre-repair) while the stored definition (installed from LF `20260711120000`) is LF — the old dollar-quoted block matches zero times raw, exactly once after CRLF→LF normalization. No contract is missing; the assertion is not bypassed.
- `npm run test:bar` → 334 passed, 0 failed (unchanged scope; new file below runs separately).
- `node --test tests/migration-line-ending-portability.test.mjs` → 7/7 (matcher blocks extracted from the real file; LF/LF, LF/CRLF live-halt case, CRLF/LF, CRLF/CRLF; zero/duplicate-match failures; explicit already-installed no-op; SQL-structure pins).
- `npm run test:pos-rush` → 43 passed. `test:release-behavior` → ok. `test:financial-truth` → 189/189.
- `npm run test:restaurant:all` → 37/40 files pass; only the 3 SQL suites blocked (2 ECONNREFUSED + cutover safety refusal). `test:release-architecture` passed, hardware-adapter ok, `build:hospitality-pos` exit 0 (unsigned).
- `git diff --check` → fails solely on the pre-existing unrelated file noted in the I1 pass; all repair files check clean. `.gitattributes` measured effect: +1 untracked file, zero status churn across the 48 CRLF files (238→239 entries, no new M flags), no renormalization run.
- Vulnerable-class triage (all `pg_get_functiondef` anchored replacements): the halt file is the SOLE CRLF member. Five applied-prefix peers are LF (consistent with Task B's 308 clean applies); fourteen post-halt peers are LF (no action; policy guards future checkouts). One post-halt dependent (`20260905230000`) uses single-line `position()` needles — immune by construction and validates the new block downstream.
- Repair files for Task B (raw SHA256; canonical LF where line endings matter):
  - REPAIRED `supabase/migrations/20260730100000_shared_till_operator_attribution.sql`: raw `da19b27f35272ce2854afb68ac32ba70c0744bdf2cd5602b11e24cec06a5178d` (was `377F7620ECEFC7750E52838AD57C808466FCDA253CB7632C3F3782075C10AB2D`), canonical-LF `92e09d5632870f22540b8e69846f932d3e12118d0eb5efaa7314d71805ee4a4a`; file keeps CRLF convention (56→97 CRLFs, one pre-existing trailing LF, no mixed endings).
  - NEW `.gitattributes`: `f781e6241896e5553fb316b5af58ea1baffcb4eeb981a9ccb80244df3509c188`
  - NEW `tests/bar-migration-line-ending-portability.test.mjs`: `2401551ED20B981D45D5F195D48B96594035F9D426A432EFA5EAA3881D935408` (checkout-independent; in the bar gate; supersedes `d20d158d659229f2d38b06dc7108ec95a0b1e359d20274ab3d7ec34d379c599e`)
  - UNTOUCHED definer `20260711120000_lodge_camp_release_blockers_repair.sql`: still `3AB69610585326BC3F3928CF2F4E3C1E8ED2C0495FD74680D8A28314C4B43EA9` (already in applied prefix — must NOT be edited).
- Applied-prefix classification: the halt file is UNEXECUTED (chain stopped there) → Task B validates the new raw hash and resumes within existing scope after confirming no partial effects. NO change touches Task B's 308-file applied prefix (definer untouched; no post-halt file touched).
- Task B SQL acceptance regression (to run on the disposable project, not production): capture `pg_get_functiondef('public.create_pos_order_v3(jsonb)')` BEFORE and AFTER the resumed migration; assert the new attribution line present exactly once, the old line absent, signature/security-definer/search-path/grants unchanged, and demonstrate behavior with a manager-unlock + PIN-staff shift order asserting operator = shift owner and audit actor = manager. Suggested Task B checklist is recorded in `docs/ACCOUNTING_SQL_ACCEPTANCE.md`.

## Evidence commands and results (2026-09-09, Task A managed-platform repair I1 — superseded where above differs)

- `npm run test:bar` → 334 passed, 0 failed (was 333; +1: prerequisite evaluator matrix).
- `node --test tests/bar-accounting-activation.test.mjs` → 24/24 (H1–H3 intact).
- Safety verified both ways: G2 filter passes 3/3 with valid-shaped dummy env (never dialled); absent env passes 3 connection-free with the designed integration refusal (nonzero, pre-connection).
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → 37/40 files pass; only the 3 SQL suites fail: the 2 pre-existing behavioral suites with `ECONNREFUSED 127.0.0.1:54322`, plus the hardened cutover suite (3 pass connection-free; the integration case refuses pre-connection with the explicit safety message, nonzero exit).
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → passed, 0 failed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run build:hospitality-pos` → exit 0. Unsigned local build, not a signed installer.
- `git diff --check` → exit 2 SOLELY on pre-existing unrelated dirt (`src/renderer/src/components/hotel/StaffOperations.jsx:918 new blank line at EOF`, another workstream's file, preserved untouched); every Task A file checks clean (exit 0).
- No SQL integration executed: acceptance remains owned by Task B on the approved disposable project against the final snapshot below. No 40/40 SQL-backed claim is made.

## Evidence commands and results (2026-09-08, fourth repair pass H1–H3 — superseded where above differs)

- `npm run test:bar` → 333 passed, 0 failed (was 331; +2: H3 revision-readback + strict source-reader tests).
- `node tests/browser/run-browser-suite.mjs` → 35/35 scenarios ok (all prior plus Z1: later-revision approval never confirms the old review).
- `node --test tests/bar-accounting-activation.test.mjs` → 23/23 (incl. all H-regressions).
- H1 verified both ways: connection-free safety tests pass with valid-shaped approval env (G2 filter 3/3, dummy URL never dialled) and with absent env; the unapproved integration child exits nonzero pre-connection.
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → 37/40 files pass; only the 3 SQL suites fail: the 2 pre-existing behavioral suites with `ECONNREFUSED 127.0.0.1:54322`, plus the hardened cutover suite (3 pass connection-free; the integration case refuses pre-connection with the explicit safety message, nonzero exit).
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → passed, 0 failed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run build:hospitality-pos` → exit 0. Unsigned local build, not a signed installer.
- `git diff --check` → exit 0 (line-ending warnings only).
- No SQL integration executed: acceptance remains owned by the approved disposable-cloud (Supabase) task against the final snapshot below. No 40/40 SQL-backed claim is made.
- Final Task A snapshot for Task B coordination (SHA256, 2026-09-09; Task B must check hashes before running and certify THIS corrected snapshot, not the previous one):
  - CHANGED `tests/restaurant-accounting-cutover-activation.test.mjs`: `CCD6F66390FD28EEA87C0381ED63B90A375BCD966241E4CD38348BA212303EF8`
  - NEW `tests/helpers/disposable-prerequisites.mjs`: `37F5A28B3A5BD68B6745B181CCF0B2031E854E20F2E8F7A7BC92772A4452268A`
  - CHANGED `tests/bar-accounting-activation.test.mjs`: `C6E4E67F2E2900D1D4F45E046545489ACF532F2DC1F2F0636C6E6F1871DD6571`
  - UNCHANGED `supabase/migrations/20260908010000_accounting_approve_revision_binding.sql`: `EB6D746E234578D07606A09A1199033515B46EE8EF13597494BBE76A86A82D87`
  - UNCHANGED `supabase/migrations/20260908000000_accounting_approve_evidence_binding.sql`: `64D12E574BFA6D22A6B6072F120EEA44651AF8A072DD5D2B95AAD3A423C643D6`
  - UNCHANGED `supabase/migrations/20260907010000_accounting_cutover_reads_and_activation_grants.sql`: `CD1136678FB533134CCC9D0970787BDA868848F221343E413CD55B9B24536A0C`
  - UNCHANGED `src/shared/accountingActivation.js`: `BD982B0C6DA64FBA8A7848997F55E8D10C6C9FD03C12FC77FE6BF7261A9ADE42`
  - UNCHANGED `src/renderer/src/components/restaurant-accounting/RestaurantAccountingActivation.jsx`: `6117987D02B44E4D77D5BC2521B237A1C214318E7D47FEECCC027E716F9D50DC`
  - Superseded pass-4 suite hash `4613B6D81BCBDE321AD8C6FDAA4CBE417CA375C8756F1F18CCEE2894946FF2FB` must NOT be certified.

## Evidence commands and results (2026-09-08, third repair pass G1–G4 + G2 — superseded where above differs)

- `npm run test:bar` → 331 passed, 0 failed (was 324; +7: G3 blank/snapshot/preflight, G4 resolver, G2 safety validator, G1 migration-text, approve domain null-source).
- `node tests/browser/run-browser-suite.mjs` → 34/34 scenarios ok (R1–R6, F1–F4, W0/W0b/W1/W1b–W7, X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b, Y1/Y2/Y3).
- `node --test tests/bar-accounting-activation.test.mjs` → 21/21 (incl. all G-regressions).
- `node --test tests/bar-accounting-matrix.test.mjs` → 7/7 (approve signature change picked up mechanically; matrix doc row updated).
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → 37/40 files pass; only the 3 SQL suites fail: the 2 pre-existing behavioral suites with `ECONNREFUSED 127.0.0.1:54322`, plus the G2-hardened cutover suite (2/3 pass connection-free: safety matrix + integration refusal; the integration case refuses pre-connection with the explicit safety message, nonzero exit).
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → passed, 0 failed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run build:hospitality-pos` → exit 0; pass-3 markers verified in bundles (`resolveApproveOutcome`, `Confirm review of displayed evidence`, hash-fragment batch resolution in `RestaurantAccountingActivation-*.js`). Unsigned local build, not a signed installer.
- `git diff --check` → exit 0 (line-ending warnings only).

## Evidence commands and results (2026-09-08, second repair pass F1–F5 — superseded where above differs)

- `npm run test:bar` → 324 passed, 0 failed (was 318; +6: F1/F2/F4 pure tests, F1 migration-text test).
- `node tests/browser/run-browser-suite.mjs` → 31/31 scenarios ok (R1–R6, F1–F4, W0/W0b/W1/W1b–W7, X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b).
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → 37/40 files pass; only the 3 SQL suites fail: the 2 pre-existing behavioral suites with `ECONNREFUSED 127.0.0.1:54322`, plus the rewritten `restaurant-accounting-cutover-activation.test.mjs`, which now refuses pre-connection with the explicit disposable-target safety message (verified; no connection attempted, nonzero exit).
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → passed, 0 failed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run build:hospitality-pos` → exit 0; new-flow markers verified in bundles (`Confirm review of displayed evidence`, `resolveApplyOutcome`, `scheduled, not yet active` in `RestaurantAccountingActivation-*.js`). Unsigned local build, not a signed installer.
- `git diff --check` → exit 0 (line-ending warnings only).
- Authorization matrix unchanged (approve signature identical; 7/7 matrix tests still green) — no regen required.

## Evidence commands and results (2026-09-08, verified-fix pass — superseded where above differs)

- `npm run test:bar` → 318 passed, 0 failed (was 309; +9: matrix 7/7 incl. cutover lifecycle, activation 8/8, browser W-series via rendered wrapper).
- `node tests/browser/run-browser-suite.mjs` → 21/21 scenarios ok (R1–R6, F1–F4, W0/W0b/W1/W1b–W7).
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → all non-SQL files pass; only the 3 SQL suites fail, all `ECONNREFUSED 127.0.0.1:54322` (no database present): the 2 pre-existing behavioral suites plus the NEW `restaurant-accounting-cutover-activation.test.mjs`, which is strict by design (fails loudly, never skips) and was verified to fail at connect with exactly that error.
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → 2 passed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run legacy-pos:test` → 219 passed, 0 failed. `npm run manager:lint` → 0 errors (35 pre-existing warnings).
- `npm run build:hospitality-pos` → exit 0; markers verified in `out/hospitality-pos` bundles
  (activation route/component incl. `getCutoverBatches`/`applyCutover`/`compareActivationState` in `RestaurantAccountingActivation-*.js`, inbox UI, approveCutover IPC). Unsigned local build, not a signed installer.
- `git diff --check` → exit 0 (line-ending warnings only).

## Evidence commands and results (2026-09-07, second pass — superseded where above differs)

- `npm run test:bar` → 309 passed, 0 failed (was 260; +49: outcomes 10, executor 10, tenant 5, tab-access 7, privacy 5+4, accounting matrix 6, activation 5, rendered browser 1 covering 15 browser scenarios).
- `npm run test:financial-truth` → 189 passed, 0 failed.
- `npm run test:restaurant:all` → 37/39 files pass; only `restaurant-accounting-behavioral` and
  `restaurant-recipe-depletion-behavioral` fail (ECONNREFUSED 127.0.0.1:54322, no database present).
- `npm run test:pos-rush` → 43 passed (source-contract suite, not load proof).
- `npm run test:release-behavior` → ok. `test:release-architecture` → 2 passed.
- `npm run test:pos-hardware-adapter` → ok (adapter contract only, not physical hardware).
- `npm run legacy-pos:test` → 219 passed, 0 failed. `npm run manager:lint` → 0 errors (35 pre-existing warnings).
- `npm run build:hospitality-pos` → exit 0; markers verified in `out/hospitality-pos` bundles
  (activation route/component, inbox UI, approveCutover IPC). Unsigned local build, not a signed installer.
- `git diff --check` → exit 0.

## Residual risks and known limits

- Transfer replay by a non-originator returns `tab_not_owned` server-side by
  design (result non-disclosure); the client keeps the record and offers
  support inspection instead of auto-resolving.
- Split idempotency hashes include the Till operator proof: same-session
  replays match; post-rotation replays surface `idempotency_conflict`
  (needs_review, safe) instead of the stored result. Changing hash semantics
  server-side would break replay matching for existing rows — not attempted.
- `getCommercialFeatureSet` accepts future unknown override features into the
  set; single-feature inclusion treats unknown-package contexts as deny.
- Pre-existing duplicate key `lost_found.manage` in `accessControl.js`
  capability labels (lines ~171/~218, second wins). Cosmetic; untouched.
- Browser scenarios use mocked IPC and synthetic fixtures: they prove UI
  behavior, not server authorization or hardware.
- Migration text is not deployment proof anywhere in this ledger.

## Approvals required (exact requests in the final delivery message)

1. Isolated disposable database target for Phase C/D3 (no docker here).
2. Product version number for the release candidate.
3. Code-signing inputs (CSC_LINK/CSC_KEY_PASSWORD or equivalent) + GitHub publish token/scope.
4. Pilot tenant, activation effective date/config, cutover decision, devices, channel.
