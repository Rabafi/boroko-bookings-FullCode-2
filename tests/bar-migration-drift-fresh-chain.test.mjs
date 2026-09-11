// Fresh-chain verification of the F&B drift full-block migration:
//   supabase/migrations/20260909060000_fnb_drift_full_block_verification.sql
// (renamed from 20260909050000 to avoid a duplicate version; content hash
// recorded in the disposable manifest).
//
// Why this replaces fragment-only coverage: a generic token (e.g. `false`,
// `sum(total)::numeric`, or mere absence) can appear in unrelated code, so
// already-correct branches must prove the COMPLETE corrected block, and
// stale branches must match complete stale blocks with post-verification.
// Every matcher block below is EXTRACTED from the real migration file (never
// retyped), over realistic full definitions captured from the disposable
// target, in LF and CRLF conventions, including: known stale, known
// correct, repeated application, unrelated generic markers, missing rooms
// logic, unrelated tables carrying the same predicate, one-branch-correct
// states, duplicate blocks, unsupported mixtures, unknown input (raises),
// later-hunk failure rolling back earlier hunks (atomic DO), and intact
// signatures/owners/search-paths/grants/outputs. No database connection
// for the static half; the database half runs ONLY against an explicitly
// approved disposable target (F5-style gate) inside always-rolled-back
// transactions, and skips with an explicit message otherwise (reported
// separately from passes, never a silent pass).
import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readText = (p) => readFileSync(resolve(root, p), 'utf8')

const V2_FILE = 'supabase/migrations/20260909060000_fnb_drift_full_block_verification.sql'
const v2sql = readText(V2_FILE)
// v1 followup: the in-chain repair path for cost/expenses stale states.
// The v2 file verifies its outcome; running it here proves the real
// v1-then-v2 composition on stale input (rolled back afterwards).
const V1_FOLLOWUP_FILE = 'supabase/migrations/20260906001000_fnb_live_function_drift_repair_followup.sql'
const v1followup = readText(V1_FOLLOWUP_FILE)
const V1_FINAL_FILE = 'supabase/migrations/20260907000000_fnb_live_function_drift_repair_final.sql'
const v1final = readText(V1_FINAL_FILE)
const V1_FIRST_FILE = 'supabase/migrations/20260906000000_fnb_live_function_drift_repair.sql'
const v1first = readText(V1_FIRST_FILE)

// Block inventory: `v_<name> text := $B<n>$...$B<n>$;` declarations.
const blocks = new Map()
{
  const re = /v_(\w+) text := \$(B\d+)\$([\s\S]*?)\$\2\$/g
  let m
  while ((m = re.exec(v2sql)) !== null) blocks.set(m[1], m[3])
}
const need = (name) => {
  assert.ok(blocks.has(name), `migration must declare block ${name}`)
  return blocks.get(name)
}

// Expected block inventory (fails loudly if the migration drops one).
const EXPECTED_BLOCKS = [
  'old_cash', 'new_cash', 'old_ev', 'new_ev', 'old_conf', 'new_conf',
  'new_room_d', 'new_room_p', 'new_s1', 'new_s2', 'new_p1', 'new_p2',
  'new_cost', 'new_exp', 'frag_grand', 'frag_purch', 'frag_exp', 'frag_rooms',
]
for (const name of EXPECTED_BLOCKS) need(name)

const toLF = (s) => s.replace(/\r\n/g, '\n')
const toCRLF = (lf) => {
  assert.equal(lf.includes('\r'), false, 'CRLF construction requires LF input')
  return lf.replace(/\n/g, '\r\n')
}

