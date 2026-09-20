# Shared Till shift-start consolidation plan

Status: Approved for implementation — 2026-09-11
Supervisor: reviewing model (verifies each work item against this plan; does not implement)
Implementer: a separate model/session working in this repository
Deployment boundary: all SQL here is **local-only**. No `supabase` push, no release, no publish. Deployment is a separate owner decision requiring disposable-DB acceptance per repo norms.

Scope: **Part 1 (W1–W8)** — shared-Till shift-start consolidation (unlock float, one session contract, hide Start-shift in shared mode). **Part 2 (W9–W13)** — owner-ordered 2026-09-11 daily-operations offline tranche (open tabs, cash-up review UI, 90-day login, 90-day entitlement, stock/product residuals). **W14–W19 are PROPOSED only** — they need an explicit owner pick each; do not implement without it. A "deliberately stays online" list closes the section.

Citation rule: cite by **symbol + quoted code**, never by line number alone — line numbers drift (parallel workstreams share this tree).

Read before starting: `AGENTS.md`, `PROJECT_STATE.md` (top sections), `docs/ARCHITECTURE.md`, this file in full.

## 1. Problem (verified against current code)

There are three surfaces that can start a Till (POS) shift. Only one of them follows the full contract:

| Surface | Attendance | Opening float | Shift↔attendance link | Stable retry key |
|---|---|---|---|---|
| My Shift page (`src/renderer/src/components/hospitality-pos/HposMyShift.jsx:73-108`) | clocks in | explicit | links | localStorage attempt key |
| Till first-sale prompt (`src/renderer/src/components/hospitality-pos/HposTerminal.jsx:2172-2204`) | none | explicit | none | none |
| Shared-Till PIN unlock (`src/main/domains/pos.js:4095` + deployed RPC) | online: requires prior clock-in; offline: auto-creates | **invented 0** | links | renderer mints a fresh UUID per click (`HposTerminal.jsx:1490`) |

Consequences (all verified):
- The busy-bar real-world path (clock in at kiosk → PIN unlock → sell) creates shifts with `opening_float = 0` written by the system, not the operator. Expected drawer math (`expected_cash_drawer = shift.opening_float + cash tenders − retained tips`, migration `20260715021000_cash_tip_retention_cashup.sql:45` and successors) is then computed from a fabricated baseline, so manager variance review is misinformed, and the documented "an empty float never starts a shift" rule is bypassed.
- Offline unlock mints a **new local shift row per unlock click** (no existing-open-shift check, `pos.js:4121-4141`) with a fresh idempotency key each time; the local cache accumulates duplicate pending rows even though server replay converges via `already_open`.
- The Till prompt creates unlinked shifts (no attendance, no link, no stable key). The clock-out cash-up gate still holds because it checks by `cashier_id` (`20260715025000_restaurant_clockout_sales_fail_closed.sql:10-11`), so this is attribution/audit debt, not a lost guardrail.
- In shared (manager-account) mode the Till's "Start shift" button opens a shift owned by the **manager's login account** while sales attribute to the PIN operator — worse than useless.

## 2. Owner decisions (settled 2026-09-11, do not relitigate)

1. **Offline-first:** everything works offline except first-time login and first-time PIN usage. Therefore the *online* unlock RPC is aligned to the offline behavior: PIN-verified unlock creates attendance when none is active (via the authoritative attendance RPC), instead of refusing.
2. **Float is asked once per operator per shift**, at the first PIN unlock that needs to create their shift. Never per unlock, never per order. Operators with an open shift keep today's PIN-only speed.
3. My Shift page and the Clock in/out kiosk stay as they are (personal-mode start + close-out home; attendance/payroll only).
4. "Start shift" controls are hidden on the Till when a manager account is logged in (shared mode); they remain for personal logins.
5. Historical float-0 shifts and past variance reviews are out of scope.

## 3. Verified contracts the implementer must build on

