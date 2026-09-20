import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (file) => fs.readFileSync(file, 'utf8')
const migration = read('supabase/migrations/20260820180000_pos_tab_assigned_waiter_ownership.sql')
const roleRepairMigration = read('supabase/migrations/20260821030000_bar_till_administrative_operator_roles.sql')
const pos = read('src/main/domains/pos.js')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const mesh = read('src/main/domains/mesh/meshQueueMerge.js')
const legacyMain = read('legacy-pos/src/main/index.js')
const legacyMesh = read('legacy-pos/src/main/mesh/legacyMesh.js')
const checks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const latestSplitContract = read('supabase/migrations/20260807130000_bar_tab_financial_snapshot_and_concurrency.sql')
const latestTillActivationContract = read('supabase/migrations/20260715026000_restaurant_shared_till_requires_attendance.sql')
const currentShiftSettlement = read('supabase/migrations/20260906163000_pos_tab_settlement_current_shift_proof.sql')

test('Bar tab mutation ownership is server-enforced and Bar-scoped', () => {
  assert.match(migration, /create or replace function public\._pos_tab_is_bar_scope\(p_lodge_id uuid\)/)
  assert.match(migration, /alter function public\.upsert_pos_tab\(jsonb\)[\s\S]*rename to upsert_pos_tab_unowned/)
  assert.match(migration, /Only the assigned waiter or its verified Till operator proof can change this tab/)
  assert.match(migration, /if not public\._pos_tab_is_bar_scope\(v_lodge\) then[\s\S]*upsert_pos_tab_unowned/)
  assert.match(migration, /if not public\._pos_tab_is_bar_scope\(v_tab\.lodge_id\) then[\s\S]*update_pos_tab_status_unowned/)
})

