import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Moon, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getHotelNightAuditChecks } from '../lib/api'
import { money, titleCase } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

export default function HotelNightAudit() {
  const { user } = useAuth()
  const [checks, setChecks] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const load = useCallback(async () => { setLoading(true); setError(''); try { setChecks(await getHotelNightAuditChecks(user.lodge_id)); setUpdatedAt(new Date().toISOString()) } catch (loadError) { setError(loadError?.message || 'Night-audit checks could not load.') } finally { setLoading(false) } }, [user.lodge_id])
  useEffect(() => { load() }, [load])
  const exceptions = Array.isArray(checks?.exceptions) ? checks.exceptions : []
  return <div className="min-h-screen bg-gray-950 pb-24"><header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Night Audit</h1><p className="mt-1 text-xs text-gray-400">Live hotel close checks and exceptions</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div></header><main className="space-y-4 px-4 py-4">{error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}{checks ? <><div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Arrivals</p><p className="mt-1 text-xl font-bold text-white">{Number(checks.arrivals || 0)}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Departures</p><p className="mt-1 text-xl font-bold text-white">{Number(checks.departures || 0)}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">In house</p><p className="mt-1 text-xl font-bold text-emerald-200">{Number(checks.in_house || 0)}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Unpaid in house</p><p className="mt-1 text-xl font-bold text-amber-200">{money(checks.unpaid_balances)}</p></div></div><section className="rounded-2xl bg-gray-800 p-4"><div className="flex items-center gap-2"><Moon size={17} className="text-amber-300" /><h2 className="text-sm font-semibold text-white">Exceptions</h2><span className="ml-auto text-xs text-gray-500">{exceptions.length}</span></div>{exceptions.length === 0 ? <EmptyState icon={CheckCircle2} title="No audit exceptions" message="Current hotel checks have no recorded blockers or warnings." /> : <div className="mt-3 space-y-2">{exceptions.map((item, index) => <div key={`${item.exception_type}-${index}`} className="rounded-xl bg-gray-900 px-3 py-3"><div className="flex items-start gap-3"><AlertTriangle size={17} className={item.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'} /><div><p className="text-sm font-semibold text-white">{titleCase(item.exception_type || 'Audit exception')}</p><p className="mt-1 text-xs text-gray-400">{item.description}</p></div></div></div>)}</div>}</section></> : null}<MobileBoundaryNotice compact>These are live audit checks. Closing, force-closing, reopening, and resolving audit exceptions remain in the controlled Hotel desktop workflow.</MobileBoundaryNotice></main></div>
}