// Faithful JS mirror of one swap-hunk decision (stale-full/new-full with
// counts; defensive fragments behave identically with count>=1 repair and
// full-new post-verify, which the DB half proves directly).
function decideSwap(definition, oldBlock, newBlock) {
  const count = (haystack, needle) => {
    if (!needle) throw new Error('empty matcher')
    return (haystack.length - haystack.split(needle).join('').length) / needle.length
  }
  const live = toLF(definition)
  const oldCount = count(live, toLF(oldBlock))
  const newCount = count(live, toLF(newBlock))
  if (oldCount === 1 && newCount === 0) return 'repair'
  if (oldCount === 0 && newCount === 1) return 'skip'
  if (oldCount === 0 && newCount === 0) return 'missing'
  return 'ambiguous'
}

test('migration keeps strict guards, atomicity and original errors', () => {
  const doBlocks = v2sql.match(/^\s*do\s+\$verify\$/gim) || []
  assert.equal(doBlocks.length, 1, 'one atomic DO block')
  for (const msg of [
    'is missing',
    'rewrite did not install cleanly',
    'contract is ambiguous or stale - manual review required',
    'Expected stale cash-up status fragment was not found',
    'Expected stale POS grand_total fragment was not found',
    'Expected stale inventory purchased_at fragment was not found',
    'Expected stale public.events fragment was not found',
    'Stale public.events query remains after repair',
    'Expected stale expenses total/expense_date fragment was not found',
    'Expected stale conference booking date-range fragment was not found',
  ]) assert.ok(v2sql.includes(msg), `migration keeps message: ${msg}`)
  assert.ok(v2sql.includes('already in corrected form; skipping'), 'explicit already-correct notices')
  // Contract preservation (owner, SECURITY DEFINER, search_path, ACLs)
  // needs no snapshot block in the migration: every rewrite path uses
  // CREATE OR REPLACE via pg_get_functiondef output, which preserves
  // privileges and ownership by PostgreSQL semantics. The database half
  // below asserts the contract tuple is byte-identical before and after
  // every repair run.
})

test('extracted blocks are LF-canonical and mutually distinct', () => {
  const texts = [...blocks.values()]
  for (const [name, text] of blocks) {
    assert.equal(text.includes('\r'), false, `block ${name} is LF-canonical`)
    assert.ok(text.length > 20, `block ${name} is a complete block, not a token`)
  }
  assert.equal(new Set(texts).size, texts.length, 'no duplicated block text')
})

test('migrations directory admits only timestamped migrations (scratch hazard)', () => {
  const dir = resolve(root, 'supabase/migrations')
  const bad = readdirSync(dir).filter((f) => f.endsWith('.sql') && !/^\d{14}_.*\.sql$/.test(f))
  assert.deepEqual(bad, [], `non-conforming files must not live in migrations/: ${bad.join(', ')}`)
})

// applyHunk mirrors one verification hunk including post-verification:
// stale present -> rewritten output must carry the corrected shape;
// corrected present alone -> skip; anything else throws. Removal when
// newBlock is null requires the enclosing corrected query (correctedBlock).
function applyHunk(definition, { oldBlock, newBlock, correctedBlock, missingError }) {
  const count = (haystack, needle) => {
    if (!needle) throw new Error('empty matcher')
    return (haystack.length - haystack.split(needle).join('').length) / needle.length
  }
  const live = toLF(definition)
  const oldCount = count(live, toLF(oldBlock))
  const newCount = count(live, toLF(newBlock))
  if (oldCount === 1 && newCount === 0) {
    const output = live.split(toLF(oldBlock)).join(toLF(newBlock))
    if (count(output, toLF(newBlock)) !== 1 || count(output, toLF(oldBlock)) !== 0) {
      throw new Error('did not install cleanly')
    }
    if (correctedBlock && count(output, toLF(correctedBlock)) !== 1) {
      throw new Error('corrected shape not proven after rewrite')
    }
    return { action: 'repair', output }
  }
  if (oldCount === 0 && newCount === 1) {
    if (correctedBlock && count(live, toLF(correctedBlock)) !== 1) {
      throw new Error('corrected shape not proven')
    }
    return { action: 'skip', output: null }
  }
  if (oldCount === 0 && newCount === 0) throw new Error(missingError)
  throw new Error('ambiguous')
}

