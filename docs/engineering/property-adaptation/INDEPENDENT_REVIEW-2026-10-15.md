# Independent verification — property adaptation

Date: 2026-10-15 (Africa/Gaborone). Verdict: **CHANGES REQUIRED**.

This review inspected the current working tree and effective local migration chain, reran focused checks, and executed bounded probes against extracted production JavaScript. No application source, migrations, customer settings or production database records were changed. Existing unrelated work was preserved. This is not live database certification or a complete rendered desktop acceptance run.

## Verification actually performed

- Inspected current PROJECT_STATE, architecture, Settings, operation lifecycle, transition main domain, ordinary settings writes, navigation/presentation integration, campsite booking estimation/creation, quotation-conversion migration, test harnesses and deployment notes.
- Ran `node --test` over: property-presentation, property-navigation, property-transition-lifecycle, property-type-transition-contract, property-service-alignment, campsite-booking-journey, campsite-quotation-conversion, campsite-quotation-migration-guard, property-type-transition-sql and campsite-quotation-conversion-sql test files.
- Node reports **99 passed / 0 failed / 0 skipped**. Important correction: **two of those 99 are success placeholders that printed SKIP because disposable credentials were absent. Thus 97 non-placeholder tests ran; neither live SQL suite executed its database assertions.** The database cases are not certified by the green summary.
- `npm run typecheck:shared`: exit 0.
- `npm run typecheck:renderer`: exit 0. These are scoped checks, not a guarantee that every modified component is type-checked.
- `npm run test:offline-queue-critical`: exit 0, `offline-queue-regression: ok`. The previously reported failure is not reproduced in this tree.
- `npm run test:queue-replay-authority`: 9/9 passed. Mock Electron broadcast warnings appeared, but no test failed.
- Production-function probe: `saveStoredTransitionOp` called with localStorage.setItem throwing returned normally; no durable operation was written.
- Production-function probe: transition-domain `refreshSettingsCache` given a normal resolved Supabase `{data:null,error:{message:'access denied'}}` response returned `true`, with zero cache writes.
- Effective commit SQL source probe: expected-state validation appears before receipt lookup; no check that the current property belongs to the supported LodgingOS family exists in that function.
- Actual Electron screens were not mounted in this review. Existing rendered evidence explicitly uses resolver-generated HTML and mocked transition states; it does not mount Settings.jsx or Bookings.jsx.
- No full build was repeated for this read-only review. Prior build and linked-schema claims remain implementer-reported, not newly verified here.

## R1 — P1: exact replay is rejected after a successful transition

**Location:** `supabase/migrations/20261014020000_property_type_transition_lodge_scope_deny.sql:317–351` (also present in the base migration).

The effective commit function locks settings, compares the original expected type/timestamp against current settings, and only afterwards looks for the recorded idempotency key. A lodge-to-camp commit changes both type and timestamp. Retrying its identical original payload therefore returns `expected_state_conflict` before it can return the saved receipt. A later ordinary settings update similarly breaks an otherwise valid replay. Payload-mismatch handling can also be masked by the stale guard.

**Fix:** In a forward migration, retain authentication/scope/capability enforcement, compute the canonical payload fingerprint, and resolve an existing key before applying new-operation expected-state checks. Preserve lock ordering/concurrency correctness. Return a matching stored result without mutation; reject a different payload deterministically. Only a genuinely new operation should need to match current expected state. Do not round timestamp precision away in the payload fingerprint (`extract(epoch ...)::bigint` currently loses fractional precision); use a canonical full-precision representation.

**Required evidence:** Real SQL commit, identical replay after success, replay after a later unrelated settings update, mismatched-payload reuse, and two concurrent same-key requests. The existing SQL replay test should catch the basic defect once it actually runs.

## R2 — P1: same-product enforcement checks only the destination

**Location:** same migration, target validation around line 292 and current type read at line 317; preview has the same destination-only assumption.

The RPC rejects hotel/bar/etc. as targets, but never rejects them as the existing property type. An otherwise authorized manager of a hotel/restaurant/bar property can call the RPC directly with target `lodge` and a matching source version (or omitted expected-state fields). It then changes `business_type` to `lodge`. The renderer's same-family check does not protect a SECURITY DEFINER API.

**Fix:** Verify the canonical existing product family/current property type server-side for preview and new commits, including consistency with authoritative product/licensing identity. Reject unsupported source types, malformed/missing required expectations and cross-product transitions. Handle historical receipt replay according to explicit authorization rules without mutating the current family.

**Required evidence:** Direct RPC tests from hotel, resort, restaurant, bar and unsupported/unknown sources, not just disallowed destination tests. Include null/empty expectation bypass attempts.