- `open_pos_shift_with_id` — deployed body in `supabase/migrations/20260619213000_legacy_pos_shift_outlet_and_cashup_enforcement.sql:3-92`. Dedupes by `shift_id`/`create_idempotency_key`, then by open shift per lodge+outlet+**cashier**; advisory-locked; coalesces missing float to 0. **Do not modify this function** (Legacy POS queue and other callers depend on it).
- `activate_shared_till_operator` — deployed body = `20260715026000_restaurant_shared_till_requires_attendance.sql:4-100` **plus** the surgical proof-mint patch in `20260820180000_pos_tab_assigned_waiter_ownership.sql:747-785` (adds `v_operator_proof`/`v_operator_proof_hash` declarations and the `pos_till_operator_proofs` mint before the return). Grants per `20260821040000_offline_rpc_contracts_and_desktop_grants.sql:218-219`: `anon, authenticated, service_role`.
- `activate_shared_till_operator_offline` — `20260816200000_bar_offline_continuity.sql:207-224`: replay short-circuit on existing `pos_shift_id`, else calls the base function with `payload-'pos_shift_id'`, then renames the created shift to the requested id.
- `clock_in_staff_with_attendance_pin` — `20260715018000_restaurant_attendance_pin_kiosk.sql:20-31`: re-validates the PIN (rate-limited via `pos_pin_attempts`) and calls `clock_in_staff`. Actor must be admin/manager/supervisor (same as unlock).
- IPC wrapper `pos:activateSharedTillOperator` — `src/main/index.js:9375-9393`: requires `pos.manage`; **fails closed when an online result carries no `operator_proof`**; resolves the shift; sets the local session lease (`setSharedTillOperatorSession`) and returns `{shift, session, till_operator_policy}`. Preserve this wrapper's behavior exactly; only the payload gains `opening_float`.
- Domain `activateSharedTillOperator` — `src/main/domains/pos.js:4095-4158`: online branch calls the RPC; offline branch validates cached PIN, auto-creates attendance (queue id `attendance-shift-${id}`, key `${resolvedKey}:attendance`), mints a new shift (float 0) and queues `activate_shared_till_operator_offline` with `_depends_on` attendance.
- Renderer `verifySharedOperator` — `HposTerminal.jsx:1480-1520` (fresh `crypto.randomUUID()` key at 1490 — the defect to fix); unlock dialog `HposTillOperatorDialog.jsx` (dumb component, props-driven).
- `linkMyPosShiftToAttendance` domain — `pos.js:4175-4189`: full offline path (local link + queued `link_my_pos_shift_to_attendance` with `_depends_on_all`). Reuse as-is.
- `clockInSelfForPos` domain — `pos.js:5384+`.
- My Shift reference sequence — `HposMyShift.jsx:81-100`: localStorage attempt key `hpos:pending-shift:${userId}:${outletId}`, idempotency keys `${attemptKey}:attendance` / `${attemptKey}:pos-shift`, link call after open, key cleared only on success.
- Preload: `src/preload/index.js` exposes the `pos.*` API surface; confirm exact binding names there before adding new ones.

### 3b. Offline capability audit (verified 2026-09-11 — every function in the flow)

The owner's rule is offline-first (everything offline except first-time login and first-time PIN usage). The audit confirms **the entire flow already has offline paths — nothing new needs to be made offline; the plan's changes must simply not break them.**

| Function | Offline behavior | Source |
|---|---|---|
| `getPosStaff` (unlock dialog staff list) | cached `pos-staff` list | `pos.js:4507-4519` |
| `validateCachedPosPin` (offline PIN check) | cached `users` row with `pin_hash`; **first-use fails closed** with actionable message ("not prepared on this computer. Connect once and refresh staff access.") | `pos.js:148-172` |
| `getCurrentPosShift` (W3 `needsFloat` pre-fetch, My Shift) | server-authoritative when online (also clears stale local "open" rows so clock-out is never blocked); local cache when offline | `pos.js:3847-3889` |
| `getStaffOpenPosShift` (shared cash-up, open checks) | local cache | `pos.js:4074-4083` |
| `getActiveShifts` (attendance reads) | local cache | `pos.js:5441-5442` |
| `clockInSelfForPos` | local upsert + queue `clock_in_self_for_pos_offline` | `pos.js:5384-5408` |
| `clockInStaffWithAttendancePin` (kiosk) | cached-PIN verify + local upsert + queue | `pos.js:5354-5382` |
| `openPosShift` | local row + queue with attendance dependency | `pos.js:3891-3959` |
| `activateSharedTillOperator` (unlock) | cached-PIN verify + attendance + shift + queue (defects fixed by W2) | `pos.js:4095-4158` |
| `linkMyPosShiftToAttendance` | local link + queue with `_depends_on_all` | `pos.js:4175-4189` |
| `touchSharedTillOperatorProof` | returns success offline (proof renewal is online-only by design) | `pos.js:4160-4161` |
| `getStaffPosCashupSubmission` / `getMyPosCashupSubmission` | local cache | `pos.js:4085-4093` |
| `getSharedTillPolicy` | reads cached settings via `db.getSettings()` | `index.js:4434-4437` |

Consequences for the work items:
- W3's `needsFloat` pre-fetch works offline via the `getCurrentPosShift` cache path; the IPC returns `null` on read error, and null ⇒ ask for the float (server ignores it on `already_open`) — fail toward asking.
- W2's drift guard is online-only by definition; it must not fire offline.
- The only genuinely online-only moments in this flow are: first-time PIN preparation (by owner rule) and proof renewal while a session is active — both already communicate actionable messages.

## 4. Work items

### W1 — Migration `supabase/migrations/20260913000000_shared_till_unlock_float_and_attendance.sql`

First verify the timestamp is free and strictly after `20260912000000` (the current head; see PROJECT_STATE 2026-09-11 entries). Follow sibling-migration file-ending conventions.

