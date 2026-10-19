// Real PostgreSQL tests. JSON verifier cases are synthetic contract inputs;
// database reads/role checks below are integration evidence, never normal clicks.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { connectLedgerDisposableDatabase } from './helpers/ledger-disposable-connection.mjs'
import { reportBlocked, DisposableDatabaseBlocked } from './helpers/luna-disposable-database.mjs'
import { randomUUID } from 'node:crypto'

let connected
try {
  connected = await connectLedgerDisposableDatabase()
  if (!process.env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION) throw new DisposableDatabaseBlocked('A securely configured approved genuine staff session is required before fixture mutation.')
  // Privileged setup and actual client assertions stay separate. This wrapper
  // call must pass genuine app-session authorization; no invented actor claims.
  await connected.client.query('begin read only')
  await connected.client.query('set local role anon')
  await connected.client.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [process.env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION])
  await connected.client.query("select public.get_restaurant_financial_source_coverage($1,'2199-01-01','2199-01-02')", ['4509e4c0-a10f-406a-9918-b83664e8bbee'])
  await connected.client.query('rollback')
} catch (error) {
  await connected?.client.query('rollback').catch(() => {})
  await connected?.client.end().catch(() => {})
  connected = null
  if (!(error instanceof DisposableDatabaseBlocked)) error = new DisposableDatabaseBlocked('Approved staff-session wrapper preflight failed (' + (error?.code || 'SQL') + '); server details suppressed.')
  if (!reportBlocked(error)) throw error
}
if (connected) {
  const db = connected.client
  const lodge = '4509e4c0-a10f-406a-9918-b83664e8bbee' // retained authorized synthetic lodge, not new Auth fixture
  await db.query('begin')
  await db.query("set local statement_timeout='15s'")
  after(async () => { await db.query('rollback'); await db.end() })
  const base = { lodge_id: lodge, source_id: '00000000-0000-4000-8000-000000000001', journal_entry_id: '00000000-0000-4000-8000-000000000002',
    business_date: '2026-10-13', source_version: 1, source_payload_hash: 'canonical-source', journal_payload_hash: 'canonical-journal',
    journal_source_type: 'manual', posting_key: 'same-operation', provenance_verified: true, approved: true,
    lines: [{ account_id: '00000000-0000-4000-8000-000000000003', debit: 10, credit: 0 }, { account_id: '00000000-0000-4000-8000-000000000004', debit: 0, credit: 10 }] }
  const actual = { ...base, journal_lodge_id: lodge, journal_source_id: base.source_id, journal_date: base.business_date, status: 'posted', is_posted: true, shared_journal_count: 1 }
  async function check(expected, postings) {
    try { return (await db.query('select public.restaurant_financial_evidence_check_v4($1::jsonb,$2::jsonb) as result', [JSON.stringify(expected), JSON.stringify(postings)])).rows[0].result }
    catch (error) { throw new Error('PostgreSQL verifier failed: ' + (error?.code || 'unknown SQL error')) }
  }
  test('PostgreSQL valid exact identity/date/version/hash/financial lines', async () => { assert.equal((await check(base, [actual])).complete, true) })
  for (const [label, change] of [
    ['different same-day UUID', { source_id: '00000000-0000-4000-8000-000000000099' }],
    ['wrong source lodge', { lodge_id: '00000000-0000-4000-8000-000000000099' }],
    ['wrong journal lodge', { journal_lodge_id: '00000000-0000-4000-8000-000000000099' }],
    ['unposted journal', { is_posted: false }], ['wrong source business date', { business_date: '2026-10-14' }],
    ['wrong journal date', { journal_date: '2026-10-14' }], ['changed source version', { source_version: 2 }],
    ['wrong manual operation payload hash', { source_payload_hash: 'operation-id-was-changed-without-original-rehash' }], ['changed journal hash', { journal_payload_hash: 'changed' }],
    ['wrong manual journal posting key', { posting_key: 'manual-journal:replacement-operation' }],
    ['different journal source UUID', { journal_source_id: '00000000-0000-4000-8000-000000000099' }],
    ['different linked journal', { journal_entry_id: '00000000-0000-4000-8000-000000000099' }],
    ['shared journal', { shared_journal_count: 2 }], ['unexpected pending', { status: 'pending' }],
    ['failed/exception', { status: 'exception' }], ['stale/reversed', { status: 'reversed' }]
  ]) test('PostgreSQL refuses ' + label, async () => { assert.equal((await check(base, [{ ...actual, ...change }])).complete, false) })
  test('PostgreSQL legacy missing canonical provenance is unverified', async () => { assert.equal((await check({ ...base, provenance_verified: false, source_payload_hash: null }, [actual])).complete, false) })
  test('PostgreSQL independent checker required', async () => { assert.equal((await check({ ...base, approved: false }, [actual])).complete, false) })
  test('PostgreSQL balanced wrong class amounts fail', async () => { assert.equal((await check(base, [{ ...actual, lines: actual.lines.map(l => ({ ...l, debit: l.debit * 2, credit: l.credit * 2 })) }])).complete, false) })
  test('PostgreSQL balanced wrong account allocation fails', async () => { assert.equal((await check(base, [{ ...actual, lines: actual.lines.map(l => ({ ...l, account_id: '00000000-0000-4000-8000-000000000099' })) }])).complete, false) })
  test('PostgreSQL duplicate aliases/source versions fail', async () => { assert.equal((await check(base, [actual, actual])).complete, false) })
  test('PostgreSQL orphan/missing posting fails', async () => { assert.equal((await check(base, [])).complete, false) })
  test('PostgreSQL repeated equal values remain a multiset', async () => {
    const lines = [...base.lines, ...base.lines]
    assert.equal((await check({ ...base, lines }, [{ ...actual, lines }])).complete, true)
    assert.equal((await check({ ...base, lines }, [actual])).complete, false)
  })
  test('PostgreSQL equal-valued independent identities reconcile separately', async () => {
    const second = { ...base, source_id: '00000000-0000-4000-8000-000000000098', journal_entry_id: '00000000-0000-4000-8000-000000000097' }
    assert.equal((await check(base, [actual])).complete, true)
    assert.equal((await check(second, [{ ...actual, ...second, journal_source_id: second.source_id }])).complete, true)
  })
  test('PostgreSQL business-date helper honors the lodge timezone at midnight and explicit stored dates win', async () => {
    const r = (await db.query(`with setting as (
        select coalesce(nullif(btrim(timezone),''),'Africa/Gaborone') as zone from public.settings where lodge_id=$1
      ), boundary as (
        select timestamp '2026-10-13 00:00:00' at time zone zone as instant,zone from setting
      )
      select public.pos_business_date_at($1,instant-interval '1 second')::text as before_midnight,
        public.pos_business_date_at($1,instant)::text as at_midnight,
        (instant at time zone zone)::date::text as timezone_expected,
        coalesce('2026-10-11'::date,public.pos_business_date_at($1,instant))::text as explicit_date
      from boundary`, [lodge])).rows[0]
    assert.deepEqual(r, { before_midnight: '2026-10-12', at_midnight: '2026-10-13', timezone_expected: '2026-10-13', explicit_date: '2026-10-11' })
  })
  test('PostgreSQL snapshots and expected IDs match EXACT sets for every registry family', async () => {
    const r = await db.query("select source_type from public.restaurant_financial_source_registry order by source_type")
    for (const row of r.rows) {
      const args = [lodge, row.source_type, '2026-01-01', '2026-12-31']
      const snapshot = (await db.query('select public.restaurant_financial_source_snapshot($1,$2,$3,$4) as s', args)).rows[0].s
      const ids = (await db.query('select source_id::text,business_date::text from public.restaurant_financial_source_expected_ids_v3($1,$2,$3,$4) order by source_id', args)).rows
      assert.deepEqual(snapshot.source_ids, ids)
      assert.equal(Number(snapshot.row_count), ids.length)
    }
  })
  test('PostgreSQL manual expected population is exactly posted governed drafts plus ungoverned legacy journals', async () => {
    const range = ['2026-01-01', '2026-12-31']
    const expected = (await db.query(`
      select d.id::text as source_id,d.entry_date::text as business_date
        from public.restaurant_manual_journal_drafts d
       where d.lodge_id=$1 and d.status='posted' and d.entry_date between $2::date and $3::date
      union all
      select j.id::text as source_id,j.entry_date::text as business_date
        from public.restaurant_journal_entries j
       where j.lodge_id=$1 and j.is_posted and j.entry_date between $2::date and $3::date
         and j.source_type in ('manual','manual_journal')
         and not exists(select 1 from public.restaurant_manual_journal_drafts d
           where d.lodge_id=$1 and d.journal_entry_id=j.id and d.status='posted')
       order by source_id`, [lodge, ...range])).rows
    const actual = (await db.query(`select source_id::text,business_date::text
      from public.restaurant_financial_source_population_v4($1,'manual_journal',$2::date,$3::date) order by source_id`, [lodge, ...range])).rows
    assert.deepEqual(actual, expected)
    const snapshot = (await db.query(`select public.restaurant_financial_source_snapshot($1,'manual_journal',$2::date,$3::date) as s`, [lodge, ...range])).rows[0].s
    assert.deepEqual(snapshot.source_ids, expected)
    assert.equal(Number(snapshot.row_count), expected.length)
  })
  test('PostgreSQL every non-manual family remains unverified, including zero-row families', async () => {
    const coverage = (await db.query(`select public.get_restaurant_financial_source_coverage_v2($1,'2199-01-01','2199-01-02') as c`, [lodge])).rows[0].c.data
    assert.equal(coverage.complete, false)
    assert.ok(coverage.rows.some(row => row.source_type === 'manual_journal'))
    for (const row of coverage.rows.filter(row => row.source_type !== 'manual_journal')) assert.notEqual(row.status, 'complete', row.source_type)
  })
  test('PostgreSQL unknown family with zero rows and four unsupported families block', async () => {
    await db.query('savepoint unknown_family')
    try {
      await db.query("insert into public.restaurant_financial_source_registry(source_type,enabled_product,authoritative_mutation,required_subledger,required_gl_posting,expected_report,posting_contract) values('luna_unknown_zero_v4','fixture','none','unknown','unknown','none','implemented')")
      const c = (await db.query("select public.get_restaurant_financial_source_coverage_v2($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c.data
      const unknown = c.rows.find(r => r.source_type === 'luna_unknown_zero_v4')
      assert.equal(Number(unknown.expected_rows), 0)
      assert.notEqual(unknown.status, 'complete')
      for (const name of ['voucher_redemption','voucher_return','customer_account_charge','inventory_depletion']) assert.notEqual(c.rows.find(r => r.source_type === name)?.status, 'complete')
      assert.equal(c.complete, false)
    } finally { await db.query('rollback to savepoint unknown_family') }
  })
  test('PostgreSQL actual orphan pending/exception and stale versions survive the census', async () => {
    await db.query('savepoint census_fixture')
    const source = randomUUID()
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    try {
      const statuses = ['pending', 'exception', 'reversed']
      for (let i = 0; i < ids.length; i++) await db.query("insert into public.restaurant_financial_source_postings(id,lodge_id,source_type,source_id,source_version,business_date,payload_hash,status) values($1,$2,'luna_unmapped_census_v4',$3,$4,'2199-01-01','fixture-canonical-unverified',$5)", [ids[i], lodge, source, i + 1, statuses[i]])
      const expected = (await db.query("select * from public.restaurant_financial_source_expected_ids_v3($1,'luna_unmapped_census_v4','2199-01-01','2199-01-02')", [lodge])).rows
      assert.deepEqual(expected, [], 'the independent posting census must not depend on expected-source membership')
      const census = (await db.query("select public.restaurant_financial_posting_exceptions_v4($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c
      for (const id of ids) {
        const row = census.find(r => r.posting_id === id)
        assert.ok(row)
        assert.ok(row.reasons.includes('unexpected_or_orphan_posting'))
        assert.ok(row.reasons.includes('pending_failed_exception_or_reversed_posting'))
        assert.ok(row.reasons.includes('stale_or_duplicate_source_version'))
      }
      await db.query('savepoint invalid_failed_status')
      await assert.rejects(db.query("insert into public.restaurant_financial_source_postings(id,lodge_id,source_type,source_id,source_version,business_date,payload_hash,status) values($1,$2,'luna_unmapped_census_v4',$3,4,'2199-01-01','fixture-canonical-unverified','failed')", [randomUUID(), lodge, source]), error => error.code === '23514')
      await db.query('rollback to savepoint invalid_failed_status')
      const coverage = (await db.query("select public.get_restaurant_financial_source_coverage_v2($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c.data
      assert.equal(coverage.complete, false)
      assert.ok(coverage.missing.some(item => item.source_type === 'posting_census' && Number(item.count) >= ids.length))
    } catch (error) { throw new Error('Actual posting census fixture failed (' + (error.code || 'assertion') + '); server details suppressed.') }
    finally { await db.query('rollback to savepoint census_fixture') }
  })
  test('PostgreSQL actual alias sharing retained journal is never certified', async () => {
    await db.query('savepoint shared_fixture')
    const id = randomUUID()
    try {
      await db.query("insert into public.restaurant_financial_source_postings(id,lodge_id,source_type,source_id,source_version,business_date,payload_hash,journal_entry_id,status) values($1,$2,'luna_shared_alias_v4',$3,1,'2199-01-01','fixture-unverified',$4,'posted')", [id, lodge, randomUUID(), '6c472c02-102b-4a30-a5ee-bfa7d7b401e6'])
      const census = (await db.query("select public.restaurant_financial_posting_exceptions_v4($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c
      assert.ok(census.find(r => r.posting_id === id)?.reasons.includes('duplicate_alias_or_shared_journal'))
      const draft = (await db.query("select id from public.restaurant_manual_journal_drafts where lodge_id=$1 and status='posted' limit 1", [lodge])).rows[0]
      assert.ok(draft)
      const proof = (await db.query('select public.restaurant_manual_journal_evidence_v4($1,$2) as e', [lodge, draft.id])).rows[0].e
      assert.equal(proof.complete, false, 'a shared journal cannot certify or double-count the governed draft')
      const coverage = (await db.query("select public.get_restaurant_financial_source_coverage_v2($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c.data
      assert.equal(coverage.complete, false)
    } catch (error) { throw new Error('Actual shared journal fixture failed (' + (error.code || 'assertion') + '); server details suppressed.') }
    finally { await db.query('rollback to savepoint shared_fixture') }
  })
  test('PostgreSQL retained governed manual journal verifies real immutable producer inputs', async () => {
    const drafts = (await db.query("select id from public.restaurant_manual_journal_drafts where lodge_id=$1 and status='posted'", [lodge])).rows
    assert.ok(drafts.length, 'Retained posted governed journal required; never fabricate checker approval.')
    for (const d of drafts) {
      const relation = (await db.query(`select d.operation_id,d.payload_hash,d.entry_date,j.id journal_id,j.lodge_id journal_lodge_id,
          j.source_id journal_source_id,j.entry_date journal_date,j.source_type,j.is_posted
        from public.restaurant_manual_journal_drafts d
        join public.restaurant_journal_entries j on j.id=d.journal_entry_id
        where d.lodge_id=$1 and d.id=$2 and d.status='posted'`, [lodge, d.id])).rows
      assert.equal(relation.length, 1)
      assert.ok(relation[0].operation_id)
      assert.equal(relation[0].journal_lodge_id, lodge)
      assert.equal(relation[0].journal_source_id, d.id)
      assert.equal(relation[0].source_type, 'manual')
      assert.equal(relation[0].is_posted, true)
      const result = (await db.query('select public.restaurant_manual_journal_evidence_v4($1,$2) as e', [lodge, d.id])).rows[0].e
      assert.equal(result.complete, true)
    }
  })
  test('PostgreSQL manual journal actor-link guard rejects a journal creator different from the draft poster', async () => {
    const poster = '00000000-0000-4000-8000-000000000011'
    const creator = '00000000-0000-4000-8000-000000000012'
    const mismatch = (await db.query('select public.restaurant_manual_journal_actor_match_v5($1::uuid,$2::uuid) as match', [poster, creator])).rows[0].match
    const match = (await db.query('select public.restaurant_manual_journal_actor_match_v5($1::uuid,$1::uuid) as match', [poster])).rows[0].match
    const missingPoster = (await db.query('select public.restaurant_manual_journal_actor_match_v5(null::uuid,$1::uuid) as match', [creator])).rows[0].match
    assert.equal(mismatch, false, 'journal.created_by must equal the persisted draft.posted_by')
    assert.equal(match, true)
    assert.equal(missingPoster, false)
    const retained = (await db.query(`select d.id,d.posted_by,j.created_by
      from public.restaurant_manual_journal_drafts d
      join public.restaurant_journal_entries j on j.id=d.journal_entry_id and j.lodge_id=d.lodge_id
      where d.lodge_id=$1 and d.status='posted'`, [lodge])).rows
    assert.ok(retained.length, 'Retained posted manual journal required; do not create a synthetic financial fixture.')
    for (const row of retained) {
      const linked = (await db.query('select public.restaurant_manual_journal_actor_match_v5($1::uuid,$2::uuid) as match', [row.posted_by, row.created_by])).rows[0].match
      assert.equal(linked, true, `posted actor linkage for ${row.id}`)
    }
  })
  test('PostgreSQL preserved draft payload cannot be edited even by fixture setup role', async () => {
    const draft = (await db.query("select id from public.restaurant_manual_journal_drafts where lodge_id=$1 and status='posted' limit 1", [lodge])).rows[0]
    assert.ok(draft, 'Retained governed journal required')
    await db.query('savepoint immutable_draft')
    try {
      await assert.rejects(db.query("update public.restaurant_manual_journal_drafts set description=description||' fixture forbidden change' where id=$1", [draft.id]), error => error.code === '55000')
    } finally { await db.query('rollback to savepoint immutable_draft') }
  })
  for (const role of ['anon', 'authenticated']) test('PostgreSQL actual ' + role + ' cannot invoke internal evidence checker', async () => {
    await db.query('savepoint denial_role')
    try {
      await db.query('set local role ' + role)
      await assert.rejects(db.query('select public.restaurant_financial_evidence_check_v4($1,$2)', [JSON.stringify(base), JSON.stringify([actual])]), error => error.code === '42501')
    } finally { await db.query('rollback to savepoint denial_role'); await db.query('set local role postgres') }
  })
  for (const role of ['anon', 'authenticated']) test('PostgreSQL actual ' + role + ' without staff session is denied by public coverage wrapper', async () => {
    await db.query('savepoint unauthorized_wrapper')
    try {
      await db.query('set local role ' + role)
      await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('app.session_token','',true)", [role])
      await assert.rejects(db.query("select public.get_restaurant_financial_source_coverage($1,'2199-01-01','2199-01-02')", [lodge]), error => error.code === '42501')
    } finally { await db.query('rollback to savepoint unauthorized_wrapper'); await db.query('set local role postgres') }
  })
  test('PostgreSQL approved genuine operator wrapper/Statements/export/close remain fail-closed', async () => {
    const token = process.env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION
    assert.ok(token, 'Approved genuine staff session must be configured securely outside chat; no fabricated actor context.')
    await db.query('savepoint genuine_operator')
    try {
      await db.query('set local role anon')
      await db.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [token])
      const c = (await db.query("select public.get_restaurant_financial_source_coverage($1,'2199-01-01','2199-01-02') as c", [lodge])).rows[0].c.data
      assert.equal(c.contract_version, 4)
      assert.equal(c.complete, false)
      const s = (await db.query("select public.get_restaurant_financial_statements_v3($1,'2199-01-01','2199-01-02') as s", [lodge])).rows[0].s.data
      assert.equal(s.source_coverage_complete, false)
      assert.equal(s.financially_final, false)
      const x = (await db.query("select public.get_restaurant_ledger_export_v3($1,'2199-01-01','2199-01-02',null,'{}') as x", [lodge])).rows[0].x.data
      assert.equal(x.complete, false)
      const close = (await db.query("select public.prepare_restaurant_period_close($1,'2199-01-01','2199-01-02','luna-ledger-v4-rollback-only') as c", [lodge])).rows[0].c.data
      assert.equal(close.status, 'blocked')
    } catch (error) { throw new Error('Genuine operator coverage/finality acceptance failed (' + (error.code || 'assertion') + '); session and server details suppressed.') }
    finally { await db.query('rollback to savepoint genuine_operator'); await db.query('set local role postgres') }
  })
}
