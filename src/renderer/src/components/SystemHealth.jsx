import { useState, useEffect, useCallback } from 'react'
import { Shield, CheckCircle, XCircle, AlertTriangle, RefreshCw, Database, Server, Bell, CreditCard, Users, Activity, Clock } from 'lucide-react'
import { callAdminApi } from '../utils/adminApi'

const CHECKS = [
  { id: 'companies', label: 'Companies Database', detail: 'Company directory and lodge access', icon: Database, method: 'getCompanies', timeout: 20000 },
  { id: 'licenses', label: 'License System', detail: 'Subscriptions and entitlements', icon: CreditCard, method: 'getLicenses', timeout: 20000 },
  { id: 'tickets', label: 'Support Tickets', detail: 'Support inbox availability', icon: Bell, method: 'getSupportTickets', args: [{}], timeout: 20000 },
  { id: 'fleet', label: 'Fleet Health', detail: 'Device heartbeat reporting', icon: Server, method: 'getFleetHealthSummary', timeout: 20000 },
  { id: 'activity', label: 'Activity Logs', detail: 'Command Central audit trail', icon: Activity, method: 'getActivityLogs', args: [{ limit: 5 }], timeout: 20000 },
  { id: 'mrr', label: 'Subscription Revenue', detail: 'MRR and ARR reporting', icon: CreditCard, method: 'getMrrSummary', timeout: 30000 },
  { id: 'revenue', label: 'Payment Revenue', detail: 'Recent payment reporting', icon: CreditCard, method: 'getRevenueSummary', args: [7], timeout: 30000 },
  { id: 'collections', label: 'Collections Queue', detail: 'Outstanding booking balances', icon: CreditCard, method: 'getCollectionsQueue', timeout: 30000 },
  { id: 'releases', label: 'Release Management', detail: 'Desktop update rollout service', icon: Server, method: 'getReleases', timeout: 20000 },
  { id: 'notifications', label: 'Notification Inbox', detail: 'Admin notification delivery', icon: Bell, method: 'getNotifications', args: [{ limit: 5 }], timeout: 20000 },
  { id: 'automation', label: 'Automation Rules', detail: 'Scheduled admin alerts', icon: Activity, method: 'getNotificationRules', timeout: 20000 },
  { id: 'search', label: 'Global Search', detail: 'Cross-system search index', icon: Users, method: 'globalSearch', args: ['health-check', 1], timeout: 30000 },
  { id: 'surfaces', label: 'App & Website Surfaces', detail: 'Desktop, PWA, POS, and website telemetry', icon: Server, method: 'getSurfaceIntelligence', timeout: 30000 },
]

const CONCURRENCY = 3
const SLOW_MS = 5000

