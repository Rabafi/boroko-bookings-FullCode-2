// WP D submit deadline + late-completion fence: a sale submit that never
// answers must fail with an honest, recoverable error while the journal stays
// pending under the original operation key, and a late completion must never
// run the success path after the deadline won. These tests execute the real
// production createPosOrder with scripted Supabase transport and real
// JSON/JSONL stores.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptSupabase
} from './helpers/domain-test-setup.mjs'

// connectivity.js reads its base URL at module load; give it a loopback base
// so any connectivity probe fails fast and deterministically (never hangs).
globalThis.__TEST_VITE_ENV__.VITE_SUPABASE_URL = 'http://127.0.0.1:1'
globalThis.__TEST_VITE_ENV__.VITE_SUPABASE_ANON_KEY = 'test-anon-key'

const { state } = await importState()
const pos = await importDomain('pos.js')
const journal = await importDomain('posSubmitJournal.js')
const cacheStore = await importDomain('cacheStore.js')
const entitlements = await importDomain('entitlements.js')

const LODGE = '11111111-1111-4111-8111-111111111111'
const SHIFT = '44444444-4444-4444-8444-444444444444'
const CASHIER = '66666666-6666-4666-8666-666666666666'
const SNAPSHOT = '77777777-7777-4777-8777-777777777777'
const INTENT = 'intent-submit-deadline'

const ENTITLEMENT = {
  lodge_id: LODGE,
  status: 'licensed',
  subscription_state: 'active',
  plan: 'Pro',
  product_id: 'hospitality-pos',
  commercial_package_key: 'bar_pos',
  offline_valid_until: '2035-01-01T00:00:00.000Z'
}

async function isolate(t, rpc) {
  const keys = [
    'cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'posSubmitDeadlineMs'
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('bar-submit-deadline')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE,
    currentUser: { id: CASHIER, role: 'cashier' },
    supabase: scriptSupabase(async (name, args) => {
      if (name === 'get_lodge_entitlement') return { data: { ...ENTITLEMENT }, error: null }
      return rpc(name, args)
    }),
    isOnline: true,
    posSubmitDeadlineMs: 40
  })
  cacheStore.writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge' }])
  // Prime the entitlement cache through the authoritative RPC so the sale
  // gate sees a live active licence without any connectivity probe.
  await entitlements.getAuthoritativeTrialStatus(LODGE)
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
}

const saleData = () => ({
  id: INTENT,
  submit_intent_id: INTENT,
  shift_id: SHIFT,
  catalog_snapshot_id: SNAPSHOT,
  cashier_id: CASHIER,
  payment_method: 'cash',
  payment_breakdown: [{ method: 'cash', amount: 20 }],
  items: [{ menu_item_id: 'm-1', item_name: 'Stout', quantity: 1, unit_price: 20 }],
  total: 20
})

test('a submit that never answers times out into an honest retained-journal state', async (t) => {
  await isolate(t, async (name) => {
    if (name === 'create_pos_order_v3') return new Promise(() => {})
    throw new Error(`unexpected RPC ${name}`)
  })

  await assert.rejects(() => pos.createPosOrder(saleData()), (error) => {
    assert.equal(error.code, 'pos_submit_timeout')
    assert.match(error.message, /saved on this till/)
    assert.match(error.message, /same receipt/)
    assert.match(error.message, /Do not start a new sale/)
    return true
  })

  assert.equal(journal.hasPosSubmitAttempt(INTENT), true, 'the journalled envelope survives the timeout')
  const pending = journal.getPendingPosSubmitAttempt({ lodgeId: LODGE, userId: CASHIER })
  assert.equal(pending?.submitIntentId, INTENT, 'the sale stays visible for reconciliation')
  assert.equal(pending?.status, 'pending')
  assert.deepEqual(cacheStore.readCache('pos-audit-log'), [], 'no completion was ever recorded for the unanswered submit')
})

test('a late completion after the deadline is fenced out of the success path', async (t) => {
  let resolveLate
  await isolate(t, async (name) => {
    if (name === 'create_pos_order_v3') {
      return new Promise((resolve) => {
        resolveLate = () => resolve({ data: { success: true, id: INTENT, total: 20, receipt_number: 'R-9' }, error: null })
      })
    }
    throw new Error(`unexpected RPC ${name}`)
  })

  await assert.rejects(() => pos.createPosOrder(saleData()), (error) => error.code === 'pos_submit_timeout')
  assert.equal(journal.hasPosSubmitAttempt(INTENT), true)

  resolveLate()
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(journal.hasPosSubmitAttempt(INTENT), true, 'the late success never commits the journal')
  assert.equal(
    journal.getPendingPosSubmitAttempt({ lodgeId: LODGE, userId: CASHIER })?.status,
    'pending',
    'the attempt remains pending for the same-key reconciliation'
  )
  assert.deepEqual(cacheStore.readCache('pos-audit-log'), [], 'the late completion must not write completion effects')
  assert.deepEqual(cacheStore.readCache('pos-tickets'), [], 'the late completion must not publish tickets')
})
