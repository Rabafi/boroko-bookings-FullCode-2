// LodgingOS property-type transition: R1/R2/R3 SQL contract on the disposable database.
//
// Applies, in order, 20261014010000 + 20261014020000 + 20261014030000 +
// 20261014040000 (receipt-first + source family) + 20261014050000
// (classification guard) + 20261014060000 (campsite-priced tent kind) and
// exercises the forward-correction contract end to end with real app
// sessions: exact replay incl. replay after an unrelated settings touch,
// mismatched-payload 23505, concurrent same-key commits, unsupported-source
// rejection (commit + preview), expectations_required (commit +
// preview), historical replay without source re-check or mutation, and the
// server classification guard (stale revert rejected, direct bypass
// rejected, legitimate unrelated save allowed, setup-incomplete bootstrap
// allowed). R7 behavioral coverage lives with Agents B/C; this file asserts
// the priced-kind helper truth table only.
//
// Genuine skip: when LUNA_REMEDIATION_* disposable credentials are absent
// the live suites register with { skip } (counted as skipped, never green
// database evidence). Static migration-marker guards below run always (no
// DB). Never touches production: the luna helper denies the linked project.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  connectVerifiedDisposableDatabase,
  DisposableDatabaseBlocked
} from './helpers/luna-disposable-database.mjs'

// ── Static guards (no DB): the new migration texts contain the contract ─────
const MIGRATION_04 = readFileSync(
  new URL('../supabase/migrations/20261014040000_property_transition_receipt_first.sql', import.meta.url), 'utf8')
const MIGRATION_05 = readFileSync(
  new URL('../supabase/migrations/20261014050000_settings_classification_guard.sql', import.meta.url), 'utf8')
const MIGRATION_06 = readFileSync(
  new URL('../supabase/migrations/20261014060000_campsite_priced_tent_kind.sql', import.meta.url), 'utf8')

test('R1/R2 migration text carries receipt-first + family markers in order', () => {
  for (const marker of [
    'R1-RECEIPT-LOOKUP',
    'R1-NEW-OP-EXPECTED-STATE',
    'R2-SOURCE-CHECK',
    'R2-EXPECTATIONS-REQUIRED',
    '_property_transition_family',
    'unsupported_source',
    'expectations_required',
    'extract(epoch from p_expected_updated_at)::text',
    'app.property_transition_writer'
  ]) {
    assert.ok(MIGRATION_04.includes(marker), `20261014040000 must contain ${marker}`)
  }
  assert.ok(
    MIGRATION_04.indexOf('R1-RECEIPT-LOOKUP') < MIGRATION_04.indexOf('R1-NEW-OP-EXPECTED-STATE'),
    'receipt lookup must precede new-operation expected-state checks in the commit body'
  )
  assert.ok(
    MIGRATION_04.indexOf('R1-RECEIPT-LOOKUP') < MIGRATION_04.indexOf('R2-SOURCE-CHECK'),
    'receipt lookup must precede the new-operation source-family check so authorized historical replays return their saved result'
  )
  assert.ok(
    MIGRATION_04.includes('extract(epoch from p_expected_updated_at)::bigint::text'),
    'legacy v1 fingerprint must remain for dual-accept of pre-upgrade receipts'
  )
})

test('R3 migration text carries the classification-guard markers', () => {
  for (const marker of [
    'R3-CLASSIFICATION-GUARD',
    'classification_locked',
    'app.property_transition_writer',
    'OLD.setup_complete is not true',
    'app_is_service_role'
  ]) {
    assert.ok(MIGRATION_05.includes(marker), `20261014050000 must contain ${marker}`)
  }
  assert.match(
    MIGRATION_05,
    /before update of property_type, business_type on public\.settings/i
  )
})

test('R7 migration text carries the priced-kind contract markers', () => {
  for (const marker of ['R7-PRICED-KIND', '_is_campsite_priced_kind', 'CAMPSITE_PRICED_KINDS']) {
    assert.ok(MIGRATION_06.includes(marker), `20261014060000 must contain ${marker}`)
  }
  assert.ok(
    MIGRATION_06.includes("in ('campsite', 'tent')"),
    'priced-kind helper must accept exactly normalized campsite + tent'
  )
})

// ── Live contract (disposable DB only) ───────────────────────────────────────
let connected = null
let blocked = null
try {
  connected = await connectVerifiedDisposableDatabase()
} catch (error) {
  if (error instanceof DisposableDatabaseBlocked) blocked = error
  else throw error
}

