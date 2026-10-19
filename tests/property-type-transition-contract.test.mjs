// LodgingOS property-type transition: desktop domain + ordinary-save guard.
// Pure behavioral tests (node:test). No live database is required; the SQL
// contract suite lives in property-type-transition-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import {
  importDomain,
  importState,
  makeTempCacheDir
} from './helpers/domain-test-setup.mjs'

const LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const KEY = '11111111-1111-4111-8111-111111111111'

async function freshState(overrides = {}) {
  const { state, resetState } = await importState()
  resetState()
  state.isOnline = true
  state.lodgeId = LODGE
  state.cacheDir = makeTempCacheDir('property-transition')
  Object.assign(state, overrides)
  return state
}

function rpcSupabase(handlers, extra = {}) {
  return {
    rpc: async (name, args) => {
      if (Object.prototype.hasOwnProperty.call(handlers, name)) {
        const value = typeof handlers[name] === 'function' ? await handlers[name](args) : handlers[name]
        return { data: value, error: null }
      }
      throw new Error(`unexpected RPC in test: ${name}`)
    },
    ...extra
  }
}

function tableSupabase() {
  // Minimal postgrest-style chain used by the settings save path.
  const terminal = (payload) => payload
  return {
    from: () => ({
      upsert: () => ({ select: () => ({ maybeSingle: async () => terminal({ data: {}, error: null }) }) }),
      update: () => ({ eq: () => ({ is: async () => terminal({ error: null }) }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => terminal({ data: null, error: null }) }) })
    })
  }
}

test('supported lodging types are exactly the five same-product types', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  assert.deepEqual([...transitions.SUPPORTED_LODGING_TYPES], ['guest_house', 'bnb', 'lodge', 'camp', 'motel'])
  assert.ok(Object.isFrozen(transitions.SUPPORTED_LODGING_TYPES))
})

test('same-family transitions are accepted in both directions (all 20 ordered pairs)', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const types = [...transitions.SUPPORTED_LODGING_TYPES]
  for (const from of types) {
    for (const to of types) {
      if (from === to) continue
      const state = await freshState()
      const seen = []
      state.supabase = rpcSupabase({
        preview_property_type_change: (args) => {
          seen.push(args)
          return { success: true, data: { current_type: from, target_type: to, expected_match: true } }
        }
      })
      const { writeCache } = await importDomain('infrastructure.js')
      writeCache('settings', [{ lodge_id: LODGE, property_type: from, business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])
      const result = await transitions.previewPropertyTypeChange(to)
      assert.equal(result?.data?.target_type, to, `${from} -> ${to}`)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].p_target_type, to)
      assert.equal(seen[0].p_lodge_id, LODGE)
    }
  }
})

test('cross-product targets are rejected client-side without contacting the server', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  for (const target of ['hotel', 'resort', 'restaurant', 'bar', 'pos_only', 'hostel', '']) {
    const state = await freshState()
    let rpcCalled = false
    state.supabase = rpcSupabase({}, {})
    state.supabase.rpc = async () => { rpcCalled = true; return { data: null, error: null } }
    await assert.rejects(() => transitions.previewPropertyTypeChange(target), /LodgingOS|Unknown target/)
    await assert.rejects(
      () => transitions.commitPropertyTypeChange({ targetType: target, idempotencyKey: KEY }),
      (error) => error?.code === 'cross_product_rejected'
    )
    assert.equal(rpcCalled, false, `no RPC for cross-product target ${target}`)
  }
})

test('unchanged target passes through to the server contract (audited no-op)', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  let seen = null
  state.supabase = {
    ...rpcSupabase({
      commit_property_type_change: (args) => {
        seen = args
        return { success: true, replayed: false, data: { previous_type: 'lodge', target_type: 'lodge', changed: false } }
      }
    }),
    ...tableSupabase()
  }
  const { writeCache } = await importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])
  const result = await transitions.commitPropertyTypeChange({ targetType: 'lodge', idempotencyKey: KEY })
  assert.equal(result?.data?.changed, false)
  assert.equal(seen.p_target_type, 'lodge')
  assert.equal(seen.p_idempotency_key, KEY)
})

test('transitions are online-only and never queued', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState({ isOnline: false })
  let rpcCalled = false
  state.supabase = { rpc: async () => { rpcCalled = true; return { data: null, error: null } } }
  for (const call of [
    () => transitions.previewPropertyTypeChange('camp'),
    () => transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: KEY }),
    () => transitions.getPropertyTypeTransitionStatus(KEY)
  ]) {
    await assert.rejects(call, (error) => error?.code === 'property_transition_offline')
  }
  assert.equal(rpcCalled, false)
})

test('commit and status require a stable UUID key from the caller', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  state.supabase = rpcSupabase({})
  await assert.rejects(
    () => transitions.commitPropertyTypeChange({ targetType: 'camp' }),
    (error) => error?.code === 'property_transition_key_required'
  )
  await assert.rejects(
    () => transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: 'not-a-uuid' }),
    (error) => error?.code === 'property_transition_key_required'
  )
  await assert.rejects(
    () => transitions.getPropertyTypeTransitionStatus(''),
    (error) => error?.code === 'property_transition_key_required'
  )
})