Single migration, `begin;` … `commit;`, two full-body redefinitions:

**A. `create or replace function public.activate_shared_till_operator(payload jsonb)`** — reconstruct the *current deployed body* (20260715 base with the 20260820180000 proof-mint block integrated verbatim, including the `make_interval(mins => greatest(5, least(240, …)))` expiry) with exactly these changes:

1. New local: `v_opening_float_text text := nullif(btrim(payload->>'opening_float'),'');` and `v_opening_float numeric;`
2. Attendance branch (replaces the refusal at 20260715 lines 50-63): if no active attendance row, call
   `public.clock_in_staff_with_attendance_pin(jsonb_build_object('lodge_id', v_lodge_id, 'staff_user_id', v_staff_id, 'pin', v_pin, 'role', coalesce(v_staff.role,'bar'), 'device_id', v_device_id, 'idempotency_key', v_key || ':attendance'))`
   and return its failure envelope if not successful; then re-select the active attendance row (`for key share`, newest `clock_in`). Note in a comment: the attendance RPC re-validates the PIN; a second *successful* `pos_pin_attempts` row is expected and acceptable (one authoritative attendance contract).
3. Float handling:
   - Before calling `open_pos_shift_with_id`: if `v_opening_float_text` is null → `'opening_float'` must not be silently 0. Two acceptable designs — implement **(a)**: omit float enforcement when the operator already has an open shift (the RPC returns `already_open` and ignores the float). Enforce by pre-checking for an open shift per lodge+outlet+cashier (same predicate as `open_pos_shift_with_id`'s dedupe, `for update`): if none exists and `v_opening_float_text` is null → return `{success:false, code:'opening_float_required', error:'Count the drawer and enter the opening cash float (0.00 when empty) before unlocking Till.'}`. If present → `v_opening_float := round(greatest(0, v_opening_float_text::numeric), 2);` and reject non-numeric via exception handling with an actionable message.
   - Pass `'opening_float', v_opening_float` into the `open_pos_shift_with_id` call (replacing the hardcoded `0`).
4. Keep unchanged: actor/role checks, staff active check, PIN validation, `gen_random_uuid()` shift id, `create_idempotency_key = v_key`, attendance link update + its not-found error, the entire proof-mint block, return shape (`success, staff, attendance_shift_id, shift, operator_proof`).
5. Grants: `revoke all on function public.activate_shared_till_operator(jsonb) from public;` then `grant execute … to anon, authenticated, service_role;` (the 20260821040000 set).

**B. `create or replace function public.activate_shared_till_operator_offline(payload jsonb)`** — copy `20260816200000:207-224` with one change: the base call becomes
   `v_result:=public.activate_shared_till_operator((payload-'pos_shift_id')||jsonb_build_object('opening_float',coalesce(payload->>'opening_float','0')));`
   so legacy queued items (no float field) replay with explicit 0 — today's behavior preserved, no dead-lettered financial work — while new desktop payloads carry the real float. Re-apply the 20260816200000 grant block for this function verbatim (including the other functions in that revoke/grant list, unchanged).

Do NOT touch: `open_pos_shift_with_id`, cash-up submit/review RPCs, clock-out guards, expected-cash triggers, `touch_pos_till_operator_proof`.

Acceptance: a contracts test (W6) pins the SQL text: float-required branch present, attendance auto-create call present, wrapper `coalesce` default present, `open_pos_shift_with_id` untouched by this file, grant set matches.

### W2 — Domain `src/main/domains/pos.js` `activateSharedTillOperator` (line 4095)

- Accept `opening_float` / `openingFloat`.
- Online branch: include `opening_float` in the RPC payload when provided. **Backend-drift guard:** if the result created a shift (i.e. not `already_open` and not a replay) and `round(Number(result.shift.opening_float),2) !== round(Number(sentFloat),2)` → return `{success:false, code:'backend_update_required', error:'This Till needs its server update before floats can be recorded. Take payments only after the update, or enter 0.00 deliberately.'}` — fail closed; never silently accept a server-ignored float.
- Offline branch:
  - Keep the attendance auto-create exactly as-is (owner decision #1).
  - **Reuse before minting:** look up `readPosShifts()` for `status === 'open' && cashier_id === staffId && outlet_id === resolvedOutletId`; if found (pending or confirmed), return it in the success envelope (no new local row, no new shift queue op). The IPC wrapper sets the session lease from `result.staff`/`result.shift`, so the domain envelope shape stays `{success, staff, shift, attendance_shift_id, session:{outlet_id, last_activity_at}, offline:true, queued:true, provisional:true}`.
  - If minting: reject a missing/blank float with the same actionable message as the RPC (`opening_float_required`); use the existing money normalizer; add `opening_float` to the payload of the **existing** `queueOperation('rpc','activate_shared_till_operator_offline',…)` call at `pos.js:4130-4138` (payload otherwise unchanged; keep queue id `pos-shift-${row.id}` and the `_depends_on` attendance wiring).

### W3 — Renderer unlock dialog (HposTillOperatorDialog.jsx + HposTerminal.jsx)

- Dialog gains props `needsFloat`, `openingFloat`, `onOpeningFloat`. When `needsFloat`, render a numeric input (min 0, step 0.01, inputMode decimal, placeholder "0.00") between the staff grid and the PIN keypad, with hint: "Count the drawer now and type what's in it — 0.00 if empty. You're only asked once per shift." Confirm button disabled while `needsFloat && String(openingFloat ?? '').trim() === ''` (same rule as My Shift: empty never defaults).
- `HposTerminal`:
  - On staff selection, fetch that operator's open shift for the selected outlet via the existing `window.api.pos.getCurrentShift(selectedOutlet.id, member.id)` (IPC `pos:getCurrentShift`, `index.js:9115-9118`); `needsFloat = !shift?.id`. On read failure, set `needsFloat = true` (fail toward asking: the server ignores the float on `already_open`, so asking is always safe; skipping it is not).
  - `verifySharedOperator` (line 1480): replace the per-click `crypto.randomUUID()` with a stable attempt key `hpos:pending-till-unlock:${lodgeId}:${selectedOutlet.id}:${operatorStaffId}` (get-or-create + persist, mirroring `HposMyShift.jsx:81-83`); clear it **only on success**. Pass `idempotency_key: attemptKey` and `opening_float: needsFloat ? Number(openingFloat) : undefined`.
  - Surface `backend_update_required` / `opening_float_required` errors on the dialog with their server messages.

### W3b — Plain-language offline/online status communication (all new moments)

Reuse existing infrastructure — **no new status framework**: the `syncStatus`-driven indicator already in `HposNav.jsx:14-53` (online/offline + pending/failed sync counts), `HposNotice` tones, and the established notice sentence pattern (`HposMyShift.jsx:102`, `HposTerminal.jsx:2198`). The new queued operations ride the existing queue, so the nav indicator already counts them — verify, don't rebuild.

Every new state the user can land in must answer, in simple words: **what happened, where it's saved (this device vs the server), what happens next**. No jargon ("idempotency", "provisional" alone, "RPC", "sync contract"). Required notices:

- Offline unlock success: "You're clocked in and unlocked. Your shift and sales are saved on this computer and will sync when you're back online."
- Online unlock that auto-created attendance: "You're clocked in and unlocked. Your shift is open with a {float} float."
- Unlock with an existing open shift: "You're unlocked. Your open shift continues." (never re-asks for float)
- Float prompt hint (W3) and `opening_float_required` error (W1/W2): as already specified — plain, actionable.
- Drift guard (W2): the `backend_update_required` message as specified.
- First-time PIN offline: surface the existing domain message verbatim ("This staff PIN was not prepared on this computer. Connect once and refresh staff access.").
- `startTillShiftSession` (W4) must preserve `offline`/`provisional`/`queued` flags in its return shape so My Shift and the Till prompt keep rendering the existing offline sentence ("…saved on this device. You can take payments offline; they remain provisional until sync." — plain-worded already).

If any state cannot be described in one short sentence, that is a design smell — surface it to the supervisor rather than shipping a paragraph.

### W4 — One start-shift contract in the main process (personal mode + My Shift)

- New domain function `startTillShiftSession(data)` in `pos.js`, sequencing the three existing domain functions (no new business logic). **It never calls `queueOperation` itself** — offline queueing happens inside the existing functions per the §5 rule 0 table:
  1. `clockInSelfForPos({ role, idempotency_key: `${key}:attendance` })` — role derived as My Shift does (`user.role` / bar profile). If it reports an already-active attendance, continue.
  2. `openPosShift({ …, idempotency_key: `${key}:pos-shift` })` — existing function, including its offline queue with attendance linkage.
  3. `linkMyPosShiftToAttendance({ pos_shift_id, attendance_shift_id })` — its offline path already queues with `_depends_on_all` (`pos.js:4175-4189`); call it when both ids resolve.
  - Input: `{ outlet_id, opening_float, attempt_key }` (the renderer supplies the stable attempt key; never mint fresh keys mid-sequence). Return `{success, shift, attendance_shift_id, already_open?, offline?, provisional?}` with per-step failure envelopes carrying actionable messages.
- New IPC `pos:startTillShiftSession` in `index.js` — `requireCapability('pos.manage')` (same as `pos:openShift`, `index.js:9119-9122`) — plus the preload binding (confirm naming conventions in `src/preload/index.js`).
- `HposTerminal.jsx` `openShift` (2172-2204): switch to the new IPC; keep the explicit-float validation and UI states; use the stable attempt key family `hpos:pending-shift:${user.id}:${outletId}` (same family as My Shift so the two surfaces share retry semantics).
- `HposMyShift.jsx` `startShift` (73-108): switch to the same IPC (renderer-side sequencing is removed — that drift is how the Till prompt diverged). Preserve the existing notice texts including the offline/provisional wording.

### W5 — Hide Start-shift in shared mode (HposTerminal.jsx)

- The header fallback button at ~3263-3280 renders only when `!sharedTerminalMode`. The "Shift open" badge stays.
- The `setShowShiftStart(true)` call sites (2218, 2391): in shared mode, instead show the unlock dialog (`setShowOperatorUnlock(true)`) with the operator-required message. The float prompt itself stays personal-mode-only.

### W6 — Tests (use the real scripts from `package.json`; do not invent suites)

Follow existing patterns: SQL-contract pinning as in the bar product contracts suite; domain behavioral tests as in `tests/bar-till-operator-policy.test.mjs`; component/harness tests via the established browser-harness pattern (`tests/browser/`, bundles regenerate via esbuild).

1. **SQL contract test:** new migration file contains the float-required branch, the `clock_in_staff_with_attendance_pin` auto-create call, the wrapper `coalesce(payload->>'opening_float','0')` compat, the anon/authenticated/service_role grant set; asserts `open_pos_shift_with_id` is not redefined in this file.
2. **Domain behavioral tests:** offline unlock reuse (second unlock returns the same shift, no new local row, no new queue op); float passthrough into the offline queue payload; stable key reused across retries; online drift guard (RPC mock ignores float → `backend_update_required`, fail closed).
3. **Harness tests:** dialog shows the float field only when the selected operator has no open shift; confirm gated on explicit float; shared-mode Till hides the Start-shift button and routes the no-shift case to the unlock dialog; personal-mode prompt calls the new session IPC with the stable key.
4. **Runs:** targeted new suites, then full `npm run test:bar` (baseline: only the 2 pre-existing `bar-guides-contract` PDF-checksum failures are acceptable), `npm run build:hospitality-pos`, `git diff --check` on touched files.

### W7 — Bar manual impact (Required; AGENTS.md bar-customer documentation rule)

- `docs/bar-manual/manuscript.md`: the Till-unlock flow gains the one-time opening-float step (verify the correct Part/section against the current structure); the first-sale path for personal logins is unchanged in substance but now clocks attendance automatically.
- `docs/bar-manual/screenshots.csv` (S08 unlock dialog gains/updates the float-field state), `coverage.csv` (C2 row), `evidence.md` row.
- Record "PDF rebuild/manifest approval pending with the guides workstream" exactly as current PROJECT_STATE entries do; packaged-guide smoke follows that workstream. Do not put internal mechanics (migration/deployment) in customer PDFs.

### W8 — PROJECT_STATE.md

New dated entry at top: what changed (unlock is now the authoritative shift-starter with explicit float + auto-attendance; one start-shift contract in the main process), migration local-only (not deployed), evidence (test/build results), relaunch required for UI, manual impact recorded as pending PDF rebuild.

---

## Part 2 — Daily-operations offline tranche (owner-ordered 2026-09-11)

Goal as ordered: the bar's daily operation — till, tabs, shifts, stock/product functions, cash-up review — works offline, using existing queue paths, rules and replay architecture only (§5 rule 0). Audit result the implementer must internalize first: till/shift/attendance/cash-up-submit/stock-adjust/count/delivery/expenses/product-saves **already queue offline** (§3b table) — Part 2 closes the remaining gaps, it does not rebuild the queue.

### W9 — Open tabs offline (Bar scope) [committed]

Verified current behavior: in Bar scope, offline tab saves delete the local row and refuse — `'Tab changes require a live connection so the package scope, assigned waiter, and active Till shift can be confirmed.'` (`savePosTab` offline branch); the same function queues `upsert_pos_tab` for restaurant scope. Offline orders with `tab_id` refuse — `'Bar tab sales require a live connection so the assigned waiter and active Till operator proof can be confirmed. Counter sales may continue offline.'` (`createPosOrder` offline branch). Tab versions are enforced with code `tab_version_required` and new tabs start at version 1 locally (`savePosTab`).

1. Domain `savePosTab`: Bar scope uses the **identical existing queue path** as restaurant (`queueOperation('rpc','upsert_pos_tab',…)`, `_queue_id: pos-tab-${id}`) instead of deleting the row; keep the local row marked pending. Wire `_depends_on` to the operator's shift queue id (and attendance where applicable), following the `openPosShift` dependency pattern.
2. Domain `createPosOrder` offline: allow `tab_id` **only when the tab row exists locally**; keep the folio/booking/catalog gates untouched. Offline orders must carry the local tab's `expected_tab_version` (the existing `tab_version_required` path stays — missing version still fails closed).
3. Domain `updatePosTabStatus` offline: queue via the existing RPC name following the established `_offline`-wrapper convention — implementer verifies whether an offline wrapper RPC already exists; if not, the W1 migration (same file, separate function block) adds one following the `20260816200000` replay-wrapper pattern (short-circuit on existing id, else delegate, then reconcile ids). No new RPC names beyond that convention.
4. Migration (fold into the W1 file): read the current `upsert_pos_tab` body (20260820180000 base + later patches incl. 20260807130000 tab versions) and verify its proof-absent branch for Bar scope. Add replay tolerance for offline-queued items ONLY: accept when the payload carries the offline marker AND the referenced shift was open AND idempotency dedupes; version/proof/ownership conflicts fail the item into the existing failed-queue review. Do not weaken the live (non-queued) Bar proof path.
5. Renderer (Open Tabs + Till): handle the queued-tab envelope and show W3b notices — e.g. "Table 4 is held on this computer and will sync when you're back online. If another till changed it first, the manager reviews the conflict." Tab settlement with offline tabs queues normally; proof is re-validated at replay; rejection goes to failed-queue review. Keep `_pos_tab_settlement_owner_error` untouched.
6. Tests: offline hold/add-to-tab/settle-status queue with the existing RPC names and queue ids; replay conflict (stale version, double-hold) → failed queue, no silent merge, no overwrite; folio/catalog gates still fail closed offline.

Residual risk (stated, owner accepted): two offline tills editing one tab diverge until replay; the server version check arbitrates and the loser needs manager review. This is inherent to offline tabs — the plan contains it, it does not eliminate it.

### W10 — Manager cash-up review while offline (renderer unblock) [committed]

Verified: the domain needs NO change — `reviewPosCashupSubmission` offline validates the logged-in manager's PIN against the cache, stores the decision locally (closing the shift locally on approve), and queues `review_pos_cashup_submission_offline` with `_depends_on` the submission queue (`pos.js:3404-3433`), so submit replays before review. The ONLY block is the renderer: `HposCashClose.jsx` throws `'Cash-up review is unavailable until the server confirms…'` when `result.offline === true`.

1. Renderer: remove that throw; render cached submissions with W3b labels — "Counts from this device — server totals not yet confirmed. Expected and variance show as unavailable until sync. Your approve/return queues and takes effect when it syncs." Keep the manager-PIN prompt (the domain requires `payload.manager_pin` offline) and the correction-note-required rule.
2. Ordering safety is already guaranteed by the existing `_depends_on` wiring — state this in a comment, do not re-implement.
3. Residual risk (stated, owner accepted): approving without server-computed expected totals is trust-based. Mitigations present: counted value plus cached shift sales remain visible for a sanity check.
4. Tests: review queues offline with decision/note/PIN validation paths; UI renders cached list with the unavailable-expected labels; approve closes the shift locally and queues in order behind the submission.

### W11 — Trusted login 60 → 90 days [committed]

Verified: client-only control, no server counterpart (`TRUSTED_SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000`, `authSession.js`; drives prune + expiry display from the same constant). No renderer/docs copy states the window (verified by grep — all "60 days" hits are unrelated report ranges).

1. Change the constant to 90 days. MASTER 4h and the 7-day online nonce stay untouched.
2. Update `tests/bar-offline-continuity.test.mjs` (the test literally pins the 60-day expression) to 90 in the same change — this is an owner-ordered contract change, not a test fix.
3. Risk note (stated): a longer stolen-device + known-password window. Unchanged mitigations: password required at every unlock, master excluded, cross-product reuse rejected, bcrypt verification.
4. No migration. Tests: the updated contract test plus lease/session suites green.

### W12 — Entitlement offline lease → 90 days [committed]

Verified mechanics: `DEFAULT_OFFLINE_LEASE_DAYS = 7` (`subscriptionState.js`); trial hardcodes 30 (`entitlements.js`, two spots + both `computeOfflineValidUntil` calls); the lease window runs from the last online refresh; `min()` with expires/trial-end/grace preserved.

1. Change the default 7 → 90 and both trial 30 → 90 values + their `computeOfflineValidUntil` call sites.
2. HARD CONSTRAINT: an explicit `license.offline_lease_days` arriving from the server remains authoritative (`entitlements.js`, licensed-entitlement builder) — do NOT `Math.max` over it or otherwise override it client-side. If the lodge's license record carries an explicit value below 90, that value still wins; raising it is a license-record action, not code. Add a unit test pinning explicit-wins plus the default/trial paths.
3. Safety preserved (do not touch): non-access states (`expired` etc.) still resolve `offline_valid_until` to now — cancelled/expired accounts still fail closed regardless of lease.
4. Tradeoff (stated, owner accepted): an account that stops paying keeps working offline up to the lease window (now 90 days instead of 7). Server-side sync/replay authorization is unchanged — queued work from an expired account still dead-letters at replay; preserve replay authz exactly.
5. No migration. No renderer copy states the window (verified). Tests: lease-computation units (default, trial, explicit-wins, expired-fails-closed).

### W13 — Stock/product residual gaps (verify-first, then close) [committed]

Verified audit result: stock adjust/count/delivery/create/update, promotions, modifiers, packs, and product saves **already queue offline** — no work there. The implementer verifies each item below first, then acts:

1. `printBarcodeLabels`, `getRecipes` domain section, `submitStaffFeedback` — the audit could not verify these; confirm offline behavior and, if missing, queue via the existing patterns (no new RPC names).
2. `getMenuStockReadiness` (throws offline by design — it is the anti-oversell gate that pauses selling): **default NO CHANGE**; document why in the code comment. Only serve a stale-labeled cache if the owner explicitly orders it later (oversell risk).
3. Stock aging (`inventory.js`, throws by design): compute locally from the cached movement ledger as a pure function over `readCache` rows using the existing read-status envelope pattern, labeled "from this device's data". No new architecture.
4. Publication sweep: stays online BY DEFINITION (publication is the server act). No change.
5. Tests per item touched; W6 evidence extended.

### W14–W19 — PROPOSED, need an explicit owner pick each (do NOT implement)

- **W14 Kitchen ticket status moves:** queue + idempotent status; replay must reject moves against closed tabs (see the ghost-state comment at the update functions); cross-device divergence resolves by replay order + audit, loser to failed queue. Risk: two tills, different statuses.
- **W15 Opening checklists (create/complete):** queue with idempotency; HIGH daily-ops value (it is the morning routine).
- **W16 Alerts ack/resolve:** queue. Cheap.
- **W17 Handover notes:** queue the existing save path. Cheap.
- **W18 Reservations/waitlist:** queue + conflict-to-review (double-booking risk on replay).
- **W19 Discount approval offline:** cached manager-PIN verify (same pattern as review at `reviewPosCashupSubmission` offline); replay re-validates price integrity. Medium risk (prices provisional until replay).

### Deliberately stays online (do not queue; keep the plain-language errors)

Vouchers and loyalty (double-spend needs the server), standalone account charges and customer saves (server identity/balance), cash-up proof attachments (file upload = new machinery, not existing architecture), certified reports/exports/daily-close (certification IS the server), publication (same), gift cards and tip payouts, the stock-readiness selling gate (anti-oversell), supplier/PO/transfer flows. W3b already requires every one of these to fail with a one-sentence plain-language reason.

## 5. Hazards and compatibility rules

0. **Offline queue: existing rules and paths only.** All offline behavior in this plan must ride the existing queue infrastructure — `queueOperation('rpc', …)` with the existing `_queue_id` / `_depends_on` / `_depends_on_all` conventions, the existing local caches (`readPosShifts`/`writePosShifts`, `readAttendanceShifts`/`upsertAttendanceShift`), and the existing replay engine. No new queue storage, no new journal, no new replay or resolution logic, no new operation type, and **no new queued RPC names** — every queued operation must keep calling the already-deployed RPCs:

   | Step (verified) | Queued RPC | Queue call site |
   |---|---|---|
   | Attendance self clock-in | `clock_in_self_for_pos_offline` | `pos.js:5398-5400` |
   | Attendance PIN clock-in (kiosk/unlock) | `clock_in_staff_with_attendance_pin_offline` | `pos.js:4113-4119` |
   | Till shift open | `open_pos_shift_with_id` | `pos.js:3942-3957` |
   | Shared-till unlock | `activate_shared_till_operator_offline` | `pos.js:4130-4138` |
   | Shift↔attendance link | `link_my_pos_shift_to_attendance` | `pos.js:4182-4188` |
   | Cash-up submit | `submit_pos_shift_cashup[_with_attendance_pin]` | `pos.js` `submitPosCashup*` offline branches (existing) |
   | Cash-up review | `review_pos_cashup_submission_offline` | `pos.js:3424-3433` (existing) |
   | Open-tab save (restaurant pattern; Bar reuses it in W9) | `upsert_pos_tab`, `_queue_id: pos-tab-${id}` | `pos.js:2914-2916` |
   | Queued PIN fields (`pin`, `approval_pin`, `manager_pin`) | n/a (payload fields) | existing secret hygiene `secureQueueSecrets.js` (pinned by `bar-offline-continuity.test.mjs`) — no new secret handling in this plan |

   The **only** payload changes permitted anywhere in the queue are the additive `opening_float` field on the unlock/shift-open payloads (W1/W2) and the Bar-scope reuse of the existing tab payload shape (W9); existing queued items (including legacy items already on devices) must remain replayable unchanged — hence the wrapper compat default in W1-B. `startTillShiftSession` (W4) must not queue anything itself: its steps queue through the existing domain functions listed above. Stable attempt keys follow the existing `hpos:pending-*` localStorage pattern (`HposMyShift.jsx:81-83`, `HposAttendanceKiosk.jsx:13`) — no new key storage.
   Tab replay conflicts (stale `tab_version`, proof mismatch, double-hold of one table) must route to the **existing failed-queue review** (`sync:retryFailed`/`sync:clearFailed` + the HposSystemHealth queue desk) — never silent-merge, never last-writer-wins overwrite. The existing tab-version + payload-hash replay machinery (`20260807130000`) is the conflict arbiter; the desktop never resolves conflicts itself.

1. **Do not rebuild `activate_shared_till_operator` from 20260715 alone** — you would drop the 20260820180000 proof-mint block and every online unlock would fail closed at `index.js:9383` (`operator_proof_missing`). Integrate the patch block.
2. **Legacy offline queue items have no `opening_float`** — the wrapper default `'0'` keeps them replayable (AGENTS.md: preserve legacy queue compatibility; never silently discard queued financial work).
3. **Do not tighten `open_pos_shift_with_id`** — Legacy POS mesh queue and other callers send payloads without floats; enforcement lives in `activate_shared_till_operator` only.
4. **First-time PIN use offline stays impossible** — `validateCachedPosPin` needs a cached hash; no change.
5. **Deployment drift:** until W1 is deployed, online unlocks sending a float must fail closed via the drift guard, never silently record 0.
6. **Parallel workstreams:** the worktree contains untracked files from other workstreams (`docs/bar-manual/build/`, `output/`, `tmp/`, `tests/browser/*.bundle.*`). Do not touch, clean, or commit them. Preserve unrelated user changes (AGENTS.md implementation workflow #1).
7. **Never replace an ambiguous timeout with a fresh idempotency key** — that is the entire point of the stable attempt keys; the key rotates only after a definitive failure envelope, and clears only on success.
8. The `20260715026000` migration is deployed; modifying its function requires the new forward migration (W1) — never edit historical migration files.

## 6. Definition of done

- Unlock can never create a shift with an invented float: server rejects (`opening_float_required`), offline domain rejects, drift guard fails closed.
- Online and offline unlock agree: PIN-verified unlock ensures attendance (creating it via the authoritative attendance RPC when absent), reuses an existing open shift, and links attendance.
- Personal-mode Till prompt and My Shift run the same main-process session contract (attendance → shift → link) with stable retry keys.
- Shared-mode Till shows no Start-shift control; the no-shift case routes to unlock.
- Bar open tabs hold, update and settle-status offline through the existing `upsert_pos_tab` queue path; replay conflicts land in failed-queue review, never silent-merge.
- Manager cash-up review works offline through the existing review queue with plain-language unavailable-expected labels; submit replays before review via existing dependencies.
- Trusted login lasts 90 days (master still 4h); entitlement offline lease resolves 90 days by default/trial with explicit server values still authoritative and expired states still fail-closed.
- Stock/product residuals closed or explicitly documented as online-by-definition; unverified items verified first.
- W14–W19 untouched unless the owner picked them explicitly.
- Every new offline/online moment communicates in plain language what happened, where it's saved, and what happens next — reusing the existing `syncStatus` indicator and notice patterns (W3b), with no new status framework.
- Focused tests + full `npm run test:bar` (baseline failures only) + `npm run build:hospitality-pos` pass; `git diff --check` clean on touched files.
- Manual-impact assessment recorded; manuscript/screenshots/coverage/evidence updated; PDF rebuild noted as pending with the guides workstream.
- PROJECT_STATE.md updated; migration remains local-only with deployment state stated accurately.

## 7. Supervision protocol

The implementer lands work items in order W1 → W2 → W3 → W4 → W5, then W9 → W10 → W11 → W12 → W13, then W6 → W7 → W8, stopping for review at four checkpoints:

- **Checkpoint A (after W1+W2):** supervisor reviews the migration diff against the current-deployed-body reconstruction (proof block integrated, grants correct), the wrapper compat default, and the domain changes; runs the SQL-contract + domain tests.
- **Checkpoint B (after W3+W3b+W4+W5):** supervisor reviews renderer diffs (dialog gating, notice copy, stable keys, shared-mode routing, My Shift consolidation), runs harness tests.
- **Checkpoint C (after W9+W10+W11+W12+W13):** supervisor reviews tab-offline domain + migration replay-tolerance diffs, review-UI unblock, the two 90-day constant changes (+ the pinned test update), and stock/product residual handling; runs the extended contract, domain and harness tests.
- **Checkpoint D (final, W6+W7+W8):** supervisor runs full `npm run test:bar`, `npm run build:hospitality-pos`, `git diff --check`, verifies manual-impact records and PROJECT_STATE entry, and confirms no deployment/publish occurred.

Any deviation from this plan (different design choice, newly discovered conflict) must be surfaced to the owner before proceeding, not decided silently.
