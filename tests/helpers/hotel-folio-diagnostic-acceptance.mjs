import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APPROVED_PROJECT_REF = 'repsrmlomedqrmrdsbga'
const REQUIRED_MARKER = 'LUNA-REMEDIATION-DISPOSABLE-v1'

function errorCode(responseBody) {
  const code = responseBody?.code
  return code == null ? null : String(code)
}

export async function runHotelFolioDiagnosticAcceptance({ client, projectRef, lodgeId, userId, anonKey, evidencePath }) {
  if (projectRef !== APPROVED_PROJECT_REF) throw new Error('Hotel diagnostic mutation acceptance only permits the approved disposable project.')
  if (!client || !lodgeId || !userId || !anonKey) throw new Error('A verified disposable connection, synthetic lodge/user, and anon key are required.')

  const runId = randomUUID()
  const tokens = { finance: randomBytes(32).toString('hex'), cashier: randomBytes(32).toString('hex') }
  const folios = Array.from({ length: 17 }, () => randomUUID())
  const pairIds = Object.fromEntries(['empty', 'valid', 'missing_in', 'duplicate_out', 'wrong_endpoint', 'full_reversal', 'partial_reversal'].map((name) => [name, randomUUID()]))
  const lineRows = []
  const report = {
    project_ref: projectRef,
    run_id: runId,
    started_at: new Date().toISOString(),
    scope: 'Disposable-only Hotel integrity diagnostic RPC behavior, lineage samples and authorization',
    result: {},
    cleanup: { completed: false }
  }

  let setupInTransaction = false
  let fixtureCommitted = false
  let disposableVerified = false
  let failure = null
  const rpc = async (pLodgeId, token = null) => {
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    }
    if (token) headers['x-boroko-session'] = token
    const response = await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/get_hotel_folio_integrity_diagnostics`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_lodge_id: pLodgeId }),
      signal: AbortSignal.timeout(30000)
    })
    let body = null
    try { body = await response.json() } catch {}
    return { status: response.status, code: errorCode(body), body }
  }

  const addLine = (folioIndex, lineType, amount, { pair = null, reversal = null, audit = null, label }) => {
    const id = randomUUID()
    lineRows.push({
      id,
      folioId: folios[folioIndex],
      lineType,
      amount,
      pairId: pair ? pairIds[pair] : null,
      reversesId: reversal,
      auditBefore: audit,
      description: `LUNA Hotel diagnostic ${runId} ${label}`
    })
    return id
  }

  try {
    const identity = (await client.query('select current_database() as database_name')).rows[0]
    assert.equal(identity.database_name, 'postgres', 'The disposable test database identity must be postgres.')
    const marker = await client.query("select marker,environment_kind,database_name,project_ref,allow_mutation from public.luna_remediation_db_marker where singleton is true")
    assert.equal(marker.rowCount, 1, 'Exactly one disposable marker is required.')
    assert.deepEqual(marker.rows[0], {
      marker: REQUIRED_MARKER,
      environment_kind: 'disposable',
      database_name: 'postgres',
      project_ref: APPROVED_PROJECT_REF,
      allow_mutation: true
    })
    disposableVerified = true
    const user = await client.query('select id from public.users where id=$1::uuid and lodge_id=$2::uuid', [userId, lodgeId])
    assert.equal(user.rowCount, 1, 'The synthetic staff user must belong to the test lodge.')
    const catalog = await client.query(`
      select
        exists(select 1 from pg_indexes where schemaname='public' and indexname='folio_line_items_transfer_leg_once_uidx') as transfer_index_present,
        exists(select 1 from pg_trigger where tgrelid='public.folio_line_items'::regclass and tgname='trg_hotel_folio_validate_lineage_v1' and not tgisinternal and tgenabled='O') as lineage_trigger_enabled
    `)
    assert.equal(catalog.rows[0].transfer_index_present, true, 'Transfer uniqueness guard must be present before the test.')
    assert.equal(catalog.rows[0].lineage_trigger_enabled, true, 'Hotel lineage trigger must be enabled before the test.')

    await client.query('begin')
    setupInTransaction = true
    await client.query(`
      insert into public.app_sessions(token_hash,session_type,user_id,lodge_id,role,expires_at)
      values
        (public.app_hash_token($1),'desktop',$2::uuid,$3::uuid,'finance',now()+interval '20 minutes'),
        (public.app_hash_token($4),'desktop',$2::uuid,$3::uuid,'cashier',now()+interval '20 minutes')
    `, [tokens.finance, userId, lodgeId, tokens.cashier])
    await client.query('commit')
    setupInTransaction = false

    const baselineResponse = await rpc(lodgeId, tokens.finance)
    assert.equal(baselineResponse.status, 200, 'Genuine finance session must call the diagnostic over anon-key HTTPS.')
    const baseline = baselineResponse.body
    assert.equal(baseline?.complete, true)
    assert.equal(baseline?.schema_version, 1)
    report.result.baseline = {
      certifiable: baseline.certifiable,
      incomplete_transfer_pair_count: baseline.incomplete_transfer_pair_count,
      incomplete_transfer_reversal_count: baseline.incomplete_transfer_reversal_count,
      unlinked_historic_transfer_count: baseline.unlinked_historic_transfer_count
    }

    const balances = new Map(folios.map((id) => [id, 0]))
    const addCharge = (folioIndex, amount, label) => {
      balances.set(folios[folioIndex], (balances.get(folios[folioIndex]) || 0) + amount)
      return addLine(folioIndex, 'charge', amount, { label })
    }
    const addTransfer = (folioIndex, lineType, amount, pair, label) => {
      const delta = lineType === 'transfer_in' ? amount : -amount
      balances.set(folios[folioIndex], (balances.get(folios[folioIndex]) || 0) + delta)
      return addLine(folioIndex, lineType, amount, { pair, label })
    }
    const addReversal = (folioIndex, amount, originalId, originalType, pair, label) => {
      const delta = originalType === 'transfer_in' ? -amount : amount
      balances.set(folios[folioIndex], (balances.get(folios[folioIndex]) || 0) + delta)
      return addLine(folioIndex, 'void', amount, {
        pair,
        reversal: originalId,
        audit: { id: originalId, line_type: originalType },
        label
      })
    }

    addCharge(2, 20, 'valid opening charge')
    const validOut = addTransfer(2, 'transfer_out', 10, 'valid', 'valid transfer out')
    addTransfer(3, 'transfer_in', 10, 'valid', 'valid transfer in')

    addCharge(4, 20, 'missing leg opening charge')
    addTransfer(4, 'transfer_out', 11, 'missing_in', 'missing incoming leg')

    addCharge(6, 40, 'duplicate leg opening charge')
    addTransfer(6, 'transfer_out', 12, 'duplicate_out', 'duplicate outgoing leg one')
    addTransfer(6, 'transfer_out', 12, 'duplicate_out', 'duplicate outgoing leg two')

    addCharge(10, 30, 'wrong endpoint opening charge')
    addTransfer(10, 'transfer_out', 13, 'wrong_endpoint', 'wrong source endpoint')
    addTransfer(11, 'transfer_in', 13, 'wrong_endpoint', 'wrong target endpoint')

    const fullOut = addTransfer(12, 'transfer_out', 14, 'full_reversal', 'fully reversed outgoing leg')
    const fullIn = addTransfer(13, 'transfer_in', 14, 'full_reversal', 'fully reversed incoming leg')
    addReversal(12, 14, fullOut, 'transfer_out', 'full_reversal', 'full outgoing reversal')
    addReversal(13, 14, fullIn, 'transfer_in', 'full_reversal', 'full incoming reversal')

    const partialOut = addTransfer(14, 'transfer_out', 15, 'partial_reversal', 'partial outgoing leg')
    addTransfer(15, 'transfer_in', 15, 'partial_reversal', 'partial incoming leg')
    addReversal(14, 15, partialOut, 'transfer_out', 'partial_reversal', 'partial reversal')

    addCharge(16, 10, 'unlinked opening charge')
    const unlinked = addLine(16, 'transfer_out', 6, { label: 'unlinked historic transfer', pair: null })
    balances.set(folios[16], balances.get(folios[16]) - 6)

    const pairRows = [
      { name: 'empty', source: 0, target: 1 },
      { name: 'valid', source: 2, target: 3 },
      { name: 'missing_in', source: 4, target: 5 },
      { name: 'duplicate_out', source: 6, target: 7 },
      { name: 'wrong_endpoint', source: 8, target: 9 },
      { name: 'full_reversal', source: 12, target: 13 },
      { name: 'partial_reversal', source: 14, target: 15 }
    ]

    await client.query('begin')
    setupInTransaction = true
    await client.query('alter table public.folio_line_items disable trigger trg_hotel_folio_validate_lineage_v1')
    await client.query('drop index public.folio_line_items_transfer_leg_once_uidx')

    const folioValues = []
    const folioPlaceholders = []
    for (let index = 0; index < folios.length; index += 1) {
      const offset = folioValues.length
      folioValues.push(folios[index], lodgeId, `LUNA-${runId}-${index}`, `Diagnostic fixture ${runId}-${index}`, balances.get(folios[index]) || 0)
      folioPlaceholders.push(`($${offset + 1}::uuid,$${offset + 2}::uuid,'guest',$${offset + 3},$${offset + 4},'open',$${offset + 5}::numeric)`)
    }
    await client.query(`insert into public.hotel_folios(id,lodge_id,folio_type,folio_number,label,status,balance) values ${folioPlaceholders.join(',')}`, folioValues)

    const pairValues = []
    const pairPlaceholders = []
    for (const item of pairRows) {
      const offset = pairValues.length
      pairValues.push(pairIds[item.name], lodgeId, folios[item.source], folios[item.target], `luna-hotel-diagnostic-${runId}-${item.name}`, userId)
      pairPlaceholders.push(`($${offset + 1}::uuid,$${offset + 2}::uuid,$${offset + 3}::uuid,$${offset + 4}::uuid,$${offset + 5},$${offset + 6}::uuid)`)
    }
    await client.query(`insert into public.hotel_folio_transfer_pairs(id,lodge_id,source_folio_id,target_folio_id,operation_key,created_by) values ${pairPlaceholders.join(',')}`, pairValues)

    const lineValues = []
    const linePlaceholders = []
    for (const item of lineRows) {
      const offset = lineValues.length
      lineValues.push(item.id, item.folioId, lodgeId, item.amount, item.lineType, item.description, userId, item.auditBefore, item.pairId, item.reversesId)
      linePlaceholders.push(`($${offset + 1}::uuid,$${offset + 2}::uuid,$${offset + 3}::uuid,$${offset + 4}::numeric,$${offset + 5},$${offset + 6},$${offset + 7}::uuid,$${offset + 8}::jsonb,$${offset + 9}::uuid,$${offset + 10}::uuid)`)
    }
    await client.query(`insert into public.folio_line_items(id,folio_id,lodge_id,amount,line_type,description,created_by,audit_before,transfer_pair_id,reverses_line_item_id) values ${linePlaceholders.join(',')}`, lineValues)
    await client.query('commit')
    setupInTransaction = false
    fixtureCommitted = true

    const diagnosticResponse = await rpc(lodgeId, tokens.finance)
    assert.equal(diagnosticResponse.status, 200, 'Finance diagnostic RPC should return JSON over real HTTPS.')
    const diagnostic = diagnosticResponse.body
    assert.equal(diagnostic.complete, true, 'The diagnostic completed its checks rather than returning partial data.')
    assert.equal(diagnostic.certifiable, false, 'Malformed fixture lineage must fail closed for certification.')
    assert.equal(diagnostic.lodge_id, lodgeId)
    assert.equal(diagnostic.incomplete_transfer_pair_count - baseline.incomplete_transfer_pair_count, 4)
    assert.equal(diagnostic.incomplete_transfer_reversal_count - baseline.incomplete_transfer_reversal_count, 1)
    assert.equal(diagnostic.unlinked_historic_transfer_count - baseline.unlinked_historic_transfer_count, 1)
    assert.equal(diagnostic.balance_difference_count, baseline.balance_difference_count, 'Fixture ledger balances must reconcile; only lineage defects are under test.')
    assert.equal(diagnostic.uncheckable_balance_folio_count, baseline.uncheckable_balance_folio_count)

    const incompletePairs = diagnostic.samples.incomplete_transfer_pairs
    const sampleFor = (pairName) => incompletePairs.find((row) => row.id === pairIds[pairName])
    assert.deepEqual({ leg_count: sampleFor('empty')?.leg_count, out_count: sampleFor('empty')?.out_count, in_count: sampleFor('empty')?.in_count }, { leg_count: 0, out_count: 0, in_count: 0 })
    assert.deepEqual({ leg_count: sampleFor('missing_in')?.leg_count, out_count: sampleFor('missing_in')?.out_count, in_count: sampleFor('missing_in')?.in_count }, { leg_count: 1, out_count: 1, in_count: 0 })
    assert.deepEqual({ leg_count: sampleFor('duplicate_out')?.leg_count, out_count: sampleFor('duplicate_out')?.out_count, in_count: sampleFor('duplicate_out')?.in_count }, { leg_count: 2, out_count: 2, in_count: 0 })
    const wrongEndpoint = sampleFor('wrong_endpoint')
    assert.ok(wrongEndpoint, 'Wrong source/target folios must be reported.')
    assert.notEqual(wrongEndpoint.out_folio_id, wrongEndpoint.source_folio_id)
    assert.notEqual(wrongEndpoint.in_folio_id, wrongEndpoint.target_folio_id)
    assert.ok(!incompletePairs.some((row) => row.id === pairIds.valid), 'A valid transfer pair must not be reported incomplete.')
    const incompleteReversals = diagnostic.samples.incomplete_transfer_reversals
    assert.ok(!incompleteReversals.some((row) => row.id === pairIds.full_reversal), 'A full two-leg reversal must be considered complete.')
    assert.ok(incompleteReversals.some((row) => row.id === pairIds.partial_reversal), 'A one-leg reversal must be reported incomplete.')
    assert.ok(diagnostic.samples.unlinked_transfers.some((row) => row.id === unlinked), 'An unlinked historic transfer must be sampled.')

    const noSession = await rpc(lodgeId)
    assert.ok(noSession.status >= 400 && noSession.code === '42501', 'Anon without a staff session must be denied.')
    const cashier = await rpc(lodgeId, tokens.cashier)
    assert.ok(cashier.status >= 400 && cashier.code === '42501', 'A non-diagnostic cashier role must be denied.')
    const foreignLodge = await rpc(randomUUID(), tokens.finance)
    assert.ok(foreignLodge.status >= 400 && foreignLodge.code === '42501', 'The finance session must not cross lodge scope.')

    report.result.behavior = {
      http_status: diagnosticResponse.status,
      complete: diagnostic.complete,
      certifiable: diagnostic.certifiable,
      incomplete_transfer_pair_delta: diagnostic.incomplete_transfer_pair_count - baseline.incomplete_transfer_pair_count,
      incomplete_transfer_reversal_delta: diagnostic.incomplete_transfer_reversal_count - baseline.incomplete_transfer_reversal_count,
      unlinked_transfer_delta: diagnostic.unlinked_historic_transfer_count - baseline.unlinked_historic_transfer_count,
      balance_difference_delta: diagnostic.balance_difference_count - baseline.balance_difference_count,
      cases: {
        no_legs: sampleFor('empty'),
        valid_pair_not_reported: !incompletePairs.some((row) => row.id === pairIds.valid),
        missing_incoming: sampleFor('missing_in'),
        duplicate_outgoing: sampleFor('duplicate_out'),
        wrong_endpoints: wrongEndpoint,
        full_reversal_not_reported: !incompleteReversals.some((row) => row.id === pairIds.full_reversal),
        partial_reversal: incompleteReversals.find((row) => row.id === pairIds.partial_reversal),
        unlinked_transfer_id: unlinked
      },
      authorization: {
        no_session: { status: noSession.status, code: noSession.code },
        cashier_role: { status: cashier.status, code: cashier.code },
        foreign_lodge: { status: foreignLodge.status, code: foreignLodge.code }
      }
    }
    report.fixture = { folio_count: folios.length, pair_count: pairRows.length, line_item_count: lineRows.length }
    report.passed = true
  } catch (error) {
    failure = error
    report.passed = false
    report.failure = { name: error?.name || 'Error', message: error?.message || 'Unknown acceptance failure' }
  } finally {
    try {
      if (setupInTransaction) await client.query('rollback')
      if (projectRef === APPROVED_PROJECT_REF && disposableVerified) {
        await client.query('begin')
        await client.query('delete from public.folio_line_items where id=any($1::uuid[])', [lineRows.map((row) => row.id)])
        await client.query('delete from public.hotel_folio_transfer_pairs where id=any($1::uuid[])', [Object.values(pairIds)])
        await client.query('delete from public.hotel_folios where id=any($1::uuid[])', [folios])
        await client.query('create unique index if not exists folio_line_items_transfer_leg_once_uidx on public.folio_line_items(transfer_pair_id,line_type) where transfer_pair_id is not null and line_type in (\'transfer_in\',\'transfer_out\')')
        await client.query('alter table public.folio_line_items enable trigger trg_hotel_folio_validate_lineage_v1')
        await client.query('delete from public.app_sessions where token_hash in (select public.app_hash_token(token) from unnest($1::text[]) as token)', [[tokens.finance, tokens.cashier]])
        await client.query('commit')
        fixtureCommitted = false
        report.cleanup = { completed: true, fixtures_removed: true, transfer_index_restored: true, lineage_trigger_enabled: true }
      }
    } catch (cleanupError) {
      await client.query('rollback').catch(() => {})
      report.cleanup = { completed: false, message: cleanupError?.message || 'Cleanup failed' }
      failure ||= cleanupError
    }
    report.finished_at = new Date().toISOString()
    if (evidencePath) {
      mkdirSync(path.dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n')
    }
  }

  if (failure) throw failure
  return report
}