test('retry after an ambiguous timeout reuses the identical key (never a new one)', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  const keys = []
  let attempts = 0
  state.supabase = {
    rpc: async (name, args) => {
      assert.equal(name, 'commit_property_type_change')
      attempts += 1
      keys.push(args.p_idempotency_key)
      if (attempts === 1) {
        const timeout = new Error('socket hang up')
        timeout.code = 'ETIMEDOUT'
        throw timeout
      }
      return { data: { success: true, replayed: true, data: { previous_type: 'lodge', target_type: 'camp', changed: true } }, error: null }
    },
    ...tableSupabase()
  }
  const { writeCache } = await importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])
  await assert.rejects(
    () => transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: KEY }),
    /socket hang up/
  )
  const retry = await transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: KEY })
  assert.equal(retry?.replayed, true)
  assert.deepEqual(keys, [KEY, KEY])
})

test('timeout recovery reads the authoritative stored result via the status RPC', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  state.supabase = rpcSupabase({
    get_property_type_transition_status: (args) => {
      assert.equal(args.p_idempotency_key, KEY)
      assert.equal(args.p_lodge_id, LODGE)
      return { success: true, lodge_id: LODGE, idempotency_key: KEY, data: { previous_type: 'lodge', target_type: 'camp', changed: true } }
    }
  })
  const status = await transitions.getPropertyTypeTransitionStatus(KEY)
  assert.equal(status?.data?.target_type, 'camp')
})

test('exact replay attaches a truthful refresh result and never depends on it', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  let settingsReads = 0
  state.supabase = {
    rpc: async () => ({ data: { success: true, replayed: true, data: { previous_type: 'lodge', target_type: 'camp', changed: true } }, error: null }),
    from: () => {
      settingsReads += 1
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { message: 'access denied' } }) }
      return chain
    }
  }
  const { writeCache } = await importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])
  const result = await transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: KEY })
  assert.equal(result?.replayed, true)
  // R5: replay recovery reconciles canonical settings too; a resolved error
  // is reported truthfully and never fails the authoritative replay.
  assert.equal(settingsReads > 0, true)
  assert.equal(result?.refresh?.ok, false)
  assert.equal(result?.refresh?.reason, 'rpc-error')
})

test('mismatched-payload key reuse maps uniqueness violations to a stable code', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  state.supabase = {
    rpc: async () => ({ data: null, error: { message: 'Idempotency key already used for a different property-type operation', code: '23505' } }),
    ...tableSupabase()
  }
  const { writeCache } = await importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])
  await assert.rejects(
    () => transitions.commitPropertyTypeChange({ targetType: 'bnb', idempotencyKey: KEY }),
    (error) => error?.code === 'idempotency_key_reuse_mismatch'
  )
})

test('server denials surface with their codes (capability, lodge scope, stale state)', async () => {
  const transitions = await importDomain('propertyTransitions.js')
  const state = await freshState()
  const { writeCache } = await importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: LODGE, property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])

  state.supabase = rpcSupabase({ preview_property_type_change: { success: false, code: 'CAPABILITY_DENIED', error: 'Only a lodge administrator can preview.' } })
  await assert.rejects(() => transitions.previewPropertyTypeChange('camp'), (error) => error?.code === 'CAPABILITY_DENIED')

  state.supabase = rpcSupabase({ preview_property_type_change: { success: false, code: 'LODGE_SCOPE_DENIED', error: 'Access denied for this lodge.' } })
  await assert.rejects(() => transitions.previewPropertyTypeChange('camp'), (error) => error?.code === 'LODGE_SCOPE_DENIED')

  state.supabase = {
    rpc: async () => ({ data: { success: false, code: 'expected_state_conflict', error: 'The company settings changed since the preview.' }, error: null }),
    ...tableSupabase()
  }
  await assert.rejects(
    () => transitions.commitPropertyTypeChange({ targetType: 'camp', idempotencyKey: KEY }),
    (error) => error?.code === 'expected_state_conflict'
  )

  state.supabase = rpcSupabase({ get_property_type_transition_status: { success: false, code: 'NOT_FOUND', error: 'No transition recorded.' } })
  await assert.rejects(() => transitions.getPropertyTypeTransitionStatus(KEY), (error) => error?.code === 'NOT_FOUND')
})

