import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isCommercialFeatureIncluded } from '../src/shared/commercialAccess.js'
import { TILL_OPERATOR_MODES } from '../src/shared/tillOperatorPolicy.js'
import { createTillOperatorSessionStore } from '../src/main/domains/tillOperatorSession.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Till Shift restore reads the original lease without extending it', () => {
  let now = 100_000
  const store = createTillOperatorSessionStore({ clock: () => now })
  const created = store.create({
    webContentsId: 41,
    staffId: 'staff-41',
    staffName: 'Operator',
    outletId: 'outlet-41',
    shiftId: 'shift-41',
    mode: TILL_OPERATOR_MODES.SHIFT,
    inactivityMinutes: 5
  })
  now += 60_000
  const restored = store.authorize(41, {
    outletId: 'outlet-41',
    operatorId: 'staff-41',
    shiftId: 'shift-41',
    renew: false
  })
  assert.equal(restored.success, true)
  assert.equal(restored.session.expiresAt, created.expiresAt)
  now = created.expiresAt
  assert.equal(store.get(41), null)
})

test('Till activity renewal requires outlet, operator, and shift identity', () => {
  let now = 200_000
  const store = createTillOperatorSessionStore({ clock: () => now })
  store.create({ webContentsId: 42, staffId: 'staff-42', outletId: 'outlet-42', shiftId: 'shift-42', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 5 })
  now += 60_000
  assert.equal(store.touch(42, { outletId: 'outlet-42' }).success, false)
  assert.equal(store.get(42), null)
  store.create({ webContentsId: 43, staffId: 'staff-43', outletId: 'outlet-43', shiftId: 'shift-43', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 5 })
  const touched = store.touch(43, { outletId: 'outlet-43', operatorId: 'staff-43', shiftId: 'shift-43' })
  assert.equal(touched.success, true)
  assert.equal(touched.session.lastActivityAt, now)
})

test('Bar Base hides and rejects voucher/tip tenders while eligible add-ons remain available', () => {
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers'), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'tips_payouts'), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers', ['bar_growth_multi_outlet']), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'tips_payouts', ['bar_accounting_workforce']), true)
  assert.equal(isCommercialFeatureIncluded('restaurant-product', 'restaurant_growth', 'tips_payouts'), true)
})

test('desktop and Legacy POS enforce the same Base tender boundary before queueing', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const legacyTerminal = read('legacy-pos/src/renderer/src/screens/POSTerminal.jsx')
  const main = read('src/main/index.js')
  const domain = read('src/main/domains/pos.js')
  const legacyMain = read('legacy-pos/src/main/index.js')
  const migration = read('supabase/migrations/20260820190000_bar_base_till_tender_entitlement.sql')
  assert.match(terminal, /canUseVoucher/)
  assert.match(terminal, /canUseTips/)
  assert.match(terminal, /Voucher tender is not included/)
  assert.match(legacyTerminal, /canUseTips/)
  assert.match(legacyTerminal, /canUseTips && <div>/)
  assert.match(main, /enforceBarTenderEntitlements/)
  assert.match(main, /provisionalOfflineUnlock = result\.offline === true \|\| result\.provisional === true \|\| result\.queued === true/)
  assert.match(main, /getBarOfflineTabProofError/)
  assert.match(main, /Bar tabs require a live shared-Till operator proof/)
  assert.match(domain, /enforceBarBaseTenderBoundary/)
  assert.match(legacyMain, /enforceLegacyBarBaseTenderBoundary/)
  assert.match(domain, /if \(!hasVoucher && tip === 0\) return/)
  assert.match(main, /if \(!hasVoucher && tip === 0\) return/)
  assert.match(legacyMain, /if \(!hasVoucher && tip === 0\) return/)
  assert.match(migration, /^begin;/m)
  assert.match(migration, /^commit;/m)
  assert.match(migration, /pos_bar_tender_entitlement_error/)
  assert.match(migration, /create_pos_order\(jsonb\)/)
  assert.match(migration, /create_pos_order_v3\(jsonb\)/)
  assert.match(migration, /commercial_entitlement_blocked/)
  assert.match(migration, /v_decl_token text := 'v_payment_breakdown jsonb :='/)
  assert.match(migration, /v_guard_anchor := 'perform public\.app_require_lodge_role\(v_lodge_id,'/)
  assert.match(migration, /v_guard_anchor := 'if jsonb_typeof\(v_items\)'/)
  assert.match(migration, /Bar tender guard anchor is ambiguous or missing/)
  assert.match(migration, /revoke all on function public\.pos_bar_tender_entitlement_error\(uuid, jsonb\) from public;/)
  assert.match(migration, /grant execute on function public\.pos_bar_tender_entitlement_error\(uuid, jsonb\) to service_role;/)
  assert.doesNotMatch(migration, /grant execute on function public\.pos_bar_tender_entitlement_error\(uuid, jsonb\) to anon, authenticated/)
})

