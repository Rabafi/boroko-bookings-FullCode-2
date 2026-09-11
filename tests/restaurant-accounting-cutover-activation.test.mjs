// Real-role SQL acceptance for the cutover maker/checker lifecycle and
// activation readback (G2-hardened). Runs ONLY against an explicitly
// acknowledged disposable database and fails closed otherwise.
//
// Safety contract (checked BEFORE any connection is created):
//   RESTAURANT_ACCOUNTING_DISPOSABLE_DB=1  (existing disposable opt-in,
//     shared with scripts/run-disposable-restaurant-tests.mjs)
//   RESTAURANT_ACCOUNTING_TEST_DB_URL=<explicit target>  (no default; a
//     missing URL refuses instead of assuming localhost is disposable)
//   RESTAURANT_ACCOUNTING_DISPOSABLE_ACK=destroy-data-on:<host>  (explicit
//     acknowledgement naming the exact target host)
// The configuration matrix (missing/wrong/valid) is unit-tested through the
// pure validateSafetyConfig() with injected values — no connection is ever
// opened to test safety logic. The integration entry point still fails
// closed on the actual unapproved environment. Only hosts, never
// credentials, appear in messages.
//
// Role contract: a privileged fixture connection (NOT assumed superuser —
// managed Supabase withholds it) first proves narrow capabilities via
// probeFixturePrerequisites() before any fixture side effect, then creates
// isolated synthetic fixtures only, including explicit commercial
// entitlement provisioning (licenses row + entitlement override row, each
// verified — never assumed from a seed). Every assertion runs in a
// separate session switched to an ACTUAL database role (SET ROLE
// authenticated / anon) with the application's genuine session GUCs, and
// each session verifies current_user/session_user/auth.role() before
// asserting. Authorization is never emulated by merely setting a JWT claim
// while remaining on the fixture role. Concurrency uses independent
// pg.Client sessions with bounded timeouts, and every client closes in a
// finally block.
import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { rejectsSqlState as rejectsCode } from './helpers/sql-state.mjs'
import { validateSafetyConfig } from '../src/shared/accountingActivation.js'
import { probeFixturePrerequisites, evaluateFixturePrerequisites } from './helpers/disposable-prerequisites.mjs'

const FLAG = process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB
const DB_URL = process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL || ''
const ACK = process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_ACK || ''

function safetyError() {
  return validateSafetyConfig({ flag: FLAG, url: DB_URL, ack: ACK })
}

function requireSafety() {
  const problem = safetyError()
  assert.equal(problem, null, problem || 'disposable-target safety gate')
}

const openClients = []
// Privileged fixture/setup connection. This is NOT assumed superuser:
// managed Supabase withholds superuser, so the integration test probes
// exact capabilities (probeFixturePrerequisites) before any fixture side
// effect. Disposable-target safety checks still run BEFORE connecting.
async function connectFixture() {
  requireSafety()
  const c = new pg.Client({ connectionString: DB_URL, statement_timeout: 20000 })
  openClients.push(c)
  await c.connect()
  return c
}

// Fixture preflight: prove the narrow capabilities the suite actually
// uses (DML on synthetic fixture tables, setup RPC EXECUTE rights,
// assertion-role switching, auth helper) BEFORE any fixture side effect.
// A managed non-superuser with sufficient permissions proceeds; an
// insufficient role fails here with the exact missing capability.
async function requireFixturePrerequisites(c) {
  const profile = await probeFixturePrerequisites(c)
  const verdict = evaluateFixturePrerequisites(profile)
  assert.equal(
    verdict.ok,
    true,
    `Fixture connection ${profile.user || '?'} lacks required capabilities:\n- ${(verdict.missing || []).join('\n- ')}\n(probe errors: ${(profile.probeErrors || []).join('; ') || 'none'})`
  )
  return profile
}

// Assertion session under an ACTUAL database role with the application's
// genuine session contract (PostgREST-equivalent GUCs). Role names are
// allowlisted constants, never interpolated input.
async function connectAs({ dbRole = 'authenticated', actorId, lodgeId, sessionRole = 'admin' }) {
  assert.ok(['authenticated', 'anon'].includes(dbRole), 'restricted assertion role')
  const c = await connectFixture()
  await c.query(`set role ${dbRole}`)
  await c.query(
    "select set_config('request.jwt.claim.role',$1,false),set_config('app.session_valid','true',false),set_config('app.actor_id',$2,false),set_config('app.lodge_id',$3,false),set_config('app.session_role',$4,false)",
    [dbRole, actorId, lodgeId, sessionRole]
  )
  const identity = (await c.query('select current_user as current_user, session_user as session_user, auth.role() as jwt_role')).rows[0]
  assert.equal(identity.current_user, dbRole, `session must run as database role ${dbRole}`)
  assert.equal(identity.jwt_role, dbRole, 'JWT role claim must match the database role')
  return c
}

