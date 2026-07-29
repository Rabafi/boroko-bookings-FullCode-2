import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Moon,
  RefreshCw,
  ShieldAlert,
  Unlock
} from 'lucide-react'
import { useAuth } from '../app-context'
import { localToday } from '../utils/localDate'

function severityClass(severity) {
  const s = String(severity || '').toLowerCase()
  if (s === 'critical') return 'bg-red-100 text-red-800 border-red-200'
  if (s === 'warning') return 'bg-amber-100 text-amber-900 border-amber-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function StatCard({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'warn' ? 'border-amber-200 bg-amber-50' :
    tone === 'bad' ? 'border-red-200 bg-red-50' :
    tone === 'good' ? 'border-emerald-200 bg-emerald-50' :
    'border-slate-200 bg-white'
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value ?? '—'}</p>
    </div>
  )
}

export default function NightAuditEnterprise() {
  const { user } = useAuth()
  const actorId = user?.id || user?.user_id || null
  const [checks, setChecks] = useState(null)
  const [summary, setSummary] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [notes, setNotes] = useState('')
  const [force, setForce] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [selectedCloseId, setSelectedCloseId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [checkData, summaryData, historyData] = await Promise.all([
        window.api.nightAudit.runChecks(),
        window.api.nightAudit.getSummary(localToday()),
        window.api.nightAudit.getHistory(20).catch(() => ({ closes: [] }))
      ])
      setChecks(checkData)
      setSummary(summaryData)
      const closes = historyData?.closes || historyData?.history || (Array.isArray(historyData) ? historyData : [])
      setHistory(closes)
    } catch (err) {
      setError(err?.message || 'Failed to load night audit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!success) return undefined
    const t = setTimeout(() => setSuccess(''), 4000)
    return () => clearTimeout(t)
  }, [success])

  const exceptions = useMemo(() => {
    const fromChecks = checks?.exceptions
    if (Array.isArray(fromChecks)) return fromChecks
    if (Array.isArray(summary?.stats?.exceptions)) return summary.stats.exceptions
    return []
  }, [checks, summary])

  const hasCritical = exceptions.some((e) => String(e.severity || '').toLowerCase() === 'critical')
  const alreadyClosed = checks?.already_closed === true || summary?.close?.status === 'closed'

  const handleClose = async () => {
    if (alreadyClosed) {
      setError('Business date is already closed')
      return
    }
    if (hasCritical && !force) {
      setError('Critical exceptions block close. Enable force close only if you understand the risk.')
      return
    }
    setClosing(true)
    setError('')
    try {
      const result = await window.api.nightAudit.close(actorId, notes || null, force)
      setSuccess(`Night audit closed for ${result?.date || localToday()}`)
      setNotes('')
      setForce(false)
      await load()
    } catch (err) {
      setError(err?.message || 'Night audit close failed')
    } finally {
      setClosing(false)
    }
  }

  const handleReopen = async () => {
    if (!selectedCloseId) {
      setError('Select a closed audit to reopen')
      return
    }
    if (!reopenReason.trim()) {
      setError('Reopen reason is required')
      return
    }
    setClosing(true)
    setError('')
    try {
      await window.api.nightAudit.reopen(selectedCloseId, actorId, reopenReason.trim())
      setSuccess('Night audit reopened')
      setReopenReason('')
      setSelectedCloseId(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Reopen failed')
    } finally {
      setClosing(false)
    }
  }

  const handleResolve = async (exceptionId) => {
    try {
      await window.api.nightAudit.resolveException(exceptionId, actorId, 'Resolved from Night Audit Enterprise')
      setSuccess('Exception marked resolved')
      await load()
    } catch (err) {
      setError(err?.message || 'Could not resolve exception')
    }
  }

  if (loading) {
    return (
      <div className="bb-page flex items-center justify-center p-12">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  const stats = summary?.stats || {}
  const live = checks || summary?.live_checks || {}

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">FRONT DESK · ENTERPRISE</p>
          <h1 className="bb-page-header-title flex items-center gap-2">
            <Moon size={22} className="text-indigo-600" />
            Night Audit
          </h1>
          <p className="bb-page-header-subtitle">
            Day cutover checks, exception review, and controlled business-date close.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Arrivals" value={live.arrivals ?? stats.arrivals_today} />
        <StatCard label="Departures due" value={live.departures ?? stats.departures_today} tone={(live.departures || 0) > 0 ? 'warn' : 'default'} />
        <StatCard label="In house" value={live.in_house ?? stats.in_house} />
        <StatCard label="Open hotel folios" value={live.open_hotel_folios ?? stats.open_hotel_folios} tone={(live.open_hotel_folios || 0) > 0 ? 'warn' : 'default'} />
        <StatCard label="Unpaid balances" value={live.unpaid_balances ?? stats.outstanding_balance} tone={(Number(live.unpaid_balances || 0) > 0) ? 'warn' : 'default'} />
        <StatCard
          label="Status"
          value={alreadyClosed ? 'Closed' : (hasCritical ? 'Blocked' : 'Open')}
          tone={alreadyClosed ? 'good' : (hasCritical ? 'bad' : 'default')}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="bb-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h2 className="text-sm font-bold text-slate-900">Exceptions</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{exceptions.length}</span>
          </div>
          {exceptions.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} /> No exceptions for the current business date.
            </div>
          ) : (
            <div className="space-y-2">
              {exceptions.map((ex, idx) => (
                <div key={ex.id || `${ex.exception_type}-${idx}`} className={`rounded-xl border p-3 ${severityClass(ex.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{ex.exception_type || 'exception'}</p>
                      <p className="mt-1 text-xs leading-5 opacity-90">{ex.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[10px] font-bold uppercase">{ex.severity || 'info'}</span>
                      {ex.id && (
                        <button
                          type="button"
                          onClick={() => handleResolve(ex.id)}
                          className="text-xs font-medium underline"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bb-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Close business date</h2>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            Closing marks overdue confirmed arrivals as no-show, records the audit pack, and locks the business date.
            Critical blockers require an explicit force close.
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Optional close notes"
              disabled={alreadyClosed}
            />
          </div>
          <label className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${hasCritical ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={alreadyClosed}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-slate-800">Force close</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Override critical exceptions (e.g. already closed is never overridable server-side).
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={handleClose}
            disabled={closing || alreadyClosed}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {closing ? 'Closing…' : alreadyClosed ? 'Already closed' : 'Close night audit'}
          </button>
        </section>
      </div>

      <section className="bb-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <History size={16} className="text-slate-600" />
          <h2 className="text-sm font-bold text-slate-900">Close history</h2>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No closed audits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="p-2">Business date</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Closed</th>
                  <th className="p-2">Notes</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id || row.close_id} className="border-b hover:bg-slate-50">
                    <td className="p-2 font-medium">{row.business_date}</td>
                    <td className="p-2">{row.status}</td>
                    <td className="p-2 text-xs text-slate-500">{row.closed_at || row.created_at || '—'}</td>
                    <td className="p-2 text-xs text-slate-600">{row.notes || '—'}</td>
                    <td className="p-2">
                      {row.status === 'closed' && (
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-xs font-medium ${selectedCloseId === (row.id || row.close_id) ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}
                          onClick={() => setSelectedCloseId(row.id || row.close_id)}
                        >
                          Select reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedCloseId && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Unlock size={14} /> Reopen selected close
            </div>
            <input
              type="text"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Reason for reopen (required)"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReopen}
                disabled={closing}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Reopen
              </button>
              <button
                type="button"
                onClick={() => { setSelectedCloseId(null); setReopenReason('') }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
