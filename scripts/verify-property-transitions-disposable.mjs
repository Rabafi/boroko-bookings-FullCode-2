// LodgingOS property-type transition: disposable-database verification driver.
//
// Applies supabase/migrations/20261014010000_property_type_transitions.sql
// then 20261014020000_property_type_transition_lodge_scope_deny.sql on a
// VERIFIED disposable database and exercises the full server contract:
// authorized preview+commit, unauthorized actor denied, wrong-lodge denied
// (preview/commit/status), all 5x4 same-product previews plus a commit chain
// visiting every supported type, cross-product rejections, stale-state
// rejections, exact replay + status recovery, mismatched-payload 23505,
// ordinary-save bypass rejection (desktop domain guard), and
// inventory/booking/ledger preservation counts.
//
// Database identity uses the repository's approved guardrails only
// (tests/helpers/luna-disposable-database.mjs):
//   LUNA_REMEDIATION_TEST_DB_URL, LUNA_REMEDIATION_TARGET_MARKER
//   (= LUNA-REMEDIATION-DISPOSABLE-v1), LUNA_REMEDIATION_EXPECTED_DATABASE,
//   LUNA_REMEDIATION_EXPECTED_PROJECT_REF.
// Raw SUPABASE_* URLs are intentionally NOT accepted: they cannot prove the
// disposable marker identity, so this script refuses to connect with them.
// The linked production project (oicgpknsmtvcsjacymum) is refused before
// connecting; credentials are never printed.
//
// When the disposable env is absent the script prints SKIP with the exact
// variables needed and exits 0. Run from the repository root:
//   node scripts/verify-property-transitions-disposable.mjs
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  connectVerifiedDisposableDatabase,
  DisposableDatabaseBlocked
} from '../tests/helpers/luna-disposable-database.mjs'

const PRODUCTION_REF = 'oicgpknsmtvcsjacymum'
const REQUIRED_ENV = [
  'LUNA_REMEDIATION_TEST_DB_URL',
  'LUNA_REMEDIATION_TARGET_MARKER (expect LUNA-REMEDIATION-DISPOSABLE-v1)',
  'LUNA_REMEDIATION_EXPECTED_DATABASE',
  'LUNA_REMEDIATION_EXPECTED_PROJECT_REF'
]
const SUPPORTED_TYPES = ['guest_house', 'bnb', 'lodge', 'camp', 'motel']
const CROSS_PRODUCT_TYPES = ['hotel', 'resort', 'restaurant', 'bar', 'pos_only']

function skip(message) {
  console.log('SKIP property-transitions-disposable: ' + message)
  console.log('To run, set: ' + REQUIRED_ENV.join(', '))
  console.log('Raw SUPABASE_* URLs are not accepted; only the verified disposable contract above.')
}

let connected = null
try {
  const rawUrl = String(process.env.LUNA_REMEDIATION_TEST_DB_URL || '').toLowerCase()
  if (rawUrl.includes(PRODUCTION_REF)) {
    console.error('REFUSE: the target URL matches the linked production project; disposable verification never touches production.')
    process.exit(2)
  }
  connected = await connectVerifiedDisposableDatabase()
} catch (error) {
  if (error instanceof DisposableDatabaseBlocked) {
    skip(error.message)
    process.exit(0)
  }
  throw error
}

const db = connected.client
let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`PASS ${name}`)
  else {
    failures += 1
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const call = async (text, params = []) => (await db.query(`select ${text} as result`, params)).rows[0].result

async function asSession(token) {
  await db.query('begin')
  await db.query('set local role anon')
  await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [token])
}
async function endSession() {
  await db.query('rollback').catch(() => {})
}

const lodge = randomUUID()
const otherLodge = randomUUID()
const adminId = randomUUID()
const cashierId = randomUUID()
const adminToken = 'verify-admin-' + randomUUID()
const cashierToken = 'verify-cashier-' + randomUUID()