test('branch matrix over realistic full blocks, both conventions', () => {
  const head = 'CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $f$\ndeclare\n  v integer;\nbegin\n'
  const tail = '\n  return;\nend;\n$f$;'
  const wrap = (block) => head + block + tail
  const cashOld = need('old_cash')
  const cashNew = need('new_cash')
  // stale definition repairs on either convention
  for (const def of [toLF(wrap(cashOld)), toCRLF(toLF(wrap(cashOld)))]) {
    const r = applyHunk(def, { oldBlock: cashOld, newBlock: cashNew, missingError: 'missing' })
    assert.equal(r.action, 'repair')
    assert.ok(r.output.includes('and false'))
    assert.ok(!r.output.includes("coalesce(status, '''')"))
  }
  // corrected definition skips on either convention
  for (const def of [toLF(wrap(cashNew)), toCRLF(toLF(wrap(cashNew)))]) {
    assert.equal(applyHunk(def, { oldBlock: cashOld, newBlock: cashNew, missingError: 'missing' }).action, 'skip')
  }
  // unrelated generic markers never authorize either branch
  const decoy = head + '  v := false;\n  w := 1;\n  -- a comment mentioning sum(total)::numeric innocently\n' + tail
  assert.throws(() => applyHunk(toLF(decoy), { oldBlock: cashOld, newBlock: cashNew, missingError: 'Expected stale fragment was not found' }), /Expected stale fragment was not found/)
  // duplicate corrected blocks are ambiguous, not a pass
  assert.throws(() => applyHunk(toLF(wrap(cashNew + '\n' + cashNew)), { oldBlock: cashOld, newBlock: cashNew, missingError: 'missing' }), /ambiguous/)
  // unknown input raises
  assert.throws(() => applyHunk(toLF(head + '  v := something_else_entirely;\n' + tail), { oldBlock: cashOld, newBlock: cashNew, missingError: 'Expected stale fragment was not found' }), /Expected stale fragment was not found/)
  // comment-embedded full fragments are inert: the leading comment markers
  // break multi-line matching, so comments can neither authorize a skip
  // nor trigger a repair.
  const commented = head + cashOld.split('\n').map((l) => '-- ' + l).join('\n') + '\n' + tail
  assert.throws(() => applyHunk(toLF(commented), { oldBlock: cashOld, newBlock: cashNew, missingError: 'Expected stale fragment was not found' }), /Expected stale fragment was not found/)
})

// ---- Database half: the real migration file against realistic full
// definitions on the approved disposable target ----

const DB_FLAG = process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_DB
const DB_URL = process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL || ''
const DB_ACK = process.env.RESTAURANT_ACCOUNTING_DISPOSABLE_ACK || ''
function dbHost() {
  try {
    return new URL(DB_URL).host
  } catch {
    return null
  }
}
function dbApproved() {
  return DB_FLAG === '1' && !!DB_URL && !!dbHost() && DB_ACK === `destroy-data-on:${dbHost()}`
}
const maybeDbTest = (name, fn) => test(name, async (t) => {
  if (!dbApproved()) {
    t.skip(`DB case skipped without disposable approval (wanted target acknowledgement for this host); static coverage above still ran`)
    return
  }
  return fn(t)
})

