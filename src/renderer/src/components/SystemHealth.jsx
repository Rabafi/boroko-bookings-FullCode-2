import { useState, useEffect, useCallback } from 'react'
import { Shield, CheckCircle, XCircle, AlertTriangle, RefreshCw, Database, Server, Bell, CreditCard, Users, Activity } from 'lucide-react'
import { callAdminApi } from '../utils/adminApi'

const CHECKS = [
  { id: 'companies', label: 'Companies Database', icon: Database, method: 'getCompanies' },
  { id: 'licenses', label: 'License System', icon: CreditCard, method: 'getLicenses' },
  { id: 'tickets', label: 'Support Tickets', icon: Bell, method: 'getSupportTickets', args: [{}] },
  { id: 'fleet', label: 'Fleet Health', icon: Server, method: 'getFleetHealthSummary' },
  { id: 'activity', label: 'Activity Logs', icon: Activity, method: 'getActivityLogs', args: [{ limit: 5 }] },
  { id: 'mrr', label: 'Financial (MRR)', icon: CreditCard, method: 'getMrrSummary' },
  { id: 'revenue', label: 'Revenue Data', icon: CreditCard, method: 'getRevenueSummary', args: [7] },
  { id: 'collections', label: 'Collections Queue', icon: CreditCard, method: 'getCollectionsQueue' },
  { id: 'releases', label: 'Release Management', icon: Server, method: 'getReleases' },
  { id: 'notifications', label: 'Notification Inbox', icon: Bell, method: 'getNotifications', args: [{ limit: 5 }] },
  { id: 'automation', label: 'Automation Rules', icon: Activity, method: 'getNotificationRules' },
  { id: 'search', label: 'Global Search', icon: Users, method: 'globalSearch', args: ['test', 3] },
  { id: 'surfaces', label: 'App & Website Surfaces', icon: Server, method: 'getSurfaceIntelligence' },
]

export default function SystemHealth() {
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(false)
  const [runningAt, setRunningAt] = useState(null)

  const runChecks = useCallback(async () => {
    setLoading(true)
    setResults({})
    setRunningAt(new Date())

    const checks = CHECKS.map(async (check) => {
      try {
        const start = Date.now()
        const result = await Promise.race([
          callAdminApi(check.method, check.args || [], {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ])
        const ms = Date.now() - start
        if (result?.ok === false || result?.success === false) {
          return { id: check.id, ok: false, error: result.error || 'Failed', ms, data: result }
        }
        return { id: check.id, ok: true, ms, data: result }
      } catch (err) {
        return { id: check.id, ok: false, error: err?.message || 'Failed', ms: 0 }
      }
    })

    const allResults = await Promise.all(checks)
    const resultsMap = {}
    allResults.forEach(r => { resultsMap[r.id] = r })
    setResults(resultsMap)
    setLoading(false)
  }, [])

  useEffect(() => { runChecks() }, [runChecks])

  const totalChecks = Object.keys(results).length
  const passedChecks = Object.values(results).filter(r => r.ok).length
  const failedChecks = Object.values(results).filter(r => !r.ok).length
  const allPassed = totalChecks > 0 && failedChecks === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">System Self Check</h2>
        </div>
        <button onClick={runChecks} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Running...' : 'Run Checks'}
        </button>
      </div>

      {runningAt && (
        <p className="text-[10px] text-gray-500">Last checked: {runningAt.toLocaleString()}</p>
      )}

      {/* Summary */}
      {totalChecks > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Total Checks</p>
            <p className="text-2xl font-bold text-white">{totalChecks}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Passed</p>
            <p className={`text-2xl font-bold ${passedChecks === totalChecks ? 'text-green-400' : 'text-white'}`}>{passedChecks}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Failed</p>
            <p className={`text-2xl font-bold ${failedChecks > 0 ? 'text-red-400' : 'text-green-400'}`}>{failedChecks}</p>
          </div>
        </div>
      )}

      {/* Overall status */}
      {totalChecks > 0 && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${allPassed ? 'bg-green-950/30 border border-green-900/40' : 'bg-amber-950/30 border border-amber-900/40'}`}>
          {allPassed ? (
            <CheckCircle size={16} className="text-green-400" />
          ) : (
            <AlertTriangle size={16} className="text-amber-400" />
          )}
          <p className={`text-sm font-medium ${allPassed ? 'text-green-300' : 'text-amber-300'}`}>
            {allPassed ? 'All systems operational.' : `${failedChecks} system(s) need attention.`}
          </p>
        </div>
      )}

      {/* Check results */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading && totalChecks === 0 ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Running system checks...</div>
        ) : (
          <div className="divide-y divide-gray-700">
            {CHECKS.map(check => {
              const result = results[check.id]
              const Icon = check.icon
              return (
                <div key={check.id} className="px-4 py-3 flex items-center gap-3">
                  <Icon size={14} className="text-gray-400 shrink-0" />
                  <span className="text-sm text-white flex-1">{check.label}</span>
                  {result ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">{result.ms}ms</span>
                      {result.ok ? (
                        <CheckCircle size={14} className="text-green-400" />
                      ) : (
                        <div className="flex items-center gap-1">
                          <XCircle size={14} className="text-red-400" />
                          <span className="text-[10px] text-red-400">{result.error}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-500">Pending...</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