test('main Till restore and proven activity contracts are wired through IPC/preload', () => {
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(main, /pos:getSharedTillOperatorSession/)
  assert.match(main, /renew: false/)
  assert.match(main, /operatorId: data\?\.staff_id \|\| data\?\.staffId/)
  assert.match(main, /shiftId: data\?\.shift_id \|\| data\?\.shiftId/)
  assert.match(preload, /getSharedTillOperatorSession: \(data\) => invoke\('pos:getSharedTillOperatorSession', data\)/)
  assert.match(terminal, /getSharedTillOperatorSession/)
  assert.match(terminal, /staff_id: verifiedOperator\.id/)
  assert.match(terminal, /shift_id: currentShift\?\.id/)
})

test('provisional offline Till unlock remains usable for counter sales but not Bar tabs', () => {
  const main = read('src/main/index.js')
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(main, /const provisionalOfflineUnlock = result\.offline === true/)
  assert.match(main, /String\(data\?\.service_mode \|\| ''\)\.toLowerCase\(\) === 'tab'/)
  assert.match(main, /if \(tabProofError\) return tabProofError/)
  assert.match(terminal, /openTableSession/)
  assert.match(terminal, /servicePayload\.openSession/)
})

test('forward tender repair resolves replay before the Base entitlement guard', () => {
  const repair = read('supabase/migrations/20260821020000_bar_base_tender_replay_order.sql')
  const legacyOrder = read('supabase/migrations/20260612193000_legacy_pos_database_contract.sql')
  const catalogOrder = read('supabase/migrations/20260711120000_lodge_camp_release_blockers_repair.sql')

  assert.match(repair, /public\.create_pos_order\(jsonb\)/)
  assert.match(repair, /public\.create_pos_order_v3\(jsonb\)/)
  assert.match(repair, /v_guard_anchor := 'for v_item in select \* from jsonb_array_elements\(v_items\) loop'/)
  assert.match(repair, /v_guard_anchor := 'select s\.\*' \|\| E'\\n    into v_snapshot'/)
  assert.match(repair, /Replays\/conflicts therefore return first/)
  assert.match(repair, /rolls back the pending claim in the same transaction/)

  const legacyReplay = legacyOrder.indexOf('if v_create_idempotency_key is not null then')
  const legacyMutation = legacyOrder.indexOf('for v_item in select * from jsonb_array_elements(v_items) loop', legacyReplay)
  assert.ok(legacyReplay >= 0 && legacyMutation > legacyReplay)
  assert.equal((legacyOrder.match(/for v_item in select \* from jsonb_array_elements\(v_items\) loop/g) || []).length, 2)

  const claim = catalogOrder.indexOf('v_claim := public._claim_financial_operation(')
  const snapshot = catalogOrder.indexOf('select s.*', claim)
  assert.ok(claim >= 0 && snapshot > claim)
  assert.match(repair, /v_claim_financial_operation|pending claim/)
})