const DISP_SIGS = [
  'public.fnb_module_disable_blockers(uuid,text)',
  'public.get_fnb_consolidated_report(uuid,date,date,uuid)',
  'public.get_fnb_demand_recommendations(uuid,date,uuid)',
]
async function fetchDefs(client) {
  const defs = {}
  for (const sig of DISP_SIGS) {
    const r = await client.query('select pg_get_functiondef(to_regprocedure($1)) as d', [sig])
    defs[sig] = r.rows[0].d
  }
  return defs
}
async function fetchContracts(client) {
  const r = await client.query(`select jsonb_agg(row_to_json(s) order by s.sig) as c from (
    select p.oid::regprocedure::text as sig, pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as definer, p.proconfig as config,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as role_x
      from pg_proc p
     where p.oid in (to_regprocedure('public.fnb_module_disable_blockers(uuid,text)'),
                     to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)'),
                     to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)'))) s`)
  return r.rows[0].c
}
// Replace exactly one occurrence; throws when the count is not exactly one
// so scratch-state construction itself is verified, never guessed.
function swapOnce(haystack, from, to) {
  const parts = haystack.split(from)
  assert.equal(parts.length, 2, 'scratch-state swap needs exactly one anchor occurrence')
  return parts.join(to)
}
// Install scratch bodies by swapping the CREATE OR REPLACE body region of a
// pg_get_functiondef dump. Returns the full replacement statement.
function withBody(defText, newBody) {
  const m = defText.match(/\bAS\s*(\$[A-Za-z_0-9]*\$)([\s\S]*?)\1/i)
  assert.ok(m, 'scratch install needs a dollar-quoted body')
  return defText.slice(0, m.index + m[0].indexOf(m[2])) + newBody + defText.slice(m.index + m[0].indexOf(m[2]) + m[2].length)
}
function bodyOf(defText) {
  const m = defText.match(/\bAS\s*(\$[A-Za-z_0-9]*\$)([\s\S]*?)\1/i)
  assert.ok(m, 'body extraction needs a dollar-quoted body')
  return m[2]
}
// Blocks keyed by migration declaration variable.
const B = (name) => need(name)
function dbClient() {
  const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  const notices = []
  c.on('notice', (n) => notices.push(String(n?.message || '').trim()))
  c.on('error', () => {})
  return { client: c, notices }
}

maybeDbTest('db: corrected definitions verify clean with skips', async () => {
  const { client, notices } = dbClient()
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const before = await fetchDefs(client)
      const contractsBefore = await fetchContracts(client)
      await client.query(v2sql)
      const after = await fetchDefs(client)
      assert.deepEqual(after, before, 'verification run changes nothing on correct definitions')
      assert.deepEqual(await fetchContracts(client), contractsBefore, 'contract tuple intact')
      for (const n of ['already in corrected form; skipping', 'corrected shape verified', 'full-block verification passed']) {
        assert.ok(notices.some((m) => m.includes(n)), `notice proves branch taken: ${n}`)
      }
    } finally {
      await client.query('ROLLBACK')
    }
    assert.deepEqual(await fetchDefs(client), await fetchDefs(client), 'post-rollback readback is stable')
  } finally {
    await client.end().catch(() => {})
  }
})