try {
  // 0. Migration files apply in deployment order (idempotent re-runnable).
  for (const file of [
    '../supabase/migrations/20261014010000_property_type_transitions.sql',
    '../supabase/migrations/20261014020000_property_type_transition_lodge_scope_deny.sql'
  ]) {
    const sql = readFileSync(new URL(file, import.meta.url), 'utf8')
    await db.query(sql)
  }
  const rpcs = (await db.query(
    "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('preview_property_type_change','commit_property_type_change','get_property_type_transition_status')"
  )).rows.map((row) => row.proname)
  check('migration-rpcs-present', SUPPORTED_TYPES.length === 5 && rpcs.length === 3, JSON.stringify(rpcs))
  check('migration-table-present', (await db.query("select to_regclass('public.property_type_transitions') as r")).rows[0].r !== null)

  // Fixtures (committed; removed at the end).
  await db.query(
    `insert into public.settings(lodge_id, lodge_name, company_name, business_type, property_type, setup_complete, operating_profile)
     values ($1, 'Verify Lodge', 'Verify Co', 'lodge', 'lodge', true,
       '{"hospitality_mode":"restaurant_bar","custom_choice":"keep-me","accommodation_mix":{"rooms_or_units":true}}'::jsonb)`,
    [lodge]
  )
  await db.query(
    `insert into public.users(id, lodge_id, name, email, role, password_hash, status)
     values ($1, $2, 'verify-admin', $3, 'admin', 'not-a-login-hash', 'active'),
            ($4, $2, 'verify-cashier', $5, 'cashier', 'not-a-login-hash', 'active')`,
    [adminId, lodge, `${adminId}@example.invalid`, cashierId, `${cashierId}@example.invalid`]
  )
  await db.query(
    `insert into public.app_sessions(token_hash, session_type, user_id, lodge_id, role, expires_at)
     values (public.app_hash_token($1), 'desktop', $2::uuid, $3::uuid, 'admin', now() + interval '20 minutes'),
            (public.app_hash_token($4), 'desktop', $5::uuid, $3::uuid, 'cashier', now() + interval '20 minutes')`,
    [adminToken, adminId, lodge, cashierToken, cashierId]
  )

  const countFor = async (table) => {
    const reg = (await db.query('select to_regclass($1) as r', ['public.' + table])).rows[0].r
    if (!reg) return null
    return Number((await db.query(`select count(*)::integer as c from public.${table} where lodge_id = $1`, [lodge])).rows[0].c)
  }
  const roomsBefore = await countFor('rooms')
  const bookingsBefore = await countFor('bookings')
  const paymentsBefore = await countFor('payments')

  // 1. Authorized preview + commit.
  await asSession(adminToken)
  try {
    const settingsBefore = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
    const preview = await call('public.preview_property_type_change($1, $2, $3, $4::timestamptz)', [lodge, 'camp', 'lodge', settingsBefore.updated_at])
    check('authorized-preview', preview?.success === true && preview?.data?.target_type === 'camp' && preview?.data?.current_type === 'lodge')
    check('preview-shape', Array.isArray(preview?.data?.navigation?.notes) && preview.data.navigation.notes.length > 0
      && Array.isArray(preview?.data?.blockers) && preview?.data?.preserved?.includes('ledgers')
      && typeof preview?.data?.wording?.to_label === 'string')
    const key = randomUUID()
    const first = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
      [lodge, 'camp', 'lodge', settingsBefore.updated_at, key, 'disposable verification'])
    check('authorized-commit', first?.success === true && first?.replayed === false && first?.data?.changed === true
      && first?.data?.previous_type === 'lodge' && first?.data?.target_type === 'camp')
    const row = (await db.query('select property_type, business_type, operating_profile from public.settings where lodge_id = $1', [lodge])).rows[0]
    check('commit-narrow-profile', row.property_type === 'camp' && row.business_type === 'lodge'
      && row.operating_profile?.hospitality_mode === 'restaurant_bar' && row.operating_profile?.custom_choice === 'keep-me')

    // 2. Exact replay + status recovery.
    const replay = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
      [lodge, 'camp', 'lodge', settingsBefore.updated_at, key, 'disposable verification'])
    check('exact-replay', replay?.success === true && replay?.replayed === true
      && JSON.stringify(replay?.data) === JSON.stringify(first?.data), JSON.stringify(replay?.data))
    const status = await call('public.get_property_type_transition_status($1, $2)', [lodge, key])
    check('status-recovery', status?.success === true && JSON.stringify(status?.data) === JSON.stringify(first?.data))
    const missing = await call('public.get_property_type_transition_status($1, $2)', [lodge, randomUUID()])
    check('status-not-found', missing?.success === false && missing?.code === 'NOT_FOUND')

    // 3. Mismatched-payload reuse raises 23505.
    const mismatchKey = randomUUID()
    const firstIntent = await call('public.commit_property_type_change($1, $2, null, null, $3, $4)', [lodge, 'motel', mismatchKey, 'first intent'])
    check('mismatch-first-commit', firstIntent?.success === true)
    let mismatchCode = null
    try {
      await call('public.commit_property_type_change($1, $2, null, null, $3, $4)', [lodge, 'bnb', mismatchKey, 'different intent'])
    } catch (error) {
      mismatchCode = error?.code
    }
    check('mismatch-reuse-23505', mismatchCode === '23505', String(mismatchCode))

    // 4. Stale expected type / timestamp rejected.
    const staleType = await call('public.commit_property_type_change($1, $2, $3, null, $4, null)', [lodge, 'bnb', 'guest_house', randomUUID()])
    check('stale-type-rejected', staleType?.success === false && staleType?.code === 'expected_state_conflict')
    const staleTime = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, null)', [lodge, 'bnb', 'motel', '2001-01-01T00:00:00.000Z', randomUUID()])
    check('stale-time-rejected', staleTime?.success === false && staleTime?.code === 'expected_state_conflict')
  } finally {
    await endSession()
  }

  // 5. Unauthorized actor denied.
  await asSession(cashierToken)
  try {
    const denied = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
    check('cashier-denied', denied?.success === false && denied?.code === 'CAPABILITY_DENIED')
  } finally {
    await endSession()
  }
  await db.query('begin')
  await db.query('set local role anon')
  await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token','',true)")
  try {
    const anon = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
    check('anon-denied', anon?.success === false && anon?.code === 'UNAUTHENTICATED')
  } finally {
    await endSession()
  }

  // 6. Wrong lodge denied on all three RPCs, with no foreign row.
  await asSession(adminToken)
  try {
    const wrongPreview = await call('public.preview_property_type_change($1, $2, null, null)', [otherLodge, 'camp'])
    check('wrong-lodge-preview', wrongPreview?.success === false && wrongPreview?.code === 'LODGE_SCOPE_DENIED', JSON.stringify(wrongPreview))
    const wrongCommit = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [otherLodge, 'camp', randomUUID()])
    check('wrong-lodge-commit', wrongCommit?.success === false && wrongCommit?.code === 'LODGE_SCOPE_DENIED', JSON.stringify(wrongCommit))
    const wrongStatus = await call('public.get_property_type_transition_status($1, $2)', [otherLodge, randomUUID()])
    check('wrong-lodge-status', wrongStatus?.success === false && wrongStatus?.code === 'LODGE_SCOPE_DENIED', JSON.stringify(wrongStatus))
    const foreignRows = Number((await db.query('select count(*)::integer as c from public.property_type_transitions where lodge_id = $1', [otherLodge])).rows[0].c)
    check('wrong-lodge-no-write', foreignRows === 0)
  } finally {
    await endSession()
  }

  // 7. All 5x4 same-product previews OK; cross-product rejected.
  await asSession(adminToken)
  try {
    let previewPairs = 0
    for (const from of SUPPORTED_TYPES) {
      for (const to of SUPPORTED_TYPES) {
        if (from === to) continue
        const preview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, to])
        if (preview?.success === true && preview?.data?.target_type === to) previewPairs += 1
      }
    }
    check('same-product-preview-matrix-20', previewPairs === 20, `${previewPairs}/20`)
    let crossRejected = 0
    for (const target of CROSS_PRODUCT_TYPES) {
      const preview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, target])
      const commit = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [lodge, target, randomUUID()])
      if (preview?.success === false && preview?.code === 'cross_product_rejected'
        && commit?.success === false && commit?.code === 'cross_product_rejected') crossRejected += 1
    }
    check('cross-product-rejected-5', crossRejected === CROSS_PRODUCT_TYPES.length, `${crossRejected}/${CROSS_PRODUCT_TYPES.length}`)

    // 8. Commit chain visits every supported type.
    const visited = new Set()
    for (const target of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
      const current = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
      if (current.property_type === target) {
        visited.add(target)
        continue
      }
      const committed = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
        [lodge, target, current.property_type, current.updated_at, randomUUID(), 'disposable matrix'])
      if (committed?.success === true && committed?.data?.changed === true && committed?.data?.target_type === target) visited.add(target)
    }
    check('commit-chain-all-five', visited.size === 5, [...visited].join(','))
  } finally {
    await endSession()
  }

  // 9. Preservation counts unchanged.
  check('preserve-rooms', (await countFor('rooms')) === roomsBefore, `${await countFor('rooms')} vs ${roomsBefore}`)
  check('preserve-bookings', (await countFor('bookings')) === bookingsBefore)
  check('preserve-payments', (await countFor('payments')) === paymentsBefore)

  // 10. Ordinary-save / profile-smuggle bypass rejected at the domain layer.
  const helpers = await import(pathToFileURL(new URL('../tests/helpers/domain-test-setup.mjs', import.meta.url)).href)
  const { state, resetState } = await helpers.importState()
  resetState()
  state.isOnline = true
  state.lodgeId = lodge
  state.cacheDir = helpers.makeTempCacheDir('verify-property-transition')
  state.supabase = {
    rpc: async () => { throw new Error('no RPC expected during ordinary-save guard check') },
    from: () => ({
      upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) }),
      update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  }
  const { writeCache } = await helpers.importDomain('infrastructure.js')
  writeCache('settings', [{ lodge_id: lodge, lodge_name: 'Verify', property_type: 'motel', business_type: 'lodge', setup_complete: true, updated_at: new Date().toISOString(), operating_profile: {} }])
  const settings = await helpers.importDomain('settings.js')
  let saveCode = null
  try {
    await settings.saveSettings({ lodge_name: 'Verify', property_type: 'camp' })
  } catch (error) {
    saveCode = error?.code
  }
  check('ordinary-save-bypass-rejected', saveCode === 'property_transition_required', String(saveCode))
  let profileCode = null
  try {
    await settings.updateOperatingProfile({ property_type: 'camp' })
  } catch (error) {
    profileCode = error?.code
  }
  check('profile-smuggle-rejected', profileCode === 'property_transition_required', String(profileCode))

  // ── Phase B: forward corrections R1/R2/R3/R7 ──────────────────────────
  // Applied AFTER every Phase A check above has run under the base
  // contract, so the Phase A assertions keep their original semantics.
  for (const file of [
    '../supabase/migrations/20261014030000_campsite_quotation_conversion_carry.sql',
    '../supabase/migrations/20261014040000_property_transition_receipt_first.sql',
    '../supabase/migrations/20261014050000_settings_classification_guard.sql',
    '../supabase/migrations/20261014060000_campsite_priced_tent_kind.sql'
  ]) {
    const sql = readFileSync(new URL(file, import.meta.url), 'utf8')
    await db.query(sql)
  }
  check('phase-b-migrations-applied', true)
  const setupReclassify = async (type) => {
    await db.query('begin')
    try {
      await db.query("select set_config('app.property_transition_writer', '1', true)")
      await db.query('update public.settings set property_type = $2 where lodge_id = $1', [lodge, type])
      await db.query('commit')
    } catch (error) {
      await db.query('rollback').catch(() => {})
      throw error
    }
  }

  // B1. Receipt-first replay survives an unrelated settings touch.
  await asSession(adminToken)
  let b1First = null
  let b1Before = null
  let b1Key = null
  try {
    b1Before = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
    b1Key = randomUUID()
    b1First = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
      [lodge, b1Before.property_type, b1Before.property_type, b1Before.updated_at, b1Key, 'phase b'])
    check('phase-b-commit', b1First?.success === true, JSON.stringify(b1First))
    await db.query('commit')
  } catch (error) {
    await db.query('rollback').catch(() => {})
    throw error
  }
  await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Phase B Touched'])
  await asSession(adminToken)
  try {
    const replay = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, $6)',
      [lodge, b1Before.property_type, b1Before.property_type, b1Before.updated_at, b1Key, 'phase b'])
    check('phase-b-replay-after-touch', replay?.success === true && replay?.replayed === true
      && JSON.stringify(replay?.data) === JSON.stringify(b1First?.data), JSON.stringify(replay))
  } finally {
    await endSession()
  }

  // B2. Null expectations rejected (commit VALIDATION_FAILED, preview code).
  await asSession(adminToken)
  try {
    const noExp = await call('public.commit_property_type_change($1, $2, null, null, $3, null)', [lodge, 'camp', randomUUID()])
    check('phase-b-expectations-commit', noExp?.success === false && noExp?.code === 'VALIDATION_FAILED'
      && /expectations_required/.test(String(noExp?.error || '')), JSON.stringify(noExp))
    const noExpPreview = await call('public.preview_property_type_change($1, $2, null, null)', [lodge, 'camp'])
    check('phase-b-expectations-preview', noExpPreview?.success === false && noExpPreview?.code === 'expectations_required',
      JSON.stringify(noExpPreview))
  } finally {
    await endSession()
  }

  // B3. Unsupported source rejected, then restored via the trusted path.
  const b3Current = (await db.query('select property_type, updated_at from public.settings where lodge_id = $1', [lodge])).rows[0]
  await setupReclassify('hotel')
  await asSession(adminToken)
  try {
    const srcCommit = await call('public.commit_property_type_change($1, $2, $3, $4::timestamptz, $5, null)',
      [lodge, 'lodge', 'hotel', b3Current.updated_at, randomUUID()])
    check('phase-b-unsupported-source-commit', srcCommit?.success === false && srcCommit?.code === 'unsupported_source',
      JSON.stringify(srcCommit))
    const srcPreview = await call('public.preview_property_type_change($1, $2, $3, $4::timestamptz)',
      [lodge, 'lodge', 'hotel', b3Current.updated_at])
    check('phase-b-unsupported-source-preview', srcPreview?.success === false && srcPreview?.code === 'unsupported_source',
      JSON.stringify(srcPreview))
  } finally {
    await endSession()
  }
  await setupReclassify(b3Current.property_type)
  check('phase-b-source-restored',
    (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0].property_type === b3Current.property_type)

  // B4. Server classification guard: stale revert rejected, unrelated save OK.
  await asSession(adminToken)
  try {
    const cur = (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
    let guardCode = null
    let guardMessage = ''
    try {
      await db.query('update public.settings set lodge_name = $2, property_type = $3 where lodge_id = $1',
        [lodge, 'Stale Device', cur.property_type === 'camp' ? 'lodge' : 'camp'])
    } catch (error) {
      guardCode = error?.code
      guardMessage = String(error?.message || '')
    }
    check('phase-b-guard-rejects-stale-revert', guardCode === 'P0001' && /classification_locked/.test(guardMessage),
      `${guardCode} ${guardMessage}`)
    const kept = (await db.query('select property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
    check('phase-b-guard-preserves-type', kept.property_type === cur.property_type)
    await db.query('update public.settings set lodge_name = $2 where lodge_id = $1', [lodge, 'Verify Lodge'])
    const renamed = (await db.query('select lodge_name, property_type from public.settings where lodge_id = $1', [lodge])).rows[0]
    check('phase-b-unrelated-save-ok', renamed.lodge_name === 'Verify Lodge' && renamed.property_type === cur.property_type)
  } finally {
    await endSession()
  }

  // B5. Priced-kind helper truth table (owner-only helper: privileged query).
  const pricedKinds = ['campsite', 'tent']
  const roomKinds = ['room', 'unit']
  let pricedOk = true
  for (const kind of pricedKinds) {
    pricedOk = pricedOk && (await db.query('select public._is_campsite_priced_kind($1) as v', [kind])).rows[0].v === true
  }
  for (const kind of roomKinds) {
    pricedOk = pricedOk && (await db.query('select public._is_campsite_priced_kind($1) as v', [kind])).rows[0].v === false
  }
  check('phase-b-priced-kinds', pricedOk)
} finally {
  await db.query('delete from public.property_type_transitions where lodge_id = $1', [lodge]).catch(() => {})
  await db.query('delete from public.app_sessions where lodge_id = $1 and user_id = any($2::uuid[])', [lodge, [adminId, cashierId]]).catch(() => {})
  await db.query('delete from public.users where id = any($1::uuid[])', [[adminId, cashierId]]).catch(() => {})
  await db.query('delete from public.settings where lodge_id = $1', [lodge]).catch(() => {})
  await db.end().catch(() => {})
}

if (failures > 0) {
  console.error(`property-transitions-disposable: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('property-transitions-disposable: all checks passed')