async function closeAll() {
  await Promise.all(openClients.splice(0).map((c) => c.end().catch(() => {})))
}

const one = async (c, text, params = []) => (await c.query(text, params)).rows[0]
const result = async (c, text, params = []) => (await one(c, `select ${text} result`, params)).result
const readBatch = (c, lodge, id) => result(c, 'public.get_restaurant_historical_cutover_batch($1,$2)', [lodge, id])
const approveAs = (c, lodge, id, notes, evidence) => result(
  c, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)',
  [lodge, id, notes, evidence.hash, evidence.source, evidence.preparer]
)
const evidenceOf = (detail) => ({
  hash: detail.data.opening_payload_hash,
  source: detail.data.source_manifest_hash,
  preparer: detail.data.prepared_by
})

test('G2 safety configuration matrix passes without any connection', () => {
  // Pure validator, injected values only: valid, missing, and wrong
  // configurations are all decided without touching a database.
  assert.equal(validateSafetyConfig({ flag: '1', url: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', ack: 'destroy-data-on:127.0.0.1:54322' }), null)
  assert.match(validateSafetyConfig({ flag: '0', url: 'postgresql://x@h/db', ack: 'destroy-data-on:h' }), /opt-in/)
  assert.match(validateSafetyConfig({ flag: undefined, url: undefined, ack: undefined }), /opt-in/)
  assert.match(validateSafetyConfig({ flag: '1', url: '', ack: '' }), /explicit.*target/i)
  assert.match(validateSafetyConfig({ flag: '1', url: 'not-a-url', ack: 'x' }), /explicit.*target/i)
  assert.match(validateSafetyConfig({ flag: '1', url: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', ack: 'destroy-data-on:wrong-host' }), /acknowledgement/)
})

test('G2 integration entry point refuses before connecting when unapproved', async () => {
  // Isolated child process with approval inputs deliberately removed and a
  // connection sentinel: the child mirrors the integration entry structure
  // (safety gate first, client creation only after) and must exit nonzero
  // with the refusal before any pg.Client exists. Never asserts anything
  // about the invoking environment, so valid-shaped settings elsewhere
  // cannot fail this test. No network or database call occurs.
  const { execFile } = await import('node:child_process')
  const childSource = [
    "delete process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB;",
    "delete process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL;",
    "delete process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_ACK;",
    "const { validateSafetyConfig } = await import(process.argv[1]);",
    "const problem = validateSafetyConfig({ flag: process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB, url: process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL, ack: process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_ACK });",
    "if (problem === null) { console.log('GATE_PASSED_SENTINEL'); process.exit(0); }",
    "console.log(problem);",
    "process.exit(2);"
  ].join('\n')
  const moduleUrl = new URL('../src/shared/accountingActivation.js', import.meta.url).href
  const refusal = await new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', childSource, moduleUrl], (error, stdout) => {
      resolve({ code: error?.code ?? 0, stdout: String(stdout || '') })
    })
  })
  assert.equal(refusal.code, 2, 'unapproved child must exit nonzero')
  assert.match(refusal.stdout, /Refusing to run cutover SQL acceptance/)
  assert.doesNotMatch(refusal.stdout, /GATE_PASSED_SENTINEL/)
})

test('G2 valid-shaped approval settings pass the safety gate connection-free', async () => {
  // Companion isolation check: with valid-shaped dummy inputs the SAME
  // gate returns null without opening any connection (dummy host is never
  // dialled — the child exits right after the pure validation).
  const { execFile } = await import('node:child_process')
  const childSource = [
    "const { validateSafetyConfig } = await import(process.argv[1]);",
    "const problem = validateSafetyConfig({ flag: '1', url: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', ack: 'destroy-data-on:127.0.0.1:54322' });",
    "if (problem === null) { console.log('GATE_PASSED_SENTINEL'); process.exit(0); }",
    "console.log(problem);",
    "process.exit(2);"
  ].join('\n')
  const moduleUrl = new URL('../src/shared/accountingActivation.js', import.meta.url).href
  const result = await new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', childSource, moduleUrl], (error, stdout) => {
      resolve({ code: error?.code ?? 0, stdout: String(stdout || '') })
    })
  })
  assert.equal(result.code, 0, 'valid-shaped settings must pass the gate')
  assert.match(result.stdout, /GATE_PASSED_SENTINEL/)
})

