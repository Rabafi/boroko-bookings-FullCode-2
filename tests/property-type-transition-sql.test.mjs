// LodgingOS property-type transition: SQL contract on the disposable database.
// Applies supabase/migrations/20261014010000_property_type_transitions.sql and
// exercises preview/commit/status end to end with real app sessions.
// Skips cleanly (exit 0) when LUNA_REMEDIATION_* disposable credentials are
// absent. Never touches production: the luna helper denies the linked project.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  connectVerifiedDisposableDatabase,
  DisposableDatabaseBlocked
} from './helpers/luna-disposable-database.mjs'

let connected = null
let blocked = null
try {
  connected = await connectVerifiedDisposableDatabase()
} catch (error) {
  if (error instanceof DisposableDatabaseBlocked) blocked = error
  else throw error
}

if (blocked || !connected) {
  test('property-type transition SQL contract (no disposable database)', {
    skip: 'LUNA_REMEDIATION_TEST_DB_URL absent: ' + (blocked?.message || 'no disposable database connection')
  }, () => {})
} else {
  const db = connected.client
  const MIGRATION_SQL = readFileSync(new URL('../supabase/migrations/20261014010000_property_type_transitions.sql', import.meta.url), 'utf8')
  const FOLLOW_UP_SQL = readFileSync(new URL('../supabase/migrations/20261014020000_property_type_transition_lodge_scope_deny.sql', import.meta.url), 'utf8')

  const lodge = randomUUID()
  const otherLodge = randomUUID()
  const adminId = randomUUID()
  const cashierId = randomUUID()
  const adminToken = 'pt-admin-' + randomUUID()
  const cashierToken = 'pt-cashier-' + randomUUID()
  const keyCommit = randomUUID()
  const keyNoop = randomUUID()
  const keyMismatch = randomUUID()

  const call = async (text, params = []) => (await db.query(`select ${text} as result`, params)).rows[0].result

  async function asSession(token) {
    await db.query('begin')
    await db.query('set local role anon')
    await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [token])
  }
  async function endSession() {
    await db.query('rollback').catch(() => {})
  }

  // Apply the migration under the privileged fixture connection, then build
  // synthetic fixtures (committed; removed in the after() hook).
  // Apply the base contract then the forward lodge-scope fix in deployment
  // order, then build synthetic fixtures (committed; removed in after()).
  await db.query(MIGRATION_SQL)
  await db.query(FOLLOW_UP_SQL)
  await db.query(
    `insert into public.settings(lodge_id, lodge_name, company_name, business_type, property_type, setup_complete, operating_profile)
     values ($1, 'Transition Test Lodge', 'Transition Test Co', 'lodge', 'lodge', true,
       '{"hospitality_mode":"restaurant_bar","custom_choice":"keep-me","accommodation_mix":{"rooms_or_units":true}}'::jsonb)`,
    [lodge]
  )
  await db.query(
    `insert into public.users(id, lodge_id, name, email, role, password_hash, status)
     values ($1, $2, 'pt-admin', $3, 'admin', 'not-a-login-hash', 'active'),
            ($4, $2, 'pt-cashier', $5, 'cashier', 'not-a-login-hash', 'active')`,
    [adminId, lodge, `${adminId}@example.invalid`, cashierId, `${cashierId}@example.invalid`]
  )
  await db.query(
    `insert into public.app_sessions(token_hash, session_type, user_id, lodge_id, role, expires_at)
     values (public.app_hash_token($1), 'desktop', $2::uuid, $3::uuid, 'admin', now() + interval '20 minutes'),
            (public.app_hash_token($4), 'desktop', $5::uuid, $3::uuid, 'cashier', now() + interval '20 minutes')`,
    [adminToken, adminId, lodge, cashierToken, cashierId]
  )
  const settingsBefore = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
  const countTable = async (name) => {
    const reg = (await db.query('select to_regclass($1) as r', ['public.' + name])).rows[0].r
    if (!reg) return null
    return Number((await db.query(`select count(*)::integer as c from public.${name} where lodge_id = $1`, [lodge])).rows[0].c)
  }
  const roomsBefore = await countTable('rooms')
  const bookingsBefore = await countTable('bookings')
  const paymentsBefore = await countTable('payments')

  after(async () => {
    await db.query('delete from public.property_type_transitions where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.app_sessions where lodge_id = $1 and user_id = any($2::uuid[])', [lodge, [adminId, cashierId]]).catch(() => {})
    await db.query('delete from public.users where id = any($1::uuid[])', [[adminId, cashierId]]).catch(() => {})
    await db.query('delete from public.settings where lodge_id = $1', [lodge]).catch(() => {})
    await db.end().catch(() => {})
  })

  test('preview returns the specified advisory shape', async () => {
    await asSession(adminToken)
    try {
      const preview = await call(
        'public.preview_property_type_change($1, $2, $3, $4::timestamptz)',
        [lodge, 'camp', 'lodge', settingsBefore.updated_at]
      )
      assert.equal(preview.success, true)
      assert.equal(preview.data.current_type, 'lodge')
      assert.equal(preview.data.target_type, 'camp')
      assert.equal(preview.data.expected_match, true)
      assert.equal(preview.data.wording.from_label, 'Lodge')
      assert.equal(preview.data.wording.to_label, 'Camp / Campsite')
      assert.ok(preview.data.wording.unit_label_from)
      assert.ok(preview.data.wording.unit_label_to)
      assert.ok(preview.data.wording.exclusive_use_from)
      assert.ok(preview.data.wording.exclusive_use_to)
      assert.ok(Array.isArray(preview.data.navigation.notes) && preview.data.navigation.notes.length > 0)
      assert.ok(Array.isArray(preview.data.blockers))
      assert.ok(Number.isInteger(preview.data.accommodation_mix.rooms))
      assert.ok(Number.isInteger(preview.data.accommodation_mix.sites))
      assert.equal(typeof preview.data.accommodation_mix.mixed, 'boolean')
      assert.ok(preview.data.preserved.includes('bookings'))
      assert.ok(preview.data.preserved.includes('ledgers'))
    } finally {
      await endSession()
    }
  })

  test('preview/commit reject cross-product targets', async () => {
    await asSession(adminToken)
    try {
      for (const target of ['hotel', 'resort', 'restaurant', 'bar', 'pos_only']) {
        const preview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, target])
        assert.equal(preview.success, false, `preview ${target}`)
        assert.equal(preview.code, 'cross_product_rejected', `preview ${target}`)
        const commit = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [lodge, target, randomUUID()])
        assert.equal(commit.success, false, `commit ${target}`)
        assert.equal(commit.code, 'cross_product_rejected', `commit ${target}`)
      }
    } finally {
      await endSession()
    }
  })

  test('unauthorized actor and wrong lodge fail closed', async () => {
    await asSession(cashierToken)
    try {
      const denied = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
      assert.equal(denied.success, false)
      assert.equal(denied.code, 'CAPABILITY_DENIED')
    } finally {
      await endSession()
    }
    await db.query('begin')
    await db.query('set local role anon')
    await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token','',true)")
    try {
      const anon = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
      assert.equal(anon.success, false)
      assert.equal(anon.code, 'UNAUTHENTICATED')
    } finally {
      await endSession()
    }
    await asSession(adminToken)
    try {
      const wrong = await call('public.preview_property_type_change($1, $2, null, null)', [otherLodge, 'camp'])
      assert.equal(wrong.success, false)
      assert.equal(wrong.code, 'LODGE_SCOPE_DENIED')
    } finally {
      await endSession()
    }
  })

  test('stale expected state is rejected', async () => {
    await asSession(adminToken)
    try {
      const staleType = await call('public.commit_property_type_change($1, $2, $3, null, $4, null)', [lodge, 'camp', 'motel', randomUUID()])
      assert.equal(staleType.success, false)
      assert.equal(staleType.code, 'expected_state_conflict')
      const staleTime = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, null)', [lodge, 'camp', 'lodge', '2001-01-01T00:00:00.000Z', randomUUID()])
      assert.equal(staleTime.success, false)
      assert.equal(staleTime.code, 'expected_state_conflict')
    } finally {
      await endSession()
    }
  })

  test('commit reclassifies narrowly, preserves profile choices, and replays exactly', async () => {
    await asSession(adminToken)
    try {
      const first = await call(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', 'lodge', settingsBefore.updated_at, keyCommit, 'campsite operations']
      )
      assert.equal(first.success, true)
      assert.equal(first.replayed, false)
      assert.equal(first.data.previous_type, 'lodge')
      assert.equal(first.data.target_type, 'camp')
      assert.equal(first.data.changed, true)

      const row = (await db.query('select property_type, business_type, operating_profile, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      assert.equal(row.property_type, 'camp')
      assert.equal(row.business_type, 'lodge')
      assert.equal(row.operating_profile.hospitality_mode, 'restaurant_bar')
      assert.equal(row.operating_profile.custom_choice, 'keep-me')
      assert.equal(row.operating_profile.accommodation_mix.rooms_or_units, true)
      assert.equal(row.operating_profile.campsite_profile.enabled, true)

      const replay = await call(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', 'lodge', settingsBefore.updated_at, keyCommit, 'campsite operations']
      )
      assert.equal(replay.success, true)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, first.data)

      const status = await call('public.get_property_type_transition_status($1, $2)', [lodge, keyCommit])
      assert.equal(status.success, true)
      assert.deepEqual(status.data, first.data)

      const missing = await call('public.get_property_type_transition_status($1, $2)', [lodge, randomUUID()])
      assert.equal(missing.success, false)
      assert.equal(missing.code, 'NOT_FOUND')
    } finally {
      await endSession()
    }
  })

  test('mismatched-payload key reuse raises 23505', async () => {
    await asSession(adminToken)
    try {
      const first = await call('public.commit_property_type_change($1, $2, null, null, $3, $4)', [lodge, 'motel', keyMismatch, 'first intent'])
      assert.equal(first.success, true)
      await assert.rejects(
        call('public.commit_property_type_change($1, $2, null, null, $3, $4)', [lodge, 'bnb', keyMismatch, 'different intent']),
        (error) => error?.code === '23505'
      )
    } finally {
      await endSession()
    }
  })

  test('unchanged target commits as an audited no-op without rewriting settings', async () => {
    await asSession(adminToken)
    try {
      const current = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      const noop = await call(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, null)',
        [lodge, current.property_type, current.property_type, current.updated_at, keyNoop]
      )
      assert.equal(noop.success, true)
      assert.equal(noop.data.changed, false)
      const afterRow = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      assert.equal(afterRow.property_type, current.property_type)
      assert.deepEqual(new Date(afterRow.updated_at).toISOString(), new Date(current.updated_at).toISOString())
    } finally {
      await endSession()
    }
  })

  test('wrong-lodge commit and status fail closed without writing', async () => {
    await asSession(adminToken)
    try {
      const deniedCommit = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [otherLodge, 'camp', randomUUID()])
      assert.equal(deniedCommit.success, false)
      assert.equal(deniedCommit.code, 'LODGE_SCOPE_DENIED')
      const deniedStatus = await call('public.get_property_type_transition_status($1, $2)', [otherLodge, keyCommit])
      assert.equal(deniedStatus.success, false)
      assert.equal(deniedStatus.code, 'LODGE_SCOPE_DENIED')
      const foreignRows = Number((await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [otherLodge])).rows[0].c)
      assert.equal(foreignRows, 0)
    } finally {
      await endSession()
    }
  })

  test('preview matrix covers every supported target without writing', async () => {
    await asSession(adminToken)
    try {
      const before = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      const transitionsBefore = Number((await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [lodge])).rows[0].c)
      for (const target of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
        const preview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, target])
        assert.equal(preview.success, true, `preview ${target}`)
        assert.equal(preview.data.target_type, target, `preview ${target}`)
        assert.deepEqual(preview.data.blockers, [], `preview ${target} blockers`)
        assert.ok(preview.data.preserved.includes('bookings'), `preview ${target}`)
        assert.ok(preview.data.preserved.includes('ledgers'), `preview ${target}`)
      }
      const after = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      assert.equal(after.property_type, before.property_type)
      assert.deepEqual(new Date(after.updated_at).toISOString(), new Date(before.updated_at).toISOString())
      const transitionsAfter = Number((await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [lodge])).rows[0].c)
      assert.equal(transitionsAfter, transitionsBefore)
    } finally {
      await endSession()
    }
  })

  test('commit chain visits every supported type and preserves profile choices', async () => {
    await asSession(adminToken)
    try {
      for (const target of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
        const current = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
        if (current.property_type === target) continue
        const committed = await call(
          'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
          [lodge, target, current.property_type, current.updated_at, randomUUID(), 'matrix verification']
        )
        assert.equal(committed.success, true, `commit ${target}`)
        assert.equal(committed.replayed, false, `commit ${target}`)
        assert.equal(committed.data.previous_type, current.property_type, `commit ${target}`)
        assert.equal(committed.data.target_type, target, `commit ${target}`)
        assert.equal(committed.data.changed, true, `commit ${target}`)
        const row = (await db.query('select property_type, business_type, operating_profile from public.settings where lodge_id = $1', [lodge])).rows[0]
        assert.equal(row.property_type, target, `commit ${target}`)
        assert.equal(row.business_type, 'lodge', `commit ${target}`)
        assert.equal(row.operating_profile.hospitality_mode, 'restaurant_bar', `commit ${target}`)
        assert.equal(row.operating_profile.custom_choice, 'keep-me', `commit ${target}`)
      }
      const finalRow = (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
      assert.equal(finalRow.property_type, 'motel')
    } finally {
      await endSession()
    }
  })

  test('inventory, booking and ledger counts are untouched by the transition', async () => {
    assert.equal(await countTable('rooms'), roomsBefore)
    assert.equal(await countTable('bookings'), bookingsBefore)
    assert.equal(await countTable('payments'), paymentsBefore)
  })

  // ── Forward corrections (20261014040000 + 20261014050000) ────────────────
  // Applied here, after every pre-existing scenario above has run under the
  // base contract, so the earlier assertions keep their original semantics.
  // The thorough R1/R2/R3 matrix lives in
  // tests/property-transition-receipt-sql.test.mjs; these scenarios pin the
  // headline behaviors onto this suite's fixtures.
  test('forward corrections apply: receipt-first, family helper, guard trigger', async () => {
    await db.query(readFileSync(new URL('../supabase/migrations/20261014040000_property_transition_receipt_first.sql', import.meta.url), 'utf8'))
    await db.query(readFileSync(new URL('../supabase/migrations/20261014050000_settings_classification_guard.sql', import.meta.url), 'utf8'))
    const fns = (await db.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname in ('_property_transition_family', '_property_transition_guard_classification')`
    )).rows.map((row) => row.proname).sort()
    assert.deepEqual(fns, ['_property_transition_family', '_property_transition_guard_classification'])
    const trigger = (await db.query(
      `select tgname from pg_trigger where tgname = 'settings_property_transition_guard'`
    )).rows
    assert.equal(trigger.length, 1)
  })

  test('receipt-first replay survives an unrelated settings touch', async () => {
    const key = randomUUID()
    // First commit in its own transaction and COMMIT it so the receipt is
    // durable; the later replay must resolve from that receipt even though
    // an unrelated settings touch moves updated_at afterwards.
    await db.query('begin')
    await db.query('set local role anon')
    await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [adminToken])
    let first
    let before
    try {
      before = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      first = await call(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'bnb', before.property_type, before.updated_at, key, 'suite replay']
      )
      assert.equal(first.success, true)
      await db.query('commit')
    } catch (error) {
      await db.query('rollback').catch(() => {})
      throw error
    }
    await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Touched Lodge'])
    await asSession(adminToken)
    try {
      const replay = await call(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'bnb', before.property_type, before.updated_at, key, 'suite replay']
      )
      assert.equal(replay.success, true)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, first.data)
    } finally {
      await endSession()
    }
  })

  test('null expectations are rejected on new keys and preview', async () => {
    await asSession(adminToken)
    try {
      const commit = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [lodge, 'camp', randomUUID()])
      assert.equal(commit.success, false)
      assert.equal(commit.code, 'VALIDATION_FAILED')
      assert.match(String(commit.error || ''), /expectations_required/)
      const preview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
      assert.equal(preview.success, false)
      assert.equal(preview.code, 'expectations_required')
    } finally {
      await endSession()
    }
  })

  test('classification guard rejects a stale ordinary revert', async () => {
    await asSession(adminToken)
    try {
      const current = (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
      const staleType = current.property_type === 'camp' ? 'lodge' : 'camp'
      await assert.rejects(
        db.query('update public.settings set lodge_name = $2, property_type = $3 where lodge_id = $1', [lodge, 'Stale', staleType]),
        (error) => /classification_locked/.test(String(error?.message || ''))
      )
      const still = (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
      assert.equal(still.property_type, current.property_type)
      await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Transition Test Lodge'])
    } finally {
      await endSession()
    }
  })
}