## R3 — P1: ordinary settings writes can overwrite a committed classification

**Location:** `src/main/domains/settings.js:202` (`saveRemoteSettingsRecord`), direct unconditional upsert around line 241, and local-cache guard around line 467.

The new lock is checked against this device's cached settings. The ordinary save still includes property_type, business_type and operating_profile in an unconditional settings upsert, without comparing the server version. If device A caches lodge and device B commits camp, A can save an unrelated setting using its old lodge snapshot; its local check passes and it sends lodge back to the database. The transition migrations add no server classification-write guard. The dedicated ledger can consequently disagree with the current settings row. A separate profile upsert can also restore stale nested classification/presentation data.

**Fix:** Enforce classification ownership at the database boundary and make normal/profile saves preserve the current authoritative classification under concurrency. Use atomic/versioned contracts or a narrowly scoped database guard with explicitly trusted bootstrap/restore/admin behavior. Do not merely refresh the local cache or remove the visible selector. Trace direct/PWA/admin/import/restore writers and preserve legitimate unrelated saves. Require classification changes through the audited contract, not a forgeable client flag.

**Required evidence:** Two independent sessions; stale ordinary save and stale profile save after a transition; direct update/upsert bypass attempts; legitimate ordinary settings edits; bootstrap and approved exact restore. This is a source-confirmed missing enforcement path; no live exploitation was performed.

## R4 — P1: recovery persistence fails open, and unresolved operations can be erased

**Location:** `Settings.jsx:183–191`, submission around line 579, discard around lines 588–615; scoped recovery around line 279.

`saveStoredTransitionOp` silently ignores missing/blocked storage and write failures, yet runCommit still sends the RPC. A timeout followed by closing the app then loses the original key/payload. Calling the write before the RPC is not sufficient if the write is allowed to fail silently.

The discard action only requires two clicks. It does not require a completed server outcome, proven terminal non-application, or cancellation, despite its confirmation label implying the outcome was checked. It can erase an unresolved operation while a late request may still land. The foreign-scope panel also permits deletion of another scope's recovery record without resolving its outcome.

**Fix:** Require verified durable persistence before first submission, with an actionable storage failure and zero RPC calls on failure. Keep unresolved keys/payloads recoverable. Do not offer permanent deletion as a substitute for reconciliation. If abandoning an operation is supported, retain an immutable archive and use a server-authoritative terminal/cancellation contract where needed. Do not let another user/property erase its recovery record. Fence asynchronous callbacks by current scope and operation identity so late results cannot clear a newer operation.

**Required evidence:** Mounted Settings tests with blocked/quota-failing storage, absent storage, restart recovery, late completion, scope switching and stale callbacks. Assert that no write failure can be followed by mutation submission.

## R5 — P2: refresh failures are falsely reported as successful recovery

**Location:** `src/main/domains/propertyTransitions.js:86–94,142–148,159–170`; `Settings.jsx:1495–1507`, submit/status result handling.

The main refresh destructures only data and returns true even if Supabase resolves with an error or no row. This was reproduced with the actual function. Exact commit replays deliberately skip the cache refresh. The renderer does not inspect `result.refresh.ok`, and its refresh callback catches both settings and entitlement failures without returning failure. Its outer warning path consequently cannot detect those failures. `settings.get()` is cache-first, so this can silently reapply stale classification after the server committed.

**Fix:** Return a truthful refresh result for resolved errors, missing/mismatched rows and thrown failures; capture the original lodge scope across awaits. Refresh canonical settings on replay/status recovery as appropriate. Propagate refresh state through IPC and the real UI. Use an awaited authoritative settings read for transition reconciliation; propagate settings/access refresh failures while retaining the completed mutation result and offering refresh-only recovery. Never resubmit to repair a refresh failure.

**Required evidence:** Resolved Supabase errors, null data, old cache on replay, settings read failure, entitlement refresh failure and scope change during refresh. Verify a visible saved-but-refresh-pending state and no new mutation.

## R6 — P2: test evidence does not exercise the production Settings lifecycle

**Location:** `tests/property-transition-lifecycle.test.mjs`, `tests/helpers/property-transition-harness.mjs`, `Settings.jsx`; SQL placeholder branches at `tests/property-type-transition-sql.test.mjs:25` and `tests/campsite-quotation-conversion-sql.test.mjs:33`.

The lifecycle tests run the pure createLifecycle controller and a Map-backed harness. Settings imports helper functions but implements its own asynchronous control flow instead of using that controller. Therefore tests named for unmount/restart/refresh do not exercise the production storage helpers, React state/effects, actual timeout handling or refresh callback. That is why R4/R5 survive the passing suite. The HTML walkthrough likewise does not mount production components.