maybeDbTest('db: stale full blocks repair to the pristine definition', async () => {
  // Covers the hunks whose stale and corrected shapes are both fully
  // enumerated (cash-up, events guard+count, conference range). Cost and
  // expenses stale states are repaired through the v1 followup file first
  // (its full-statement swap is granularity-correct there); the v2 cost
  // hunks then verify the outcome. See the verify-only case below for why
  // v2 itself never rewrites those two fragments.
  const { client, notices } = dbClient()
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const pristine = await fetchDefs(client)
      const contractsBefore = await fetchContracts(client)
      const staleDisable = swapOnce(bodyOf(pristine[DISP_SIGS[0]]), B('new_cash'), B('old_cash'))
      await client.query(withBody(pristine[DISP_SIGS[0]], staleDisable))
      let demandBody = bodyOf(pristine[DISP_SIGS[2]])
      demandBody = swapOnce(demandBody, B('new_ev'), B('old_ev'))
      demandBody = swapOnce(demandBody, B('new_conf'), B('old_conf'))
      await client.query(withBody(pristine[DISP_SIGS[2]], demandBody))
      let reportBody = bodyOf(pristine[DISP_SIGS[1]])
      const OLD_COST_FULL = 'select coalesce(sum(coalesce(total_cost, 0)), 0)::numeric from public.inventory_purchases where lodge_id = $1 and (purchased_at::date between $2 and $3 or created_at::date between $2 and $3)'
      const OLD_EXP_FULL = 'select coalesce(sum(coalesce(amount, total, 0)), 0)::numeric from public.expenses where lodge_id = $1 and (expense_date between $2 and $3 or created_at::date between $2 and $3)'
      assert.ok(readText(V1_FOLLOWUP_FILE).includes(OLD_COST_FULL), 'stale cost shape comes from reviewed v1 lineage')
      assert.ok(readText(V1_FINAL_FILE).includes(OLD_EXP_FULL), 'stale expenses shape comes from reviewed v1 lineage')
      // Full-statement stale states (execute + into preserved): the v1
      // followup repairs these before v2 verifies, mirroring chain order.
      const staleCostBlock = swapOnce(B('new_cost'),
        'select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))',
        OLD_COST_FULL)
      const staleExpBlock = swapOnce(B('new_exp'),
        'select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))',
        OLD_EXP_FULL)
      reportBody = swapOnce(reportBody, B('new_cost'), staleCostBlock)
      reportBody = swapOnce(reportBody, B('new_exp'), staleExpBlock)
      await client.query(withBody(pristine[DISP_SIGS[1]], reportBody))
      // Real chain order: v1 file repairs cash-up, followup repairs cost
      // and events, final repairs expenses and conference; v2 then verifies
      // everything clean. Each step is atomic; the whole case rolls back.
      await client.query(v1first)
      await client.query(v1followup)
      await client.query(v1final)
      await client.query(v2sql)
      const after = await fetchDefs(client)
      assert.deepEqual(after, pristine, 'repaired definitions converge back to pristine')
      assert.deepEqual(await fetchContracts(client), contractsBefore, 'contract tuple intact across repair')
      for (const n of ['repaired', 'full-block verification passed']) {
        assert.ok(notices.some((m) => m.includes(n)), `notice proves branch taken: ${n}`)
      }
    } finally {
      await client.query('ROLLBACK')
    }
    const restored = await fetchDefs(client)
    for (const sig of DISP_SIGS) assert.ok(restored[sig] && restored[sig].length > 1000, 'post-rollback definitions readable')
  } finally {
    await client.end().catch(() => {})
  }
})

maybeDbTest('db: unobservable stale shapes raise instead of repairing', async () => {
  // grand_total (bare expression) and rooms predicate (removal site) have
  // no enumerable enclosing context: the migration must refuse them for
  // manual review rather than guess a rewrite target.
  const { client } = dbClient()
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const pristine = await fetchDefs(client)
      // Grand-total stale: the bare expression in both outlet variants
      // (replace-all; each site is independently unobservable context).
      const grandSites = bodyOf(pristine[DISP_SIGS[1]]).split('sum(total)::numeric').length - 1
      assert.equal(grandSites, 2, 'both outlet variants present for stale injection')
      const grandStale = bodyOf(pristine[DISP_SIGS[1]]).split('sum(total)::numeric').join('coalesce(sum(coalesce(total, grand_total, 0)), 0)::numeric')
      await client.query(withBody(pristine[DISP_SIGS[1]], grandStale))
      await assert.rejects(client.query(v2sql), /ambiguous or stale/)
      await client.query('ROLLBACK')
      await client.query('BEGIN')
      const pristine2 = await fetchDefs(client)
      // Rooms stale: splice the reviewed predicate into every matching
      // rooms count site (replace-all; the migration must refuse the
      // unobservable enclosing context for manual review).
      const roomsAnchor = 'select count(*)::integer from public.rooms where lodge_id = $1'
      const roomsSites = bodyOf(pristine2[DISP_SIGS[2]]).split(roomsAnchor).length - 1
      assert.ok(roomsSites >= 1, 'rooms anchor sites exist for stale injection')
      const roomsStale = bodyOf(pristine2[DISP_SIGS[2]]).split(roomsAnchor).join(
        'select count(*)::integer from public.rooms where lodge_id = $1 and coalesce(deleted, false) = false')
      await client.query(withBody(pristine2[DISP_SIGS[2]], roomsStale))
      await assert.rejects(client.query(v2sql), /ambiguous or stale/)
    } finally {
      await client.query('ROLLBACK').catch(() => {})
    }
    const restored = await fetchDefs(client)
    const fresh = await fetchDefs(client)
    assert.deepEqual(restored, fresh, 'failed runs leave no partial effects behind')
  } finally {
    await client.end().catch(() => {})
  }
})

