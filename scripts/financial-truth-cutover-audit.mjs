import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const SCRIPT_VERSION = 'financial-truth-cutover-audit-v1'

function todayInLodgeTime() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Gaborone',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

export function sha256Json(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function optionValue(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parseArgs(argv = process.argv.slice(2)) {
  const modes = ['--prepare', '--approve', '--activate'].filter((flag) => argv.includes(flag))
  if (modes.length > 1) throw new Error('Choose only one mutation mode: --prepare, --approve, or --activate')
  const lodgeId = optionValue(argv, '--lodge-id')
  const cutoverDate = optionValue(argv, '--cutover-date')
  if (!lodgeId || !cutoverDate) throw new Error('--lodge-id and --cutover-date are required')
  const output = optionValue(argv, '--output')
  const periodEnd = optionValue(argv, '--period-end') || todayInLodgeTime()
  const batchId = optionValue(argv, '--batch-id')
  const actorId = optionValue(argv, '--actor-id') || process.env.FINANCIAL_TRUTH_CUTOVER_ACTOR_ID || ''
  const databaseUrl = process.env.FINANCIAL_TRUTH_CUTOVER_DB_URL
    || process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL
    || process.env.SUPABASE_DB_URL
    || ''
  const mode = modes[0] ? modes[0].slice(2) : 'dry-run'
  return {
    mode,
    lodgeId,
    cutoverDate,
    periodEnd,
    output,
    actorId,
    databaseUrl,
    batchId,
    openingBalancesFile: optionValue(argv, '--opening-balances-file'),
    operationKey: optionValue(argv, '--operation-key'),
    reviewNotes: optionValue(argv, '--review-notes'),
    expectedOpeningPayloadHash: optionValue(argv, '--expected-opening-payload-hash'),
    configurationVersion: optionValue(argv, '--configuration-version'),
    policyVersion: optionValue(argv, '--policy-version') || 'bar-accounting-financial-truth-v1'
  }
}

function rpcData(result) {
  if (!result) return null
  if (result.success === false) throw new Error(result.error || 'Authoritative RPC returned success=false')
  return result.data ?? result
}

function count(value) {
  return Number(value || 0)
}

export function buildCutoverPacket({
  lodgeId,
  cutoverDate,
  periodEnd,
  historicalAudit,
  readiness,
  sourceCoverage,
  reconciliation,
  mutation = null,
  generatedAt = new Date().toISOString()
}) {
  const historical = historicalAudit || {}
  const historicalControls = historical.control_totals || {}
  const readinessBlockers = [
    ...(Array.isArray(readiness?.missing_requirements) ? readiness.missing_requirements : []),
    ...(count(readiness?.unposted_expenses) > 0 ? [`unposted_expenses:${readiness.unposted_expenses}`] : []),
    ...(count(readiness?.blocking_exceptions) > 0 ? [`blocking_exceptions:${readiness.blocking_exceptions}`] : [])
  ]
  const blockers = [
    ...(historical.complete === false ? (historical.blocking_reasons || ['historical_cutover_audit_incomplete']) : []),
    ...readinessBlockers,
    ...(sourceCoverage && sourceCoverage.complete === false ? ['post_cutover_source_coverage_incomplete'] : []),
    ...(count(reconciliation?.unbalanced_journals) > 0 ? [`unbalanced_journals:${reconciliation.unbalanced_journals}`] : []),
    ...(count(reconciliation?.blocking_exceptions) > 0 ? [`blocking_exceptions:${reconciliation.blocking_exceptions}`] : []),
    ...(count(reconciliation?.source_posting_exceptions) > 0 ? [`source_posting_exceptions:${reconciliation.source_posting_exceptions}`] : [])
  ]
  const packet = {
    schema_version: SCRIPT_VERSION,
    generated_at: generatedAt,
    lodge_id: lodgeId,
    cutover_date: cutoverDate,
    post_cutover_period_end: periodEnd,
    mutation: mutation || { mode: 'dry-run', performed: false },
    historical_audit: {
      schema_version: historical.schema_version || 'historical-cutover-audit-v1',
      source_counts: historical.source_counts || [],
      source_manifest_hash: historical.source_manifest_hash || null,
      control_totals: historicalControls,
      complete: historical.complete === true,
      blocking_reasons: historical.blocking_reasons || []
    },
    readiness: readiness || null,
    post_cutover_source_coverage: sourceCoverage || null,
    reconciliation: reconciliation || null,
    control_totals: {
      historical_candidate_count: count(historicalControls.candidate_count),
      historical_candidate_total: Number(historicalControls.candidate_total || 0),
      historical_posted_count: count(historicalControls.posted_count),
      historical_already_posted_count: count(historicalControls.already_posted_count),
      historical_reversible_count: count(historicalControls.reversible_count),
      historical_missing_configuration_count: count(historicalControls.missing_configuration_count),
      historical_unpostable_without_evidence_count: count(historicalControls.unpostable_without_evidence_count),
      unbalanced_journals: count(reconciliation?.unbalanced_journals),
      blocking_exceptions: count(reconciliation?.blocking_exceptions),
      source_posting_exceptions: count(reconciliation?.source_posting_exceptions)
    },
    blockers: [...new Set(blockers)],
    safe_to_approve: blockers.length === 0,
    safe_to_activate: blockers.length === 0 && readiness?.ready === true,
    authority: 'Supabase RPCs and posted journal/source rows; no client or cache estimates'
  }
  return { ...packet, packet_hash: sha256Json(packet) }
}

async function setAuthoritativeContext(client, args) {
  if (!args.actorId) throw new Error('FINANCIAL_TRUTH_CUTOVER_ACTOR_ID or --actor-id is required')
  await client.query(
    "select set_config('request.jwt.claim.role',$1,false), set_config('app.session_valid','true',false), set_config('app.actor_id',$2,false), set_config('app.lodge_id',$3,false), set_config('app.session_role','admin',false)",
    ['service_role', args.actorId, args.lodgeId]
  )
}

async function callRpc(client, functionName, params) {
  const result = await client.query(`select public.${functionName}(${params.map((_, index) => `$${index + 1}`).join(',')}) as result`, params)
  return rpcData(result.rows[0]?.result)
}

async function loadReconciliation(client, args) {
  const params = [args.lodgeId]
  const [unbalanced, exceptions, sourceExceptions, accounts] = await Promise.all([
    client.query(`
      select count(*)::int as count
      from (
        select e.id
        from public.restaurant_journal_entries e
        join public.restaurant_journal_lines l on l.entry_id = e.id
        where e.lodge_id = $1 and e.is_posted
        group by e.id
        having round(sum(l.debit) - sum(l.credit), 2) <> 0
      ) drift`, params),
    client.query(`
      select count(*)::int as count
      from public.restaurant_reconciliation_exceptions
      where lodge_id = $1 and severity = 'blocking' and status in ('open', 'investigating')`, params),
    client.query(`
      select count(*)::int as count
      from public.restaurant_financial_source_postings
      where lodge_id = $1 and (status <> 'posted' or journal_entry_id is null)`, params),
    client.query(`
      select a.id, a.code, a.name, a.account_type,
        round(coalesce(sum(l.debit) filter (where e.is_posted), 0), 2) as debit,
        round(coalesce(sum(l.credit) filter (where e.is_posted), 0), 2) as credit,
        round(case when a.account_type in ('asset', 'expense')
          then coalesce(sum(l.debit) filter (where e.is_posted), 0) - coalesce(sum(l.credit) filter (where e.is_posted), 0)
          else coalesce(sum(l.credit) filter (where e.is_posted), 0) - coalesce(sum(l.debit) filter (where e.is_posted), 0)
        end, 2) as balance
      from public.restaurant_accounts a
      left join public.restaurant_journal_lines l on l.account_id = a.id
      left join public.restaurant_journal_entries e on e.id = l.entry_id and e.lodge_id = $1
      where a.lodge_id = $1
      group by a.id, a.code, a.name, a.account_type
      order by a.code`, params)
  ])
  return {
    unbalanced_journals: count(unbalanced.rows[0]?.count),
    blocking_exceptions: count(exceptions.rows[0]?.count),
    source_posting_exceptions: count(sourceExceptions.rows[0]?.count),
    control_accounts: accounts.rows
  }
}

async function readPacket(client, args, mutation = null) {
  const [historicalAudit, readiness, sourceCoverage, reconciliation] = await Promise.all([
    callRpc(client, 'get_restaurant_historical_cutover_audit', [args.lodgeId, args.cutoverDate]),
    callRpc(client, 'get_restaurant_accounting_readiness', [args.lodgeId]),
    args.periodEnd >= args.cutoverDate
      ? callRpc(client, 'get_restaurant_financial_source_coverage', [args.lodgeId, args.cutoverDate, args.periodEnd])
      : Promise.resolve(null),
    loadReconciliation(client, args)
  ])
  return buildCutoverPacket({
    lodgeId: args.lodgeId,
    cutoverDate: args.cutoverDate,
    periodEnd: args.periodEnd,
    historicalAudit,
    readiness,
    sourceCoverage,
    reconciliation,
    mutation
  })
}

function readOpeningBalances(filePath) {
  if (!filePath) throw new Error('--opening-balances-file is required for --prepare')
  const absolute = resolve(filePath)
  if (!existsSync(absolute)) throw new Error(`Opening-balance file does not exist: ${absolute}`)
  const value = JSON.parse(readFileSync(absolute, 'utf8'))
  if (!Array.isArray(value)) throw new Error('Opening-balance file must contain a JSON array')
  return value
}

async function run(args) {
  if (!args.databaseUrl) throw new Error('FINANCIAL_TRUTH_CUTOVER_DB_URL, RESTAURANT_ACCOUNTING_TEST_DB_URL, or SUPABASE_DB_URL is required')
  const client = new Client({ connectionString: args.databaseUrl })
  await client.connect()
  try {
    await setAuthoritativeContext(client, args)
    let mutation = null
    if (args.mode === 'prepare') {
      const openingBalances = readOpeningBalances(args.openingBalancesFile)
      if (!args.operationKey) throw new Error('--operation-key is required for --prepare')
      const initial = await readPacket(client, args)
      const evidence = {
        packet_schema_version: initial.schema_version,
        packet_hash: initial.packet_hash,
        source_manifest_hash: initial.historical_audit.source_manifest_hash,
        source_manifest: initial.historical_audit
      }
      mutation = await callRpc(client, 'prepare_restaurant_historical_cutover', [args.lodgeId, args.cutoverDate, JSON.stringify(openingBalances), JSON.stringify(evidence), args.operationKey])
    } else if (args.mode === 'approve') {
      if (!args.batchId || !args.reviewNotes) throw new Error('--batch-id and --review-notes are required for --approve')
      mutation = await callRpc(client, 'approve_restaurant_historical_cutover', [args.lodgeId, args.batchId, args.reviewNotes, args.expectedOpeningPayloadHash])
    } else if (args.mode === 'activate') {
      if (!args.batchId || !args.configurationVersion) throw new Error('--batch-id and --configuration-version are required for --activate')
      const openingApply = await callRpc(client, 'apply_restaurant_historical_cutover', [args.lodgeId, args.batchId])
      mutation = await callRpc(client, 'activate_restaurant_accounting', [args.lodgeId, args.cutoverDate, args.configurationVersion, args.policyVersion, args.batchId])
      mutation = { opening_apply: openingApply, activation: mutation }
    }
    const packet = await readPacket(client, args, mutation ? { mode: args.mode, performed: true, result: mutation } : null)
    if (args.output) {
      const outputPath = resolve(args.output)
      writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
      console.log(`Wrote cutover evidence packet: ${outputPath}`)
    } else {
      console.log(JSON.stringify(packet, null, 2))
    }
    if (args.mode === 'dry-run' && !packet.safe_to_approve) process.exitCode = 2
  } finally {
    await client.end()
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    await run(parseArgs())
  } catch (error) {
    console.error(`Financial-truth cutover audit failed: ${error?.message || error}`)
    process.exitCode = 1
  }
}