test('Cutover maker/checker lifecycle and activation readback on real roles', async (t) => {
  requireSafety()
  const tag = randomUUID().slice(0, 8)
  const clients = []
  const track = (c) => { clients.push(c); return c }
  try {
    const setup = track(await connectFixture())
  // Managed session poolers cap concurrent sessions (15 here): every
  // subtest below reaps idle assertion sessions first, keeping only the
  // two shared fixtures (setup + asPreparer). Per-subtest sessions never
  // carry state across subtests (each connectAs sets its own GUCs), so
  // reaping changes nothing observable except the session count.
  const sharedSessions = new Set([setup])
  const reapSessions = async () => {
    const idle = clients.filter((c) => !sharedSessions.has(c))
    await Promise.all(idle.map((c) => c.end().catch(() => {})))
    for (const c of idle) {
      const at = clients.indexOf(c)
      if (at >= 0) clients.splice(at, 1)
    }
  }
    // Managed-platform preflight FIRST: prove the narrow fixture
    // capabilities before any fixture side effect. No superuser assumed.
    const fixtureProfile = await requireFixturePrerequisites(setup)
    const lodge = randomUUID()
    const otherLodge = randomUUID()
    const preparer = randomUUID()
    const reviewer = randomUUID()
    const checker2 = randomUUID()
    const reader = randomUUID()
    await setup.query("insert into public.settings(lodge_id,lodge_name,company_name,business_type,property_type,currency)values($1,'Cutover G2','Cutover G2','restaurant','restaurant','BWP')", [lodge])
    for (const [id, name, role] of [
      [preparer, 'preparer', 'admin'],
      [reviewer, 'reviewer', 'admin'],
      [checker2, 'checker2', 'admin'],
      [reader, 'reader', 'manager']
    ]) {
      await setup.query("insert into public.users(id,lodge_id,name,email,role,password_hash,status)values($1,$2,$3,$4,$5,'not-a-login-hash','active')", [id, lodge, `${name}-${tag}`, `${id}@example.invalid`, role])
    }
    await setup.query("insert into public.settings(lodge_id,lodge_name,company_name,business_type,property_type,currency)values($1,'Other','Other','restaurant','restaurant','BWP')", [otherLodge])
    const stranger = randomUUID()
    await setup.query("insert into public.users(id,lodge_id,name,email,role,password_hash,status)values($1,$2,'stranger','s@example.invalid','admin','not-a-login-hash','active')", [stranger, otherLodge])

    // Explicit entitlement provisioning (never assumed from a seed): the
    // lodge resolves to the hospitality-pos product, so a license row plus
    // a governed-shape override row enables restaurant_accounting. The JSON
    // result is fetched once and both the commercial identity and the flag
    // are validated from that same result; a schema drift fails loudly
    // naming the gap, distinctly from connectivity errors.
    await setup.query("insert into public.licenses(lodge_id,license_key,lodge_name,product_id,subscription_plan,payment_status,is_active)values($1,$2,'Cutover G2','hospitality-pos','Pro','active',true)", [lodge, `cutover-g2-${tag}`])
    await setup.query("insert into public.commercial_entitlement_overrides(lodge_id,product_id,feature_key,enabled,reason,created_by,created_by_email)values($1,'hospitality-pos','restaurant_accounting',true,$2,$3,$4)", [lodge, `Disposable cutover acceptance ${tag}.`, preparer, 'cutover-g2@example.invalid'])
    // The foreign lodge is entitled exactly like the home lodge so the
    // cross-tenant subtest proves server-side ownership filtering (empty,
    // null) rather than merely tripping the entitlement gate. A third,
    // deliberately unentitled lodge in that subtest pins the fail-closed
    // entitlement denial (42501) for tenants without the feature.
    await setup.query("insert into public.licenses(lodge_id,license_key,lodge_name,product_id,subscription_plan,payment_status,is_active)values($1,$2,'Other','hospitality-pos','Pro','active',true)", [otherLodge, `cutover-g2-foreign-${tag}`])
    await setup.query("insert into public.commercial_entitlement_overrides(lodge_id,product_id,feature_key,enabled,reason,created_by,created_by_email)values($1,'hospitality-pos','restaurant_accounting',true,$2,$3,$4)", [otherLodge, `Disposable cutover acceptance (foreign) ${tag}.`, stranger, 'cutover-g2-foreign@example.invalid'])
    const entitlementJson = await one(setup, 'select public.get_lodge_entitlement($1) as entitlement', [lodge])
    const entitlement = entitlementJson.entitlement
    assert.ok(entitlement && typeof entitlement === 'object', 'entitlement fixture must return a JSON object')
    assert.equal(entitlement.status, 'licensed', `synthetic lodge must resolve licensed, got ${JSON.stringify(entitlement.status)}`)
    assert.equal(entitlement.product_id, 'hospitality-pos', `synthetic lodge must resolve the hospitality-pos product, got ${JSON.stringify(entitlement.product_id)}`)
    assert.equal(entitlement?.effective_features?.restaurant_accounting, true, 'provisioned override must enable restaurant_accounting')

    // Fixture actor identity for protected RPC setup calls (accounts,
    // mappings): the preflight above already proved EXECUTE rights, and
    // these calls run their genuine capability gates. The preflight also
    // recorded whether this connection bypasses as superuser (local) or
    // proceeds on narrow grants (managed); either way nothing is assumed.
    await setup.query("select set_config('request.jwt.claim.role','authenticated',false),set_config('app.session_valid','true',false),set_config('app.actor_id',$1,false),set_config('app.lodge_id',$2,false),set_config('app.session_role','admin',false)", [preparer, lodge])
    const setupContext = await one(setup, 'select current_user as current_user, session_user as session_user, auth.role() as jwt_role')
    assert.equal(setupContext.jwt_role, 'authenticated', 'setup session carries the authenticated application identity')
    assert.ok(setupContext.current_user, `setup session reports its database role (bypass: ${fixtureProfile.isSuperuser ? 'superuser' : 'narrow grants'})`)

    // Readiness prerequisites from get_restaurant_accounting_readiness:
    // active asset + revenue + expense accounts, cash tender mapping on an
    // asset account, one category revenue mapping effective back to 2026
    // (so pre-cutover source rows stay configured), and zero opening
    // balances on created accounts (no unresolved scalar dispositions).
    const ids = {}
    for (const [code, name, type] of [['1000', 'Cash', 'asset'], ['3000', 'Opening equity', 'equity'], ['4000', 'Food revenue', 'revenue'], ['5000', 'Supplies expense', 'expense']]) {
      const r = await result(setup, 'public.create_restaurant_account($1,$2,$3,$4,null,0,null)', [lodge, `${code}-${tag}`, name, type])
      ids[code] = r.data.id
    }
    await result(setup, 'public.set_restaurant_pos_gl_mapping_v2($1,$2,$3,$4,$5)', [lodge, 'tender', 'cash', ids['1000'], '2026-01-01'])
    await result(setup, 'public.set_restaurant_pos_gl_mapping_v2($1,$2,$3,$4,$5)', [lodge, 'category', 'food', ids['4000'], '2026-01-01'])

    // Actual EXECUTE grants on the NEW 6-argument approval signature,
    // asserted directly — not via function bodies.
    const grants = await one(setup, `select
      has_function_privilege('authenticated','public.approve_restaurant_historical_cutover(uuid,uuid,text,text,text,uuid)','EXECUTE') as auth_approve,
      has_function_privilege('service_role','public.approve_restaurant_historical_cutover(uuid,uuid,text,text,text,uuid)','EXECUTE') as role_approve,
      has_function_privilege('anon','public.approve_restaurant_historical_cutover(uuid,uuid,text,text,text,uuid)','EXECUTE') as anon_approve,
      has_function_privilege('anon','public.get_restaurant_historical_cutover_batch(uuid,uuid)','EXECUTE') as anon_read,
      has_function_privilege('anon','public.get_restaurant_accounting_activation_state(uuid)','EXECUTE') as anon_state`)
    assert.equal(grants.auth_approve, true)
    assert.equal(grants.role_approve, true)
    assert.equal(grants.anon_approve, false)
    assert.equal(grants.anon_read, false)
    assert.equal(grants.anon_state, false)

    const asPreparer = track(await connectAs({ actorId: preparer, lodgeId: lodge, sessionRole: 'admin' }))
    sharedSessions.add(asPreparer)
    const balances = [{ account_id: ids['1000'], equity_account_id: ids['3000'], entry_date: '2026-08-01', amount: 1500 }]
    const prepared = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-01', JSON.stringify(balances), '{}', `cutover-g2-${tag}-1`])
    const batchId = prepared.data.id
    assert.ok(batchId)

    await t.test('preparer cannot approve their own batch, naming the reviewed hash (42501)', async () => {
      const detail = await readBatch(asPreparer, lodge, batchId)
      await rejectsCode(() => approveAs(asPreparer, lodge, batchId, 'Self review with reviewed hash.', evidenceOf(detail)), '42501')
    })

    await t.test('approval without reviewed evidence is rejected (22023), not bypassed', async () => {
      await reapSessions()
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const detail = await readBatch(asReviewer, lodge, batchId)
      const evidence = evidenceOf(detail)
      await rejectsCode(() => result(asReviewer, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)', [lodge, batchId, 'Review with no hash.', null, evidence.source, evidence.preparer]), '22023')
      await rejectsCode(() => result(asReviewer, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)', [lodge, batchId, 'Review with blank hash.', '   ', evidence.source, evidence.preparer]), '22023')
    })

    await t.test('cross-tenant batch access discloses nothing and mutates nothing', async () => {
      await reapSessions()
      const asStranger = track(await connectAs({ actorId: stranger, lodgeId: otherLodge, sessionRole: 'admin' }))
      const foreignList = await result(asStranger, 'public.get_restaurant_historical_cutover_batches($1,$2)', [otherLodge, 20])
      assert.deepEqual(foreignList.data, [])
      const foreignRead = await result(asStranger, 'public.get_restaurant_historical_cutover_batch($1,$2)', [otherLodge, batchId])
      assert.equal(foreignRead.data, null)
      // No such batch exists in the stranger's scope: the not-prepared gate fires.
      await rejectsCode(() => result(asStranger, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)', [otherLodge, batchId, 'Foreign review attempt.', 'x', null, stranger]), '55000')
      // A third lodge deliberately left without the feature stays
      // fail-closed: the entitlement denial discloses nothing either.
      const bareLodge = randomUUID()
      const bareActor = randomUUID()
      await setup.query("insert into public.settings(lodge_id,lodge_name,company_name,business_type,property_type,currency)values($1,'Bare','Bare','restaurant','restaurant','BWP')", [bareLodge])
      await setup.query("insert into public.users(id,lodge_id,name,email,role,password_hash,status)values($1,$2,'bare','bare@example.invalid','admin','not-a-login-hash','active')", [bareActor, bareLodge])
      const asBare = track(await connectAs({ actorId: bareActor, lodgeId: bareLodge, sessionRole: 'admin' }))
      await rejectsCode(() => result(asBare, 'public.get_restaurant_historical_cutover_batches($1,$2)', [bareLodge, 20]), '42501')
    })

    await t.test('read-only actor reads but cannot approve (42501 capability denial)', async () => {
      await reapSessions()
      const asReader = track(await connectAs({ actorId: reader, lodgeId: lodge, sessionRole: 'manager' }))
      const seen = await readBatch(asReader, lodge, batchId)
      assert.equal(seen.data.id, batchId)
      await rejectsCode(() => approveAs(asReader, lodge, batchId, 'Manager review attempt.', evidenceOf(seen)), '42501')
    })

    await t.test('stale opening hash is rejected (23505); the reviewed revision approves', async () => {
      await reapSessions()
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const detail = await readBatch(asReviewer, lodge, batchId)
      const reviewed = evidenceOf(detail)
      assert.ok(reviewed.hash, 'batch carries a nonempty reviewed opening hash')
      assert.ok(reviewed.preparer, 'batch carries preparation identity')
      // The successful review names the exact revision it reviewed — never null.
      await rejectsCode(() => result(asReviewer, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)', [lodge, batchId, 'Review with stale hash.', 'deadbeef', reviewed.source, reviewed.preparer]), '23505')
      const approved = await approveAs(asReviewer, lodge, batchId, 'Verified 1500 against August source exports.', reviewed)
      assert.equal(approved.data.status, 'approved')
      assert.equal(approved.data.opening_payload_hash, reviewed.hash, 'response carries the committed opening hash')
      const reread = await readBatch(asReviewer, lodge, batchId)
      assert.equal(reread.data.status, 'approved')
      assert.equal(reread.data.approved_by, reviewer)
      assert.ok(reread.data.approved_at, 'approval timestamp is recorded (42703 repair)')
      assert.ok(Array.isArray(reread.data.opening_balances) && reread.data.opening_balances.length === 1)
    })

    await t.test('source-only re-preparation cannot commit unreviewed evidence (23505)', async () => {
      await reapSessions()
      // Dedicated batch: a new pre-cutover source row lands; another
      // authorized actor re-prepares the same date/balances/key. The
      // opening hash is unchanged but source and preparer are new.
      const raceBalances = balances.map((line) => ({ ...line, entry_date: '2026-08-08' }))
      const first = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-08', JSON.stringify(raceBalances), '{}', `cutover-g2-${tag}-8`])
      const raceId = first.data.id
      const orderId = randomUUID()
      await setup.query("insert into public.pos_orders(id,lodge_id,status,total,gross_total,discount_total,tax_total,tip_total,payment_method,payment_breakdown,transaction_type,business_date,completed_at)values($1,$2,'completed',110,110,0,0,0,'cash',$3::jsonb,'sale','2026-07-10',now())", [orderId, lodge, JSON.stringify([{ method: 'cash', amount: 110 }])])
      await setup.query("insert into public.pos_order_items(lodge_id,order_id,item_name,quantity,unit_price,subtotal,category,gross_subtotal,discount_allocated,tax_allocated,net_subtotal)values($1,$2,'Meal',1,110,110,'food',110,0,0,110)", [lodge, orderId])
      const asSecond = track(await connectAs({ actorId: checker2, lodgeId: lodge, sessionRole: 'admin' }))
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const before = evidenceOf(await readBatch(asReviewer, lodge, raceId))
      const reprepared = await result(asSecond, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-08', JSON.stringify(raceBalances), '{}', `cutover-g2-${tag}-8`])
      assert.equal(reprepared.data.id, raceId, 'same date/key re-prepares the same batch')
      const after = evidenceOf(await readBatch(asReviewer, lodge, raceId))
      assert.equal(after.hash, before.hash, 'premise: opening hash is unchanged by a source-only change')
      assert.notEqual(after.source, before.source, 'premise: source identity changed')
      assert.equal(after.preparer, checker2, 'premise: preparation identity changed')
      // The reviewer confirmed (H, S1, preparer-A): committing it now would
      // approve evidence never reviewed.
      await rejectsCode(() => approveAs(asReviewer, lodge, raceId, 'Review of superseded evidence.', before), '23505')
      const stillThere = await one(setup, 'select status from public.restaurant_historical_cutover_batches where id=$1', [raceId])
      assert.equal(stillThere.status, 'prepared', 'rejected approval leaves the batch prepared')
      // Renewed review of the current revision succeeds.
      const renewed = await approveAs(asReviewer, lodge, raceId, 'Verified 1500 plus the July order against exports.', after)
      assert.equal(renewed.data.status, 'approved')
    })

    await t.test('preparer-only change is rejected without re-review (23505)', async () => {
      await reapSessions()
      const fresh = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-05', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-05' }))), '{}', `cutover-g2-${tag}-5`])
      const freshId = fresh.data.id
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const seen = evidenceOf(await readBatch(asReviewer, lodge, freshId))
      // Same actor re-prepares with identical content: preparer is
      // rewritten while hashes hold. Approving the earlier identity fails.
      const asSecond = track(await connectAs({ actorId: checker2, lodgeId: lodge, sessionRole: 'admin' }))
      const again = await result(asSecond, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-05', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-05' }))), '{}', `cutover-g2-${tag}-5`])
      assert.equal(again.data.id, freshId)
      const now = evidenceOf(await readBatch(asReviewer, lodge, freshId))
      assert.equal(now.preparer, checker2, 'premise: preparation identity changed')
      await rejectsCode(() => approveAs(asReviewer, lodge, freshId, 'Review of superseded preparer.', seen), '23505')
      const renewed = await approveAs(asReviewer, lodge, freshId, 'Renewed review after re-preparation.', now)
      assert.equal(renewed.data.status, 'approved')
    })

    await t.test('stored-vs-audit source drift without re-preparation stays blocked (55000)', async () => {
      await reapSessions()
      const target = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-06', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-06' }))), '{}', `cutover-g2-${tag}-6`])
      const targetId = target.data.id
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      // Simulate stored evidence lagging the live audit (no re-preparation).
      // Reviewed evidence is read AFTER the lag so the revision binding
      // passes and the under-lock stored-vs-audit drift gate must refuse.
      await setup.query("update public.restaurant_historical_cutover_batches set source_manifest_hash='stale-simulated' where id=$1", [targetId])
      const seen = evidenceOf(await readBatch(asReviewer, lodge, targetId))
      assert.equal(seen.source, 'stale-simulated', 'premise: stored source lags the audit')
      await rejectsCode(() => approveAs(asReviewer, lodge, targetId, 'Review of drifted batch.', seen), '55000')
    })

    await t.test('missing stored opening hash cannot approve (23505 null-safe binding)', async () => {
      await reapSessions()
      const target = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-07', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-07' }))), '{}', `cutover-g2-${tag}-7`])
      const targetId = target.data.id
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const seen = evidenceOf(await readBatch(asReviewer, lodge, targetId))
      // Strip the stored hash: plain SQL <> against null would NOT reject,
      // so the null-safe binding must fire instead.
      await setup.query("update public.restaurant_historical_cutover_batches set control_totals = control_totals - 'opening_payload_hash' where id=$1", [targetId])
      await rejectsCode(() => approveAs(asReviewer, lodge, targetId, 'Review of hashless batch.', seen), '23505')
    })

    await t.test('concurrent approvers serialize: exactly one approval mutation wins', async () => {
      await reapSessions()
      const second = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-02', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-02' }))), '{}', `cutover-g2-${tag}-2`])
      const raceId = second.data.id
      const racerA = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const racerB = track(await connectAs({ actorId: checker2, lodgeId: lodge, sessionRole: 'admin' }))
      const evidence = evidenceOf(await readBatch(racerA, lodge, raceId))
      // Both sessions dispatch without awaiting each other: the row lock
      // serializes the mutations and exactly one winner emerges.
      const attempts = await Promise.allSettled([
        approveAs(racerA, lodge, raceId, 'Race review A.', evidence),
        approveAs(racerB, lodge, raceId, 'Race review B.', evidence)
      ])
      assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one concurrent approval wins')
      assert.equal(attempts.filter((x) => x.status === 'rejected').length, 1, 'the loser is rejected, never double-applied')
      const loserCode = attempts.find((x) => x.status === 'rejected').reason?.code
      assert.equal(loserCode, '55000', 'loser sees the no-longer-prepared gate')
      const winner = await readBatch(racerA, lodge, raceId)
      assert.equal(winner.data.status, 'approved')
      assert.ok([reviewer, checker2].includes(winner.data.approved_by))
    })

    await t.test('prepared batches cannot apply (55000); concurrent applies post once with stored replay', async () => {
      await reapSessions()
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const pending = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-03', JSON.stringify(balances.map((line) => ({ ...line, entry_date: '2026-08-03' }))), '{}', `cutover-g2-${tag}-3`])
      await rejectsCode(() => result(asReviewer, 'public.apply_restaurant_historical_cutover($1,$2)', [lodge, pending.data.id]), '55000')
      // Two INDEPENDENT sessions race the same approved batch.
      const applierA = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const applierB = track(await connectAs({ actorId: checker2, lodgeId: lodge, sessionRole: 'admin' }))
      const [first, replay] = await Promise.all([
        result(applierA, 'public.apply_restaurant_historical_cutover($1,$2)', [lodge, batchId]),
        result(applierB, 'public.apply_restaurant_historical_cutover($1,$2)', [lodge, batchId])
      ])
      assert.equal(first.data.status, 'applied')
      const postings = first.data.opening_postings
      assert.equal(postings.length, 1)
      assert.equal(postings[0].idempotency_key, `cutover:${batchId}:opening:${ids['1000']}`)
      assert.deepEqual(replay.data.opening_postings, postings, 'replay returns the stored references')
      const journals = await one(setup, 'select count(*)::int as n from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id = e.id where e.lodge_id = $1 and l.account_id = $2', [lodge, ids['1000']])
      assert.equal(journals.n, 1, 'exactly one financial effect across the race')
      const reread = await readBatch(asReviewer, lodge, batchId)
      assert.equal(reread.data.status, 'applied')
      assert.ok(reread.data.applied_at, 'applied timestamp is recorded (42703 repair)')
    })

    await t.test('invalid posting data rolls back with no NEW partial effects', async () => {
      await reapSessions()
      // Second line is invalid (zero amount): the single-statement function
      // transaction must post nothing, not a partial first line. Counts are
      // scoped before/after because earlier tests legitimately posted.
      // Invalid shape, fresh accounts: ids['4000']/ids['5000'] have never
      // been opened, so the apply reaches line 2 and fails 22023 there.
      // (Reusing ids['1000'] would collide with the earlier successful
      // posting on the source-dedup index instead of exercising validation.)
      const twoLines = [
        { account_id: ids['4000'], equity_account_id: ids['3000'], entry_date: '2026-08-04', amount: 700 },
        { account_id: ids['5000'], equity_account_id: ids['3000'], entry_date: '2026-08-04', amount: 0 }
      ]
      const bad = await result(asPreparer, 'public.prepare_restaurant_historical_cutover($1,$2,$3::jsonb,$4::jsonb,$5)', [lodge, '2026-08-04', JSON.stringify(twoLines), '{}', `cutover-g2-${tag}-4`])
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const detail = await readBatch(asReviewer, lodge, bad.data.id)
      await rejectsCode(() => approveAs(asReviewer, lodge, bad.data.id, 'Review of invalid batch.', evidenceOf(detail)), '22023')
      // Force the apply path open on the same invalid shape via privileged
      // setup (status flip only; balances untouched) to prove the apply
      // transaction is atomic.
      await setup.query("update public.restaurant_historical_cutover_batches set status='approved', approved_by=$2 where id=$1 and lodge_id=$3", [bad.data.id, reviewer, lodge])
      const before = await one(setup, 'select count(*)::int as n from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id = e.id where e.lodge_id = $1 and l.account_id = any($2)', [lodge, [ids['1000'], ids['4000']]])
      await rejectsCode(() => result(asReviewer, 'public.apply_restaurant_historical_cutover($1,$2)', [lodge, bad.data.id]), '22023')
      const after = await one(setup, 'select count(*)::int as n from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id = e.id where e.lodge_id = $1 and l.account_id = any($2)', [lodge, [ids['1000'], ids['4000']]])
      assert.equal(after.n, before.n, 'failed apply posts no new journals')
      assert.equal(after.n, 1, 'the earlier successful posting is retained')
      const stillThere = await one(setup, 'select status from public.restaurant_historical_cutover_batches where id=$1', [bad.data.id])
      assert.equal(stillThere.status, 'approved', 'failed apply leaves batch state untouched')
    })

    await t.test('readiness is fully satisfied before activation; tuple readback is complete', async () => {
      await reapSessions()
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const readiness = await result(asReviewer, 'public.get_restaurant_accounting_readiness($1)', [lodge])
      assert.equal(readiness.data.ready, true, `readiness must be green before activation, got ${JSON.stringify(readiness.data)}`)
      assert.deepEqual(readiness.data.missing_requirements, [])
      const activated = await result(asReviewer, 'public.activate_restaurant_accounting($1,$2,$3,$4,$5)', [lodge, '2026-09-01', '2026-09-pilot', 'bar-accounting-financial-truth-v1', batchId])
      assert.equal(activated.data.status, 'active')
      const state = await result(asReviewer, 'public.get_restaurant_accounting_activation_state($1)', [lodge])
      assert.equal(state.data.lodge_id, lodge)
      assert.equal(state.data.status, 'active')
      assert.equal(state.data.active, true)
      assert.equal(String(state.data.effective_from).slice(0, 10), '2026-09-01')
      assert.equal(state.data.configuration_version, '2026-09-pilot')
      assert.equal(state.data.policy_version, 'bar-accounting-financial-truth-v1')
      assert.equal(state.data.historical_cutover_batch_id, batchId)
    })

    await t.test('future-effective activation reads scheduled, not currently active', async () => {
      await reapSessions()
      const asReviewer = track(await connectAs({ actorId: reviewer, lodgeId: lodge, sessionRole: 'admin' }))
      const future = await result(asReviewer, 'public.activate_restaurant_accounting($1,$2,$3,$4,$5)', [lodge, '2099-01-01', '2099-future', 'bar-accounting-financial-truth-v1', batchId])
      assert.equal(future.data.status, 'active')
      const state = await result(asReviewer, 'public.get_restaurant_accounting_activation_state($1)', [lodge])
      assert.equal(state.data.status, 'active')
      assert.equal(state.data.active, false, 'future-effective rows are scheduled, not currently active')
      const suspended = await result(asReviewer, 'public.suspend_restaurant_accounting($1,$2)', [lodge, 'Pilot pause for review.'])
      assert.equal(suspended.status, 'suspended')
      const retained = await readBatch(asReviewer, lodge, batchId)
      assert.equal(retained.data.status, 'applied', 'suspension preserves applied history')
    })

    await t.test('anonymous callers are denied at the grant layer (42501)', async () => {
      await reapSessions()
      const asAnon = track(await connectAs({ dbRole: 'anon', actorId: preparer, lodgeId: lodge, sessionRole: 'admin' }))
      await rejectsCode(() => result(asAnon, 'public.get_restaurant_historical_cutover_batches($1,$2)', [lodge, 20]), '42501')
      await rejectsCode(() => result(asAnon, 'public.get_restaurant_accounting_activation_state($1)', [lodge]), '42501')
      await rejectsCode(() => result(asAnon, 'public.approve_restaurant_historical_cutover($1,$2,$3,$4,$5,$6)', [lodge, batchId, 'Anon review.', 'x', null, preparer]), '42501')
    })
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})))
    await closeAll()
  }
})