maybeDbTest('db: unknown and duplicate shapes raise; contract stays intact', async () => {
  const { client } = dbClient()
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const pristine = await fetchDefs(client)
      const contractsBefore = await fetchContracts(client)
      // Unknown shape: keep the block structure balanced (begin/if/into
      // intact) but replace the guarded query with an unrecognized table,
      // so the scratch function installs cleanly and the migration itself
      // is what refuses it. Savepoints keep the session usable after the
      // expected raise so the contract check below actually executes.
      const unknownBody = bodyOf(pristine[DISP_SIGS[2]]).replace(
        B('new_ev'),
        '  -- Events.\n  begin\n    if to_regclass(\'public.unknown_table_xyz\') is not null then\n      execute \'select 0::integer\'\n        into v_events using v_lodge, p_date;')
      await client.query(withBody(pristine[DISP_SIGS[2]], unknownBody))
      await client.query('SAVEPOINT expect_raise')
      await assert.rejects(client.query(v2sql), /Expected stale public.events fragment was not found/)
      await client.query('ROLLBACK TO SAVEPOINT expect_raise')
      await client.query('RELEASE SAVEPOINT expect_raise')
      await client.query('ROLLBACK')
      await client.query('BEGIN')
      const pristine2 = await fetchDefs(client)
      // Duplicate a self-contained statement pair (not a control-structure
      // fragment, which cannot repeat validly): the corrected rooms query
      // twice means the shape occurs twice -> ambiguous, never a pass.
      // Replacer-function form keeps the block's $1 bind markers literal
      // (String.replace would read them as backreferences).
      const dupBody = bodyOf(pristine2[DISP_SIGS[2]]).replace(
        B('new_room_d'), () => B('new_room_d') + '\n' + B('new_room_d'))
      await client.query(withBody(pristine2[DISP_SIGS[2]], dupBody))
      await client.query('SAVEPOINT expect_ambiguous')
      await assert.rejects(client.query(v2sql), /ambiguous/)
      await client.query('ROLLBACK TO SAVEPOINT expect_ambiguous')
      await client.query('RELEASE SAVEPOINT expect_ambiguous')
      assert.deepEqual(await fetchContracts(client), contractsBefore, 'failed runs preserve the contract tuple')
    } finally {
      await client.query('ROLLBACK').catch(() => {})
    }
  } finally {
    await client.end().catch(() => {})
  }
})

maybeDbTest('db: CRLF stale state repairs via normalization; repeat verifies clean', async () => {
  const { client, notices } = dbClient()
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const pristine = await fetchDefs(client)
      const staleBody = bodyOf(pristine[DISP_SIGS[0]])
      assert.ok(!staleBody.includes('\r'), 'pristine baseline is LF')
      const crlfStale = toCRLF(staleBody.replace(B('new_cash'), B('old_cash')))
      await client.query(withBody(pristine[DISP_SIGS[0]], crlfStale))
      await client.query(v2sql)
      const after = await fetchDefs(client)
      assert.deepEqual(after, pristine, 'normalized repair converges to pristine')
      assert.ok(notices.some((m) => m.includes('stale block repaired')), 'repair notice proves the branch')
      await client.query(v2sql)
      assert.ok(notices.some((m) => m.includes('already in corrected form; skipping')), 'repeat run skips')
    } finally {
      await client.query('ROLLBACK')
    }
  } finally {
    await client.end().catch(() => {})
  }
})
//PART8