if (blocked || !connected) {
  test(
    'property-transition receipt/source/guard SQL contract (no disposable database)',
    { skip: 'LUNA_REMEDIATION_TEST_DB_URL absent: ' + (blocked?.message || 'no disposable database connection') },
    () => {}
  )
} else {
  const db = connected.client
  const MIGRATION_SQL = readFileSync(new URL('../supabase/migrations/20261014010000_property_type_transitions.sql', import.meta.url), 'utf8')
  const SCOPE_SQL = readFileSync(new URL('../supabase/migrations/20261014020000_property_type_transition_lodge_scope_deny.sql', import.meta.url), 'utf8')
  const CARRY_SQL = readFileSync(new URL('../supabase/migrations/20261014030000_campsite_quotation_conversion_carry.sql', import.meta.url), 'utf8')

  const lodge = randomUUID()
  const adminId = randomUUID()
  const cashierId = randomUUID()
  const adminToken = 'rt-admin-' + randomUUID()
  const cashierToken = 'rt-cashier-' + randomUUID()

  const call = async (client, text, params = []) =>
    (await client.query(`select ${text} as result`, params)).rows[0].result
  const callDb = (text, params = []) => call(db, text, params)

  async function asSession(client, token) {
    await client.query('begin')
    await client.query('set local role anon')
    await client.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [token])
  }
  async function endSession(client) {
    await client.query('rollback').catch(() => {})
  }

  await db.query(MIGRATION_SQL)
  await db.query(SCOPE_SQL)
  await db.query(CARRY_SQL)
  await db.query(MIGRATION_04)
  await db.query(MIGRATION_05)
  await db.query(MIGRATION_06)
  await db.query(
    `insert into public.settings(lodge_id, lodge_name, company_name, business_type, property_type, setup_complete, operating_profile)
     values ($1, 'Receipt Test Lodge', 'Receipt Test Co', 'lodge', 'lodge', true, '{}'::jsonb)`,
    [lodge]
  )
  await db.query(
    `insert into public.users(id, lodge_id, name, email, role, password_hash, status)
     values ($1, $2, 'rt-admin', $3, 'admin', 'not-a-login-hash', 'active'),
            ($4, $2, 'rt-cashier', $5, 'cashier', 'not-a-login-hash', 'active')`,
    [adminId, lodge, `${adminId}@example.invalid`, cashierId, `${cashierId}@example.invalid`]
  )
  await db.query(
    `insert into public.app_sessions(token_hash, session_type, user_id, lodge_id, role, expires_at)
     values (public.app_hash_token($1), 'desktop', $2::uuid, $3::uuid, 'admin', now() + interval '20 minutes'),
            (public.app_hash_token($4), 'desktop', $5::uuid, $3::uuid, 'cashier', now() + interval '20 minutes')`,
    [adminToken, adminId, lodge, cashierToken, cashierId]
  )
  const readSettings = async () =>
    (await db.query('select property_type, business_type, lodge_name, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
  // Test-setup reclassification runs under the audited-contract writer flag
  // in its own transaction, so setup writes do not depend on the fixture
  // connection's login role for the service_role trigger condition.
  const setupReclassify = async (targetLodge, targetType) => {
    await db.query('begin')
    try {
      await db.query("select set_config('app.property_transition_writer', '1', true)")
      await db.query('update public.settings set property_type = $2 where lodge_id = $1', [targetLodge, targetType])
      await db.query('commit')
    } catch (error) {
      await db.query('rollback').catch(() => {})
      throw error
    }
  }

  after(async () => {
    await db.query('delete from public.property_type_transitions where lodge_id = $1', [lodge]).catch(() => {})
    await db.query('delete from public.app_sessions where lodge_id = $1 and user_id = any($2::uuid[])', [lodge, [adminId, cashierId]]).catch(() => {})
    await db.query('delete from public.users where id = any($1::uuid[])', [[adminId, cashierId]]).catch(() => {})
    await db.query('delete from public.settings where lodge_id = $1', [lodge]).catch(() => {})
    await db.end().catch(() => {})
  })

  test('R1: commit then identical replay returns the saved receipt', async () => {
    const key = randomUUID()
    await asSession(db, adminToken)
    try {
      const before = await readSettings()
      const first = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', before.property_type, before.updated_at, key, 'r1 receipt']
      )
      assert.equal(first.success, true)
      assert.equal(first.replayed, false)
      const replay = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', before.property_type, before.updated_at, key, 'r1 receipt']
      )
      assert.equal(replay.success, true)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, first.data)
    } finally {
      await endSession(db)
    }
  })

  test('R1: replay survives a later unrelated settings update', async () => {
    const key = randomUUID()
    await asSession(db, adminToken)
    let first
    try {
      const before = await readSettings()
      first = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'guest_house', before.property_type, before.updated_at, key, 'r1 survives touch']
      )
      assert.equal(first.success, true)
    } finally {
      await endSession(db)
    }
    // Unrelated privileged touch: no classification columns, guard passes.
    const touched = await readSettings()
    await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Receipt Test Lodge Touched'])
    const afterTouch = await readSettings()
    assert.notDeepEqual(
      new Date(afterTouch.updated_at).toISOString(),
      new Date(touched.updated_at).toISOString()
    )
    await asSession(db, adminToken)
    try {
      const replay = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'guest_house', touched.property_type, touched.updated_at, key, 'r1 survives touch']
      )
      assert.equal(replay.success, true)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, first.data)
      const row = await readSettings()
      assert.equal(row.property_type, first.data.target_type)
    } finally {
      await endSession(db)
    }
  })

  test('R1: mismatched-payload key reuse raises 23505', async () => {
    const key = randomUUID()
    await asSession(db, adminToken)
    try {
      const before = await readSettings()
      const first = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, before.property_type, before.property_type, before.updated_at, key, 'first intent']
      )
      assert.equal(first.success, true)
      await assert.rejects(
        callDb(
          'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
          [lodge, before.property_type, before.property_type, before.updated_at, key, 'different intent']
        ),
        (error) => error?.code === '23505'
      )
    } finally {
      await endSession(db)
    }
  })

  test('R1: concurrent same-key commits resolve deterministically', async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const key = randomUUID()
    const before = await readSettings()
    const args = [lodge, before.property_type, before.property_type, before.updated_at, key, 'race']
    const second = await connectVerifiedDisposableDatabase().then((c) => c.client)
    try {
      // A opens, starts its commit and holds the settings row lock inside
      // its transaction. B starts while A holds the lock and blocks; when A
      // commits, B must resolve via the stored receipt (replayed:true).
      await asSession(db, adminToken)
      const aPromise = callDb('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)', args)
      await sleep(200)
      await asSession(second, adminToken)
      const bPromise = call(second, 'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)', args)
      await sleep(200)
      await db.query('commit')
      const a = await aPromise
      const b = await bPromise
      assert.equal(a.success, true)
      assert.equal(a.replayed, false)
      assert.equal(b.success, true)
      assert.equal(b.replayed, true)
      assert.deepEqual(b.data, a.data)
    } finally {
      await db.query('rollback').catch(() => {})
      await endSession(second)
      await second.end().catch(() => {})
    }
  })

  test('R2: non-lodging sources are rejected by commit and preview', async () => {
    for (const source of ['hotel', 'resort', 'restaurant', 'bar', 'pos_only', 'castle']) {
      await setupReclassify(lodge, source)
      const current = await readSettings()
      await asSession(db, adminToken)
      try {
        const commit = await callDb(
          'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, null)',
          [lodge, 'lodge', current.property_type, current.updated_at, randomUUID()]
        )
        assert.equal(commit.success, false, `commit from ${source}`)
        assert.equal(commit.code, 'unsupported_source', `commit from ${source}`)
        const preview = await callDb(
          'public.preview_property_type_change($1, $2, $3, $4::timestamptz)',
          [lodge, 'lodge', current.property_type, current.updated_at]
        )
        assert.equal(preview.success, false, `preview from ${source}`)
        assert.equal(preview.code, 'unsupported_source', `preview from ${source}`)
      } finally {
        await endSession(db)
      }
    }
    await setupReclassify(lodge, 'lodge')
  })

  test('R2: null expectations are rejected on new keys (commit) and preview', async () => {
    await asSession(db, adminToken)
    try {
      const commit = await callDb(
        'public.commit_property_type_change($1, $2, null, null, $3, null)',
        [lodge, 'camp', randomUUID()]
      )
      assert.equal(commit.success, false)
      assert.equal(commit.code, 'VALIDATION_FAILED')
      assert.match(String(commit.error || ''), /expectations_required/)
      const preview = await callDb(
        'public.preview_property_type_change($1, $2, null, null)',
        [lodge, 'camp']
      )
      assert.equal(preview.success, false)
      assert.equal(preview.code, 'expectations_required')
    } finally {
      await endSession(db)
    }
  })

  test('R2: historical replay returns the stored result without source re-check or mutation', async () => {
    const key = randomUUID()
    await asSession(db, adminToken)
    let first
    let originalType
    let originalUpdatedAt
    try {
      const before = await readSettings()
      assert.equal(before.property_type, 'lodge')
      originalType = before.property_type
      originalUpdatedAt = before.updated_at
      first = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', originalType, originalUpdatedAt, key, 'history']
      )
      assert.equal(first.success, true)
    } finally {
      await endSession(db)
    }
    const transitionsBefore = Number(
      (await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [lodge])).rows[0].c
    )
    // Move the source out of family through the trusted server path, then
    // replay the ORIGINAL payload: the stored receipt must come back with no
    // source re-check, no mutation, no new ledger row.
    await setupReclassify(lodge, 'hotel')
    await asSession(db, adminToken)
    try {
      const replay = await callDb(
        'public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, 'camp', originalType, originalUpdatedAt, key, 'history']
      )
      assert.equal(replay.success, true)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, first.data)
    } finally {
      await endSession(db)
    }
    const row = await readSettings()
    assert.equal(row.property_type, 'hotel', 'replay must not mutate the current row')
    const transitionsAfter = Number(
      (await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [lodge])).rows[0].c
    )
    assert.equal(transitionsAfter, transitionsBefore, 'replay must not append a ledger row')
    await setupReclassify(lodge, 'lodge')
  })

  test('R3: stale ordinary revert is rejected, legitimate unrelated save succeeds', async () => {
    await asSession(db, adminToken)
    try {
      const current = await readSettings()
      // Stale device echoes an outdated classification with an unrelated edit.
      await assert.rejects(
        db.query(
          `update public.settings set lodge_name = $2, property_type = $3, business_type = 'lodge' where lodge_id = $1`,
          [lodge, 'Stale Device Name', current.property_type === 'camp' ? 'lodge' : 'camp']
        ),
        (error) => /classification_locked/.test(String(error?.message || '')) && String(error?.code || '') === 'P0001'
      )
      const still = await readSettings()
      assert.equal(still.property_type, current.property_type)
      // Legitimate unrelated save (no classification columns) succeeds.
      await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Legit Name'])
      const after = await readSettings()
      assert.equal(after.lodge_name, 'Legit Name')
      assert.equal(after.property_type, current.property_type)
    } finally {
      await endSession(db)
    }
  })

  test('R3: direct UPDATE property_type bypass raises classification_locked', async () => {
    await asSession(db, adminToken)
    try {
      await assert.rejects(
        db.query('update public.settings set property_type = $2 where lodge_id = $1', [lodge, 'motel']),
        (error) => /classification_locked/.test(String(error?.message || '')) && /commit_property_type_change/.test(String(error?.message || ''))
      )
      const row = await readSettings()
      assert.notEqual(row.property_type, 'motel')
    } finally {
      await endSession(db)
    }
  })

  test('R3: bootstrap insert on setup_incomplete still works, then commits', async () => {
    const fresh = randomUUID()
    await db.query(
      `insert into public.settings(lodge_id, lodge_name, company_name, business_type, property_type, setup_complete, operating_profile)
       values ($1, 'Fresh Lodge', 'Fresh Co', 'lodge', 'guest_house', false, '{}'::jsonb)`,
      [fresh]
    )
    try {
      // Setup-incomplete rows may still establish classification (bootstrap window).
      await db.query('update public.settings set property_type = $2 where lodge_id = $1', [fresh, 'bnb'])
      const row = (await db.query('select property_type from public.settings where lodge_id = $1', [fresh])).rows[0]
      assert.equal(row.property_type, 'bnb')
    } finally {
      await db.query('delete from public.settings where lodge_id = $1', [fresh]).catch(() => {})
    }
  })

  test('R7: priced-kind helper accepts campsite+tent, rejects room+unit', async () => {
    // Underscore helpers are owner-only (revoked from anon/authenticated),
    // so the truth table runs on the privileged fixture connection; the
    // SECURITY DEFINER RPCs invoke the helper as owner at runtime.
    const priced = async (kind) =>
      (await db.query('select public._is_campsite_priced_kind($1) as v', [kind])).rows[0].v
    for (const kind of ['campsite', 'Campsite', 'tent', 'Tent']) {
      assert.equal(await priced(kind), true, String(kind))
    }
    for (const kind of ['room', 'unit', 'cabin', 'chalet', null, 'castle']) {
      assert.equal(await priced(kind), false, String(kind))
    }
  })
}
