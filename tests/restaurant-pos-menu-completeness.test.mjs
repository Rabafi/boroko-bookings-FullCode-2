// R8 menu completeness: the staff catalogue read must prove completeness
// through get_pos_menu_catalog_fingerprint_v1 before it may replace a
// catalogue that was already verified complete. These tests execute the real
// production read (_getPosMenuItems in pos.js) with scripted Supabase
// transport and real JSON/JSONL cache stores. They are not a substitute for
// the SQL fixtures that require Codex migration review.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptSupabase
} from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const pos = await importDomain('pos.js')
const cacheStore = await importDomain('cacheStore.js')

const LODGE = '11111111-1111-4111-8111-111111111111'

function isolate(t, rpc) {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('pos-menu-completeness')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE,
    currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    supabase: scriptSupabase(rpc),
    isOnline: true
  })
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return { cacheDir }
}

const menuRow = (index, overrides = {}) => ({
  id: `item-${String(index).padStart(4, '0')}`,
  lodge_id: LODGE,
  name: `Product ${index}`,
  category: 'Bar',
  price: 10,
  outlet_id: null,
  is_available: true,
  ...overrides
})

function scriptMenuServer({ rows, fingerprint }) {
  return async (name) => {
    if (name === 'get_pos_menu_items_for_staff_v1') return { data: rows, error: null }
    if (name === 'get_pos_menu_catalog_fingerprint_v1') {
      return typeof fingerprint === 'function' ? fingerprint() : { data: fingerprint, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  }
}

test('a 501-row complete catalogue verifies against the fingerprint and replaces the cache', async (t) => {
  const rows = Array.from({ length: 501 }, (_, index) => menuRow(index + 1))
  isolate(t, scriptMenuServer({
    rows,
    fingerprint: { success: true, lodge_id: LODGE, item_count: 501, outlet_scoped: false }
  }))

  const result = await pos.getPosMenuItems(null)

  assert.equal(result.length, 501)
  assert.equal(cacheStore.readCache('pos-menu-items').length, 501)
  const verification = cacheStore.readCache('pos-menu-verification')
  assert.equal(verification.outcome, 'verified')
  assert.equal(verification.item_count, 501)
  assert.equal(verification.source, 'fingerprint')
  assert.deepEqual(await pos.getPosMenuItems([]), [], 'an outlet filter with no access still returns nothing')
})

test('a partial read is refused and the verified catalogue is served unchanged', async (t) => {
  const verifiedRows = Array.from({ length: 450 }, (_, index) => menuRow(index + 1))
  isolate(t, scriptMenuServer({
    rows: Array.from({ length: 500 }, (_, index) => menuRow(index + 1)),
    fingerprint: { success: true, lodge_id: LODGE, item_count: 501, outlet_scoped: false }
  }))
  cacheStore.writeCache('pos-menu-items', verifiedRows)
  cacheStore.writeCache('pos-menu-verification', { schema: 1, outcome: 'verified', item_count: 450, lodge_id: LODGE })

  const result = await pos.getPosMenuItems(null)

  assert.equal(result.length, 450, 'the verified catalogue is served, not the partial read')
  assert.equal(cacheStore.readCache('pos-menu-items').length, 450, 'the partial read is never written')
  assert.equal(cacheStore.readCache('pos-menu-verification').item_count, 450, 'the verification record is untouched')
})

test('a partial read with no recoverable catalogue fails closed with an actionable code', async (t) => {
  isolate(t, scriptMenuServer({
    rows: Array.from({ length: 500 }, (_, index) => menuRow(index + 1)),
    fingerprint: { success: true, lodge_id: LODGE, item_count: 501, outlet_scoped: false }
  }))

  await assert.rejects(() => pos.getPosMenuItems(null), (error) => {
    assert.equal(error.code, 'pos_menu_read_incomplete')
    assert.match(error.message, /501/)
    assert.match(error.message, /500/)
    assert.match(error.message, /Reconnect and refresh before selling/)
    return true
  })
  assert.equal(cacheStore.readCache('pos-menu-items').length, 0, 'a partial read never seeds the cache')
  assert.deepEqual(cacheStore.readCache('pos-menu-verification'), [], 'no verification record is written for a refused read')
})

test('a legacy server without the fingerprint RPC still opens a fresh till unverified', async (t) => {
  isolate(t, scriptMenuServer({
    rows: Array.from({ length: 12 }, (_, index) => menuRow(index + 1)),
    fingerprint: () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.get_pos_menu_catalog_fingerprint_v1(p_lodge_id) in the schema cache'
      }
    })
  }))

  const result = await pos.getPosMenuItems(null)

  assert.equal(result.length, 12)
  assert.equal(cacheStore.readCache('pos-menu-items').length, 12)
  const verification = cacheStore.readCache('pos-menu-verification')
  assert.equal(verification.outcome, 'unverifiable')
  assert.equal(verification.source, 'legacy_server')
})

test('a legacy server read never replaces a verified catalogue', async (t) => {
  const verifiedRows = Array.from({ length: 800 }, (_, index) => menuRow(index + 1))
  isolate(t, scriptMenuServer({
    rows: Array.from({ length: 500 }, (_, index) => menuRow(index + 1)),
    fingerprint: () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.get_pos_menu_catalog_fingerprint_v1(p_lodge_id) in the schema cache'
      }
    })
  }))
  cacheStore.writeCache('pos-menu-items', verifiedRows)
  cacheStore.writeCache('pos-menu-verification', { schema: 1, outcome: 'verified', item_count: 800, lodge_id: LODGE })

  const result = await pos.getPosMenuItems(null)

  assert.equal(result.length, 800, 'the verified catalogue survives an unverifiable legacy read')
  assert.equal(cacheStore.readCache('pos-menu-items').length, 800)
})

test('a verified empty catalogue is a legitimate empty menu, also offline', async (t) => {
  isolate(t, scriptMenuServer({
    rows: [],
    fingerprint: { success: true, lodge_id: LODGE, item_count: 0, outlet_scoped: false }
  }))

  assert.deepEqual(await pos.getPosMenuItems(null), [])
  assert.equal(cacheStore.readCache('pos-menu-verification').outcome, 'verified')

  state.isOnline = false
  assert.deepEqual(await pos.getPosMenuItems(null), [], 'a verified empty menu is served offline instead of an error')
})

test('a transient read failure keeps the verified catalogue available', async (t) => {
  const verifiedRows = Array.from({ length: 30 }, (_, index) => menuRow(index + 1))
  isolate(t, async (name) => {
    if (name === 'get_pos_menu_items_for_staff_v1') throw new TypeError('fetch failed')
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-menu-items', verifiedRows)
  cacheStore.writeCache('pos-menu-verification', { schema: 1, outcome: 'verified', item_count: 30, lodge_id: LODGE })

  const result = await pos.getPosMenuItems(null)

  assert.equal(result.length, 30)
  assert.equal(cacheStore.readCache('pos-menu-verification').item_count, 30, 'the verification record survives the outage')
})

test('a capability refusal surfaces as unavailable, never as an empty menu', async (t) => {
  isolate(t, async (name) => {
    if (name === 'get_pos_menu_items_for_staff_v1') {
      return { data: null, error: { code: '42501', message: 'POS view capability is required.' } }
    }
    throw new Error(`unexpected RPC ${name}`)
  })

  await assert.rejects(() => pos.getPosMenuItems(null), (error) => {
    assert.match(error.message, /POS view capability is required/)
    assert.equal(error.code, 'pos_menu_read_unavailable')
    return true
  })
})