test('ordinary settings save rejects a post-setup reclassification (identical values still save)', async () => {
  const settings = await importDomain('settings.js')
  const { writeCache } = await importDomain('infrastructure.js')
  const state = await freshState()
  state.supabase = { ...rpcSupabase({}), ...tableSupabase() }
  writeCache('settings', [{ lodge_id: LODGE, lodge_name: 'Test', property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])

  await assert.rejects(
    () => settings.saveSettings({ lodge_name: 'Test', property_type: 'camp' }),
    (error) => error?.code === 'property_transition_required'
  )
  await assert.rejects(
    () => settings.saveSettings({ lodge_name: 'Test', business_type: 'restaurant' }),
    (error) => error?.code === 'property_transition_required'
  )

  const unchanged = await settings.saveSettings({ lodge_name: 'Test', property_type: 'lodge' })
  assert.equal(unchanged?.property_type || unchanged?.data?.property_type, 'lodge')
})

test('operating-profile updates refuse a smuggled property_type change', async () => {
  const settings = await importDomain('settings.js')
  const { writeCache } = await importDomain('infrastructure.js')
  const state = await freshState()
  state.supabase = { ...rpcSupabase({}), ...tableSupabase() }
  writeCache('settings', [{ lodge_id: LODGE, lodge_name: 'Test', property_type: 'lodge', business_type: 'lodge', setup_complete: true, updated_at: '2026-10-01T00:00:00.000Z', operating_profile: {} }])

  await assert.rejects(
    () => settings.updateOperatingProfile({ property_type: 'motel' }),
    (error) => error?.code === 'property_transition_required'
  )

  const kept = await settings.updateOperatingProfile({ hospitality_mode: 'restaurant_bar' })
  assert.ok(kept && typeof kept === 'object')
})

test('pre-setup saves may still establish the property type (bootstrap path unaffected)', async () => {
  const settings = await importDomain('settings.js')
  const { writeCache } = await importDomain('infrastructure.js')
  const state = await freshState()
  state.supabase = { ...rpcSupabase({}), ...tableSupabase() }
  writeCache('settings', [{ lodge_id: LODGE, lodge_name: 'Draft', property_type: 'lodge', business_type: 'lodge', setup_complete: false, operating_profile: {} }])
  const saved = await settings.saveSettings({ lodge_name: 'Draft', property_type: 'camp' })
  assert.equal(saved?.property_type || saved?.data?.property_type, 'camp')
})

test('preload exposes preview/commit/status settings passthroughs', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8')
  assert.match(source, /previewPropertyTypeChange: \(targetType\) => invoke\('settings:previewPropertyTypeChange', targetType\)/)
  assert.match(source, /commitPropertyTypeChange: \(payload\) => invoke\('settings:commitPropertyTypeChange', payload\)/)
  assert.match(source, /getPropertyTypeTransitionStatus: \(idempotencyKey\) => invoke\('settings:getPropertyTypeTransitionStatus', idempotencyKey\)/)
  const facade = readFileSync(new URL('../src/main/database.js', import.meta.url), 'utf8')
  assert.match(facade, /previewPropertyTypeChange,\s*commitPropertyTypeChange,\s*getPropertyTypeTransitionStatus/s)
  assert.match(facade, /SUPPORTED_LODGING_TYPES/)
})

test('migration declares the transition ledger, RPCs, grants and row lock', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../supabase/migrations/20261014010000_property_type_transitions.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.property_type_transitions/)
  assert.match(sql, /constraint property_type_transitions_pkey primary key \(lodge_id, idempotency_key\)/)
  assert.match(sql, /preview_property_type_change\(uuid, text, text, timestamptz\)/)
  assert.match(sql, /commit_property_type_change\(uuid, text, text, timestamptz, text, text\)/)
  assert.match(sql, /get_property_type_transition_status\(uuid, text\)/)
  assert.match(sql, /from public\.settings where lodge_id = v_lodge for update/i)
  assert.match(sql, /grant execute on function public\.preview_property_type_change[^;]+to anon, authenticated, service_role/)
  assert.match(sql, /grant execute on function public\.commit_property_type_change[^;]+to anon, authenticated, service_role/)
  assert.match(sql, /grant execute on function public\.get_property_type_transition_status[^;]+to anon, authenticated, service_role/)
  assert.match(sql, /using errcode = '23505'/)
  assert.match(sql, /cross_product_rejected/)
  assert.match(sql, /expected_state_conflict/)
  // No financial writes anywhere in the contract: the only UPDATE target is
  // public.settings, and the preserved[] list names amount_paid/payment_status
  // as explicitly preserved (never authored) fields.
  assert.doesNotMatch(sql, /update public\.bookings/i)
  assert.doesNotMatch(sql, /update public\.\w*ledger/i)
  assert.doesNotMatch(sql, /update public\.\w*journal/i)
  assert.doesNotMatch(sql, /amount_paid\s*=/)
  assert.doesNotMatch(sql, /payment_status\s*=/)
  assert.match(sql, /'amount_paid', 'payment_status'/, 'preserved list names the never-authored totals')
  // Service role is a grantee, never exposed to the renderer.
  assert.doesNotMatch(sql, /service_role.*preload|preload.*service_role/)
})

test('transition key space is UUID-shaped (renderer-generated stable keys)', () => {
  assert.ok(randomUUID() !== randomUUID(), 'sanity: UUID generator yields distinct keys')
  assert.match(KEY, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})