function withTimeout(promise, timeout, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} did not respond within ${Math.round(timeout / 1000)} seconds`)),
      timeout
    ))
  ])
}

async function executeCheck(check) {
  const start = Date.now()
  try {
    const result = await withTimeout(
      callAdminApi(check.method, check.args || [], {}),
      check.timeout,
      check.label
    )
    const ms = Date.now() - start
    if (result?.unavailable) return { id: check.id, status: 'unavailable', error: result.error, ms, checkedAt: new Date().toISOString(), source: check.method }
    if (result?.ok === false || result?.success === false || result?.error) {
      return { id: check.id, status: result?.unavailable ? 'unavailable' : 'failed', error: result.error || 'Service returned a failure', ms, checkedAt: new Date().toISOString(), source: check.method }
    }
    const rowCount = Array.isArray(result)
      ? result.length
      : Array.isArray(result?.data)
        ? result.data.length
        : Array.isArray(result?.rows)
          ? result.rows.length
          : null
    return { id: check.id, status: ms >= SLOW_MS ? 'slow' : 'healthy', ms, checkedAt: new Date().toISOString(), source: check.method, rowCount }
  } catch (error) {
    return { id: check.id, status: 'failed', error: error?.message || 'Check failed', ms: Date.now() - start, checkedAt: new Date().toISOString(), source: check.method }
  }
}

export default function SystemHealth() {
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(false)
  const [runningAt, setRunningAt] = useState(null)
  const [historyState, setHistoryState] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoadState, setHistoryLoadState] = useState(null)

  const loadHistory = useCallback(async () => {
    const result = await callAdminApi('listCommandCentralHealthRuns', [20], {})
    if (result?.unavailable || result?.ok === false || result?.error) {
      setHistoryLoadState({ ok: false, error: result.error || 'Diagnostic history is unavailable.' })
      return
    }
    setHistoryRows(Array.isArray(result) ? result : [])
    setHistoryLoadState({ ok: true })
  }, [])

  const runOne = useCallback(async (check) => {
    setResults(current => ({ ...current, [check.id]: { id: check.id, status: 'running' } }))
    const result = await executeCheck(check)
    setResults(current => ({ ...current, [check.id]: result }))
  }, [])

  const runChecks = useCallback(async () => {
    setLoading(true)
    setHistoryState(null)
    setResults(Object.fromEntries(CHECKS.map(check => [check.id, { id: check.id, status: 'pending' }])))
    const startedAt = new Date()
    setRunningAt(startedAt)

    let nextIndex = 0
    const finalResults = {}
    const worker = async () => {
      while (nextIndex < CHECKS.length) {
        const check = CHECKS[nextIndex]
        nextIndex += 1
        setResults(current => ({ ...current, [check.id]: { id: check.id, status: 'running' } }))
        const result = await executeCheck(check)
        finalResults[check.id] = result
        setResults(current => ({ ...current, [check.id]: result }))
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    const completedResults = Object.values(finalResults)
    const runStatus = completedResults.some(result => ['failed', 'unavailable'].includes(result.status))
      ? 'failed'
      : completedResults.some(result => result.status === 'slow')
        ? 'degraded'
        : 'healthy'
    const historyResult = await callAdminApi('recordCommandCentralHealthRun', [{
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: runStatus,
      results: completedResults.map(result => ({
        id: result.id,
        status: result.status,
        source: result.source,
        checked_at: result.checkedAt,
        latency_ms: result.ms,
        row_count: result.rowCount,
        error_message: result.error
      }))
    }], {})
    setHistoryState(historyResult?.ok
      ? { ok: true, runId: historyResult.run_id }
      : { ok: false, error: historyResult?.error || 'Diagnostic history could not be recorded.' })
    if (historyResult?.ok) await loadHistory()
    setLoading(false)
  }, [loadHistory])

  useEffect(() => {
    runChecks()
    loadHistory()
  }, [loadHistory, runChecks])

  const completed = Object.values(results).filter(result => !['pending', 'running'].includes(result.status))
  const healthy = completed.filter(result => result.status === 'healthy').length
  const slow = completed.filter(result => result.status === 'slow').length
  const failed = completed.filter(result => ['failed', 'unavailable'].includes(result.status)).length
  const allHealthy = completed.length === CHECKS.length && failed === 0 && slow === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="text-purple-400" size={20} />
            <h2 className="text-white font-semibold text-lg">Command Central Diagnostics</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">Checks whether each admin service can be reached. This does not alter business data.</p>
        </div>
        <button onClick={runChecks} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? `${completed.length}/${CHECKS.length}` : 'Run All'}
        </button>
      </div>

      {runningAt && <p className="text-[10px] text-gray-500">Last started: {runningAt.toLocaleString()}</p>}
      {historyState && <p className={`text-[10px] ${historyState.ok ? 'text-emerald-500' : 'text-amber-400'}`}>{historyState.ok ? `Diagnostic history recorded · ${historyState.runId}` : `History unavailable · ${historyState.error}`}</p>}

      <div className="bg-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm text-white font-medium">Recent diagnostic runs</p>
            <p className="text-[10px] text-gray-500">Server-recorded summaries only; individual evidence is bounded and sanitized.</p>
          </div>
          {historyLoadState?.ok && <span className="text-[10px] text-gray-500">{historyRows.length} recorded</span>}
        </div>
        {historyLoadState?.error && <p className="text-xs text-amber-400">History unavailable · {historyLoadState.error}</p>}
        {!historyLoadState?.error && historyRows.length === 0 && <p className="text-xs text-gray-500">No recorded runs are available yet.</p>}
        {historyRows.length > 0 && (
          <div className="space-y-2">
            {historyRows.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="text-gray-300 truncate">{run.created_at ? new Date(run.created_at).toLocaleString() : 'Unknown time'}</p>
                  <p className="text-[10px] text-gray-500">{run.actor_email || 'Master administrator'} · {run.id}</p>
                </div>
                <span className={run.status === 'healthy' ? 'text-emerald-400' : run.status === 'degraded' ? 'text-amber-400' : 'text-red-400'}>{run.status || 'unknown'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Summary label="Completed" value={`${completed.length}/${CHECKS.length}`} color="text-white" />
        <Summary label="Healthy" value={healthy} color="text-green-400" />
        <Summary label="Slow" value={slow} color="text-amber-400" />
        <Summary label="Failed" value={failed} color={failed ? 'text-red-400' : 'text-green-400'} />
      </div>

      {completed.length > 0 && (
        <div className={`rounded-xl p-4 flex items-start gap-3 ${
          allHealthy ? 'bg-green-950/30 border border-green-900/40' :
          failed ? 'bg-red-950/30 border border-red-900/40' :
          'bg-amber-950/30 border border-amber-900/40'
        }`}>
          {allHealthy ? <CheckCircle size={16} className="text-green-400 mt-0.5" /> :
            failed ? <XCircle size={16} className="text-red-400 mt-0.5" /> :
              <AlertTriangle size={16} className="text-amber-400 mt-0.5" />}
          <div>
            <p className={`text-sm font-medium ${allHealthy ? 'text-green-300' : failed ? 'text-red-300' : 'text-amber-300'}`}>
              {allHealthy ? 'All Command Central services responded normally.' :
                failed ? `${failed} service${failed === 1 ? '' : 's'} could not be verified.` :
                  `${slow} service${slow === 1 ? '' : 's'} responded slowly.`}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              A slow or failed diagnostic does not mean financial data is wrong. Retry that service and review its exact message.
            </p>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="divide-y divide-gray-700">
          {CHECKS.map(check => {
            const result = results[check.id]
            const Icon = check.icon
            return (
              <div key={check.id} className="px-4 py-3 flex items-center gap-3">
                <Icon size={14} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{check.label}</p>
                  <p className="text-[10px] text-gray-500">{check.detail}</p>
                  {result?.error && <p className="text-[10px] text-red-400 mt-1">{result.error}</p>}
                  {result && !result.error && result.rowCount != null && <p className="text-[10px] text-gray-500 mt-1">{result.rowCount} record{result.rowCount === 1 ? '' : 's'} returned</p>}
                </div>
                <Status result={result} />
                {result && !['pending', 'running'].includes(result.status) && (
                  <button onClick={() => runOne(check)} disabled={result.status === 'running'}
                    className="text-[10px] text-gray-400 hover:text-white underline">
                    Retry
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Summary({ label, value, color }) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <p className="text-[10px] uppercase text-gray-400 font-semibold">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function Status({ result }) {
  if (!result || result.status === 'pending') return <span className="text-[10px] text-gray-500">Waiting</span>
  if (result.status === 'running') return <RefreshCw size={14} className="text-purple-400 animate-spin" />

  const config = {
    healthy: { label: 'Healthy', color: 'text-green-400', icon: CheckCircle },
    slow: { label: 'Slow', color: 'text-amber-400', icon: Clock },
    unavailable: { label: 'Unavailable', color: 'text-red-400', icon: XCircle },
    failed: { label: 'Failed', color: 'text-red-400', icon: XCircle },
  }[result.status]
  const Icon = config.icon

  return (
    <div className={`flex items-center gap-1.5 ${config.color} shrink-0`}>
      <span className="text-[10px]">{result.ms != null ? `${result.ms}ms · ` : ''}{config.label}</span>
      <Icon size={14} />
    </div>
  )
}