test('Hold/Open Check forwards the main-held Till proof to the authoritative upsert', () => {  assert.match(terminal, /window\.api\?\.pos\?\.saveTab\?\.\(\{[\s\S]*waiter_id: \(verifiedOperator \|\| user\)\?\.id \|\| null,[\s\S]*shift_id: currentShift\.id/)
  assert.match(main, /if \(tillContext\.operatorProof\) payload\._operator_proof = tillContext\.operatorProof/)
  assert.match(main, /const tillContext = await getTabMutationTillContext\(event, data \|\| \{\}\)[\s\S]*db\.savePosTab\(buildAuthoritativeTillPayload\(data, tillContext, 'tab'\)\)/)
  assert.match(main, /if \(context\.shared && !context\.operatorProof\)[\s\S]*code: 'till_operator_proof_missing'/)
  assert.match(pos, /state\.supabase\.rpc\('upsert_pos_tab', \{ payload: operatorProof \? \{ \.\.\.row, _operator_proof: operatorProof \} : row \}\)/)
  assert.match(migration, /v_operator := public\._pos_operator_proof_staff\(v_operator_proof, v_lodge, v_outlet, v_shift, v_actor\)/)
})

test('waiter-role helper uses the authoritative users schema', () => {
  assert.doesNotMatch(roleRepairMigration, /user_lodge_roles/)
  assert.match(roleRepairMigration, /from public\.users u[\s\S]*u\.lodge_id = p_lodge_id[\s\S]*lower\(coalesce\(u\.role, ''\)\) in \([\s\S]*'waiter'[\s\S]*'bar'[\s\S]*'bartender'[\s\S]*'cashier'[\s\S]*'admin'[\s\S]*'manager'[\s\S]*'supervisor'[\s\S]*'super_admin'[\s\S]*\)/)
  assert.doesNotMatch(roleRepairMigration, /'owner'/)
  assert.match(roleRepairMigration, /from public\.pos_shifts s[\s\S]*s\.outlet_id is not distinct from p_outlet_id[\s\S]*s\.cashier_id = p_waiter_id[\s\S]*s\.status = 'open'/)
  assert.match(roleRepairMigration, /from public\.restaurant_shifts a[\s\S]*a\.staff_user_id = p_waiter_id[\s\S]*a\.status = 'active'/)
  assert.match(roleRepairMigration, /s\.cashier_id = p_waiter_id/)
  assert.doesNotMatch(roleRepairMigration, /p_waiter_id\s+is distinct from\s+s\.cashier_id/)
})

test('waiter transfer locks, hashes, versions, audits, and replays safely', () => {
  assert.match(migration, /create table if not exists public\.pos_tab_waiter_transfer_operations/)
  assert.match(migration, /create table if not exists public\.pos_tab_waiter_transfer_audit/)
  assert.match(migration, /before update or delete on public\.pos_tab_waiter_transfer_audit/)
  assert.match(migration, /create or replace function public\.transfer_pos_tab_waiter\(\s*p_tab_id uuid,[\s\S]*p_operator_proof text default null/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('pos-tab-waiter-transfer:'/)
  assert.match(migration, /where lodge_id = v_lodge[\s\S]*operation_id = p_operation_id/)
  assert.match(migration, /v_tab\.tab_version <> p_expected_tab_version/)
  assert.match(migration, /tab_waiter_transferred/)
  assert.match(migration, /idempotency_conflict/)
  assert.match(migration, /target_waiter_shift_required/)
  assert.match(migration, /_pos_operator_proof_staff\(p_operator_proof, v_operation\.lodge_id, v_tab\.outlet_id, v_operation\.from_shift_id, v_actor\)/)
  assert.match(migration, /v_operator is distinct from v_operation\.from_waiter_id/)
})

test('shared Till proof is opaque, actor-bound, and never returned through renderer session APIs', () => {
  assert.match(migration, /pos_till_operator_proofs[\s\S]*created_by uuid/)
  assert.match(migration, /p\.created_by = p_app_actor/)
  assert.match(migration, /operator_proof := encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/)
  assert.match(migration, /make_interval\(mins => greatest\(5, least\(240/)
  assert.match(migration, /create or replace function public\.touch_pos_till_operator_proof\(payload jsonb\)/)
  assert.match(migration, /v_proof\.expires_at <= now\(\)/)
  assert.match(migration, /_pos_tab_active_waiter_error\(v_lodge, v_outlet, v_staff, v_shift\)/)
  assert.match(main, /const \{ operator_proof: _operatorProof, \.\.\.safeResult \} = result/)
  assert.match(main, /db\.touchSharedTillOperatorProof\(/)
  assert.match(read('src/main/domains/tillOperatorSession.js'), /const \{ operatorProof, \.\.\.publicSession \} = session/)
  assert.match(pos, /delete data\._operator_proof/)
  assert.match(pos, /operatorProof \? \{ \.\.\.v3Payload, _operator_proof: operatorProof \}/)
  const journalBody = pos.match(/const recordAttempt = \(rpcPayload\) => \{([\s\S]*?)\n    \};/)?.[1] || ''
  assert.doesNotMatch(journalBody, /_operator_proof/)
})

test('settlement ownership patch matches the live order contract without brittle ticket anchors', () => {
  assert.match(migration, /v_marker text := 'v_request_hash :='/)
  assert.match(migration, /v_claim_occurrences[\s\S]*_claim_financial_operation/)
  assert.match(migration, /declaration\/body boundary is missing/)
  assert.doesNotMatch(migration, /v_old text := \$old\$  v_tickets_created jsonb/)
  assert.doesNotMatch(migration, /v_call_old text := \$old\$  SELECT public\._claim_financial_operation/)
})

test('split and Till activation patch anchors match their latest predecessor contracts', () => {
  assert.equal((latestSplitContract.match(/v_source public\.pos_tabs%rowtype/g) || []).length, 1)
  assert.equal((latestSplitContract.match(/perform public\.app_require_lodge_role\(v_source\.lodge_id/g) || []).length, 1)
  assert.equal((latestTillActivationContract.match(/select to_jsonb\(p\) into v_open_result from public\.pos_shifts p where p\.id = v_pos_shift_id;/g) || []).length, 1)
  assert.match(migration, /split_pos_tab_evenly ownership declaration contract is ambiguous or missing/)
  assert.match(migration, /shared Till proof declaration contract is ambiguous or missing/)
})

test('desktop and Legacy bridge the same transfer RPC and fail closed offline', () => {
  assert.match(pos, /state\.supabase\.rpc\('transfer_pos_tab_waiter'/)
  assert.match(pos, /Bar waiter transfers require a live connection/)
  assert.match(main, /pos:transferTabWaiter/)
  assert.match(preload, /transferTabWaiter: \(data\) => invoke\('pos:transferTabWaiter'/)
  assert.match(legacyMain, /pos:transfer-tab-waiter/)
  assert.match(legacyMain, /Waiter transfers require a live connection/)
  assert.match(legacyMesh, /'transfer_pos_tab_waiter'/)
  assert.match(mesh, /'transfer_pos_tab_waiter'/)
  assert.match(mesh, /operator proofs may not be persisted or replayed through mesh/)
})

test('Bar Open Tabs exposes an explicit active-shift transfer workflow with stable retry key', () => {
  assert.match(checks, /Transfer waiter/)
  assert.match(checks, /getBarActiveShifts/)
  assert.match(checks, /getStaffOpenShift/)
  // Durable recovery lives in the shared helper; the component consumes it and
  // preserves the legacy tab-only key for migration reads.
  assert.match(checks, /posTabRecovery/)
  assert.match(checks, /readRecoveryEnvelope\("transfer"/)
  assert.match(checks, /Check status/)
  assert.match(checks, /Retry original/)
  const helper = read('src/shared/posTabRecovery.js')
  assert.match(helper, /hpos:pending-waiter-transfer:/)
  assert.match(helper, /hpos:pending-split:/)
  assert.match(checks, /target_waiter_id: target\.staff_user_id/)
})

test('offline tab settlement closes server-side without a second close call', () => {
  // The offline v3 sale settles (and closes) the tab atomically at replay,
  // so queuing a separate close would race into a spurious already-settled
  // dead-letter. The local row is marked closed-pending for display and a
  // dead-lettered replay reopens it visibly instead of losing the tab.
  assert.doesNotMatch(pos, /closePosTab\(data\.tab_id, 'closed', \{ _operator_proof: operatorProof \|\| null \}\)/)
  assert.match(pos, /_pending_settlement: true/)
  assert.match(pos, /pos-tab-\$\{data\.tab_id\}/)
})

test('atomic settlement rejects second payments and replays the stored result', () => {
  // P0: a new settlement against a tab that already has a completed/settled
  // order is rejected; an exact idempotent replay returns the stored
  // settled result before any tab mutation runs, so retries can neither
  // double-charge nor mint duplicate tabs. Historical duplicates are left
  // for audited void/refund reconciliation (never auto-deleted here).
  const atomic = read('supabase/migrations/20260905230000_pos_v3_atomic_tab_settlement.sql')
  const duplicateGuard = read('supabase/migrations/20260905231000_pos_v3_duplicate_settlement_guard.sql')
  const claimFirst = read('supabase/migrations/20260905233000_pos_v3_claim_first_tab_settlement.sql')
  assert.match(duplicateGuard, /o\.status in \('completed', ?'settled'\)/)
  assert.match(duplicateGuard, /'tab_already_settled'/)
  assert.match(atomic, /if v_tab_id is null/)
  assert.doesNotMatch(atomic, /delete from public\.pos_tabs/i)
  assert.doesNotMatch(atomic, /delete from public\.pos_orders/i)
  assert.doesNotMatch(duplicateGuard, /delete from public\.pos_tabs/i)
  assert.doesNotMatch(duplicateGuard, /delete from public\.pos_orders/i)
  assert.ok(
    claimFirst.indexOf('Remove the pre-claim tab lock') >= 0
    && claimFirst.indexOf('an exact retry returns its stored receipt') >= 0,
    'claim-first reorder must delete the pre-claim lock and re-add validation after replay'
  )
  assert.equal((atomic.match(/^commit;/gm) || []).length, 1, 'settlement must commit once: one transaction, no second phase')
  // Claim-first reorder: replay precedes every tab lock/validation, name
  // resolution is caller-opted-in, and a failed close rolls back instead of
  // committing a payment with a warning.
  assert.match(claimFirst, /an exact retry returns its stored receipt/)
  assert.match(claimFirst, /resolve_tab/)
  assert.match(claimFirst, /raise exception using errcode/)
  assert.match(claimFirst, /_operator_proof', v_tab_operator_proof/)
  assert.doesNotMatch(claimFirst, /delete from public\.pos_tabs/i)
  assert.doesNotMatch(claimFirst, /delete from public\.pos_orders/i)
})

test('tab settlement requires a version and keeps the lodge waiter', () => {
  // Every tab_id settlement must present a positive expected_tab_version;
  // resolve-or-create attributes non-Bar tabs to the validated payload
  // waiter while Bar scope keeps the proof-verified operator.
  const guard = read('supabase/migrations/20260905234000_pos_v3_tab_version_waiter.sql')
  assert.match(guard, /tab_version_required/)
  assert.match(guard, /This sale is missing its tab version/)
  assert.match(guard, /_pos_tab_is_bar_scope\(v_lodge_id\) then v_operator_id/)
  assert.match(guard, /coalesce\(nullif\(payload->>'waiter_id', ''\)::uuid, v_operator_id\)/)
  assert.doesNotMatch(guard, /delete from public\.pos_tabs/i)
  assert.doesNotMatch(guard, /delete from public\.pos_orders/i)
})

test('tab settlement validates the proof against the current payment shift', () => {
  // An open tab can outlive the shift that opened it. The historical tab
  // shift remains untouched; the assigned waiter must prove the current open
  // shift that receives the order and tender.
  assert.match(currentShiftSettlement, /v_payment_shift uuid := nullif\(p_payload->>'shift_id', ''\)::uuid/)
  assert.match(currentShiftSettlement, /_pos_operator_proof_staff\([\s\S]*v_payment_shift,[\s\S]*v_actor/)
  assert.match(currentShiftSettlement, /_pos_tab_active_waiter_error\([\s\S]*v_tab\.waiter_id,[\s\S]*v_payment_shift/)
  assert.doesNotMatch(currentShiftSettlement, /set\s+shift_id/i)
  assert.doesNotMatch(currentShiftSettlement, /delete from public\.pos_tabs/i)
  assert.doesNotMatch(currentShiftSettlement, /delete from public\.pos_orders/i)
})
