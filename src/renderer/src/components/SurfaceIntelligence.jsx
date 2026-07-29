import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Server, Smartphone, ShoppingCart, Globe2, Megaphone, LifeBuoy } from 'lucide-react'
import { callAdminApi } from '../utils/adminApi'

const SURFACE_ICON = {
  desktop: Server,
  legacy_pos: ShoppingCart,
  pwa: Smartphone,
  bookings_site: Globe2,
  marketing_site: Megaphone,
  support: LifeBuoy
}

const STATUS_STYLE = {
  healthy: 'bg-green-500/15 text-green-300 border-green-500/30',
  attention: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  quiet: 'bg-gray-700/60 text-gray-300 border-gray-600',
  unknown: 'bg-gray-700/60 text-gray-300 border-gray-600'
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString()
}

function fmtMoney(value, currency = 'BWP') {
  const code = String(currency || 'BWP').toUpperCase()
  return `${code} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtTime(value) {
  if (!value) return 'No signal yet'
  try { return new Date(value).toLocaleString() } catch { return 'No signal yet' }
}

function DetailList({ title, data, money = false, currency = 'BWP' }) {
  const entries = Object.entries(data || {}).filter(([, value]) => Number(value || 0) !== 0).slice(0, 5)
  if (entries.length === 0) return null
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase text-gray-500">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-gray-400">{String(key || 'unknown').replace(/_/g, ' ')}</span>
            <span className="font-semibold text-white">{money ? fmtMoney(value, currency) : fmtNumber(value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SurfaceRow({ surface }) {
  const Icon = SURFACE_ICON[surface.id] || Activity
  const style = STATUS_STYLE[surface.status] || STATUS_STYLE.unknown
  const details = surface.details || {}
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-gray-900 p-2 text-purple-300">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{surface.label}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${style}`}>
                {String(surface.status || 'unknown').replace(/_/g, ' ')}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">{surface.description}</p>
            <p className="mt-2 text-[10px] text-gray-500">Last signal: {fmtTime(surface.last_seen_at)}</p>
          </div>
        </div>
        <div className="grid min-w-[260px] grid-cols-3 gap-2">
          <div className="rounded-lg bg-gray-900/70 px-3 py-2">
            <p className="text-[10px] uppercase text-gray-500">{surface.primary_metric?.label || 'Records'}</p>
            <p className="mt-1 text-lg font-bold text-white">{fmtNumber(surface.primary_metric?.value)}</p>
          </div>
          <div className="rounded-lg bg-gray-900/70 px-3 py-2">
            <p className="text-[10px] uppercase text-gray-500">{surface.secondary_metric?.label || 'Secondary'}</p>
            <p className="mt-1 text-lg font-bold text-white">{fmtNumber(surface.secondary_metric?.value)}</p>
          </div>
          <div className="rounded-lg bg-gray-900/70 px-3 py-2">
            <p className="text-[10px] uppercase text-gray-500">Attention</p>
            <p className={`mt-1 text-lg font-bold ${Number(surface.issue_count || 0) > 0 ? 'text-amber-300' : 'text-green-300'}`}>
              {fmtNumber(surface.issue_count)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <DetailList title="Status" data={details.order_status || details.by_status || details.reconciliation || details.lead_stages} />
        <DetailList title="Source / Role" data={details.booking_sources || details.lead_sources || details.users_by_role || details.sessions_by_role} />
        <DetailList title={details.sales_total !== undefined ? 'Sales' : 'Priority / Method'} data={details.sales_total !== undefined ? { total: details.sales_total } : (details.by_priority || details.payment_methods)} money={details.sales_total !== undefined} currency={surface.currency || details.currency || 'BWP'} />
      </div>
    </div>
  )
}

export default function SurfaceIntelligence() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await callAdminApi('getSurfaceIntelligence', [], { surfaces: [], totals: {}, errors: [] })
      setData(result)
      if (result?.ok === false && result?.error) setError(result.error)
    } catch (err) {
      setError(err?.message || 'Could not load surface intelligence')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totals = data?.totals || {}
  const surfaces = Array.isArray(data?.surfaces) ? data.surfaces : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="text-purple-400" size={20} />
          <div>
            <h2 className="text-lg font-semibold text-white">Surface Intelligence</h2>
            <p className="text-xs text-gray-400">Desktop, legacy POS, PWA, bookings, marketing, and support signals in one place.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600 hover:text-white disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-900/40 bg-red-950/30 p-3">
          <AlertTriangle size={14} className="shrink-0 text-red-400" />
          <p className="flex-1 text-xs text-red-300">{error}</p>
        </div>
      )}

      {data?.errors?.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-900/40 bg-amber-950/30 p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-xs text-amber-300">
            <p className="font-semibold">Some sources could not be read.</p>
            <p className="mt-1 text-amber-300/80">{data.errors.join(' | ')}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg bg-gray-800 p-3">
          <p className="text-[10px] font-semibold uppercase text-gray-400">Devices</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmtNumber(totals.reporting_devices)}</p>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <p className="text-[10px] font-semibold uppercase text-gray-400">Sessions 30d</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmtNumber(totals.sessions_30d)}</p>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <p className="text-[10px] font-semibold uppercase text-gray-400">Commercial Signals</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmtNumber((totals.bookings_90d || 0) + (totals.leads_90d || 0))}</p>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <p className="text-[10px] font-semibold uppercase text-gray-400">Attention</p>
          <p className={`mt-1 text-2xl font-bold ${Number(totals.attention_count || 0) > 0 ? 'text-amber-300' : 'text-green-300'}`}>{fmtNumber(totals.attention_count)}</p>
        </div>
      </div>

      {loading && surfaces.length === 0 ? (
        <div className="rounded-lg bg-gray-800 p-10 text-center text-sm text-gray-500">Loading surface intelligence...</div>
      ) : surfaces.length === 0 ? (
        <div className="rounded-lg bg-gray-800 p-10 text-center text-sm text-gray-500">
          <CheckCircle2 size={28} className="mx-auto mb-3 opacity-40" />
          No surface data is available yet.
        </div>
      ) : (
        <div className="space-y-3">
          {surfaces.map((surface) => <SurfaceRow key={surface.id} surface={surface} />)}
        </div>
      )}
    </div>
  )
}