Both SQL suites register an ordinary passing test with assert.ok(true) when credentials are absent. The test runner then reports zero skipped. The disposable driver also exits zero when it did no database work.

**Fix:** Share one real operation controller with the production component or mount the actual production component in behavioral tests. Use genuine test.skip/t.skip and require a non-skipping database verification command in acceptance/CI. Missing disposable credentials must be an explicit incomplete gate, never a green database acceptance result. Keep production-target refusal intact.

**Required evidence:** Tests fail for intentionally broken persistence/refresh/replay behavior and pass after repair; actual Settings/Bookings rendered journeys for all five types; test summary separates passes/skips; a required database command fails or reports blocked when no database was tested.

## R7 — P2: desktop estimate/validation disagrees with the main accommodation contract

**Location:** `Bookings.jsx:1281–1296` and campsite/tent inputs; `src/main/domains/bookings.js:891–905`; inventory pricing fields in Rooms.jsx.

The renderer estimates permanent tents through computeStayTotal and shows tent/vehicle controls for permanent-tent units. The main domain treats only accommodation_kind=campsite as campsite pricing, zeroes tent/vehicle counts for other kinds and prices permanent tents as ordinary nightly rooms. Inventory exposes rate_mode inputs, so this is a reachable contract mismatch rather than an impossible fixture.

A bounded probe executed the actual extracted renderer estimate with a permanent tent configured at 100/night, 70/person/night, two adults and three nights: renderer estimate **420**; the main domain's non-campsite base-price branch **300**. This proves branch disagreement, not a live server charge; no financial transaction was submitted.

Additionally, single booking creation applies the generic total-guests > max_occupancy room check before identifying campsites. With adult capacity 2, child capacity 2 and max_occupancy 2, a valid campsite stay for 2 adults and 1 child is rejected before its dedicated capacity rules run. Rooms editing links max_occupancy to adult capacity, making this particularly relevant. Review equivalent group/edit paths.

**Fix:** Decide and consistently enforce pricing semantics by accommodation kind across inventory, estimate, validation, authoritative quote/create/edit, public booking and replay. Do not show unsupported permanent-tent pricing or discard accepted inputs. Apply campsite-specific adult/child/tent/vehicle limits without an earlier incompatible room-style gate. Preserve existing confirmed prices and queued contracts.

**Required evidence:** A permanent tent with non-site rate mode through the actual renderer-to-main path; mixed room/tent/site bookings; a campsite with separate adult and child capacity; limits and overcapacity failures; all five modes and offline replay.

## R8 — P2: deployment instructions are unsafe/inaccurate for the current backlog

**Location:** `docs/engineering/property-adaptation/DEPLOYMENT-pending.md:24–37` and the zero-fill patch in `20261014030000_campsite_quotation_conversion_carry.sql:40–52`.

The note suggests a single db:push while listing only three migrations. The working tree contains many other unapplied candidates; an unqualified push is not limited to the listed feature migrations. It also calls all three migrations reapply-idempotent, but the asserted zero-fill replacement intentionally finds zero matches after its first application and raises on reapply. Fail-closed one-time patching is reasonable; claiming it is reapply-idempotent is inaccurate.

**Fix:** Produce an exact reviewed dependency/deployment manifest and explicit dry-run pending list. Do not deploy unrelated financial/Bar migrations as a side effect. State one-time migration versus supported rerun behavior accurately. Include forward corrections from this review, verify prerequisite function definitions and privileges, and document rollback/recovery without suggesting a destructive ledger drop when history exists.

**Required evidence:** Disposable application from the claimed deployment baseline through the approved dependency chain; reviewed dry run; accurate post-apply routine checks. Production deployment remains a separate authorized action. Linked state was not freshly queried in this review.

## Additional incomplete presentation requirement

The main shell passes property type/profile/add-ons to navigation, not the loaded actual inventory mix. Inner inventory screens use loaded rooms and can therefore say Sites while the sidebar/header still say Rooms for a legacy lodge containing campsites. Verify a single consistent actual-mix summary and subscriptions after inventory/profile transitions. Treat this as part of R6/R7 rendered integration acceptance rather than claiming helper-only coverage proves consistency.

## Acceptance decision

Do not deploy or call this implementation complete on the strength of the current unit summary. Correct R1–R8 in a bounded integrated pass, rerun focused checks, execute real disposable SQL assertions, mount production UI journeys and obtain independent re-review. Existing lifecycle helpers and catalog/vocabulary work are useful and need not be discarded. The earlier never-retired key issue is corrected; this review identifies remaining production-path gaps rather than asking to redo that work.
