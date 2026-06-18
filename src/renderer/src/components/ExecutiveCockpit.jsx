import { useState, useEffect, useCallback } from 'react'
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, Clock, DollarSign, Users, Server, LifeBuoy, Bell, Building2, Rocket, CheckCircle, XCircle, ArrowUpRight } from 'lucide-react'
import { safeLoadAll, hasPartialFailures, getFailureSummary } from '../utils/safeLoad'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatCard({ label, value, color = 'text-white', icon: Icon, sub, trend }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-gray-400" />}
          <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
        </div>
        {trend != null && (
          <span className={`flex items-center gap-0.5 text-[10px] font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {trend >= 0 ? '+' : ''}{trend}
          </span>
        )}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function MiniBar({ label, current, max, color = 'bg-purple-500' }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 text-gray-400 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right text-gray-300 font-mono">{current}/{max}</span>
    </div>
  )
}

export default function ExecutiveCockpit({ companies, licenses, tickets, activityLogs }) {
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [leads, setLeads] = useState([])
  const [fleetSummary, setFleetSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadWarnings, setLoadWarnings] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadWarnings(null)
    try {
      const { data, errors } = await safeLoadAll(
        window.api.admin.getInvoices?.({}) || Promise.resolve([]),
        window.api.admin.getExpenses?.({}) || Promise.resolve([]),
        window.api.admin.getMarketingLeads?.({}) || Promise.resolve([]),
        window.api.admin.getFleetHealthSummary?.() || Promise.resolve(null)
      )
      const [invData, expData, leadData, fleet] = data
      setInvoices(Array.isArray(invData) ? invData : [])
      setExpenses(Array.isArray(expData) ? expData : [])
      setLeads(Array.isArray(leadData) ? leadData : (leadData?.leads || []))
      setFleetSummary(fleet)
      if (hasPartialFailures(errors)) {
        setLoadWarnings(getFailureSummary(errors, ['Invoices', 'Expenses', 'Leads', 'Fleet Health']))
      }
    } catch (err) {
      setError(err?.message || 'Failed to load cockpit data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const today = new Date()
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAhead = new Date(today); thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30)

  // ── Company metrics ──────────────────────────────────────────────────────
  const totalCompanies = companies.length
  const activeCompanies = companies.filter(c => c.status !== 'disabled').length
  const proLodges = licenses.filter(l => {
    const plan = (l.subscription_plan || '').toLowerCase()
    return l.is_active !== false && plan === 'pro'
  })
  const activeProCount = new Set(proLodges.map(l => l.lodge_id)).size

  // ── Trial metrics ────────────────────────────────────────────────────────
  const companiesWithTrials = companies.filter(c => c.trial_started_at && !licenses.some(l => l.lodge_id === c.lodge_id && l.is_active !== false))
  const trialsEndingSoon = companiesWithTrials.filter(c => {
    const end = new Date(c.trial_started_at); end.setDate(end.getDate() + 30)
    const daysLeft = Math.ceil((end - today) / 864e5)
    return daysLeft > 0 && daysLeft <= 7
  })
  const trialsExpired = companiesWithTrials.filter(c => {
    const end = new Date(c.trial_started_at); end.setDate(end.getDate() + 30)
    return end < today
  })

  // ── Invoice metrics ──────────────────────────────────────────────────────
  const overdueInvoices = invoices.filter(i => i.status === 'overdue' || i.status === 'unpaid')
  const overdueCount = overdueInvoices.length
  const overdueTotal = overdueInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
  const paidThisMonth = invoices.filter(i => i.status === 'paid' && new Date(i.paid_date || i.updated_at) >= thirtyDaysAgo)
  const mrr = paidThisMonth.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
  const arr = mrr * 12

  // ── Support metrics ──────────────────────────────────────────────────────
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress')
  const urgentTickets = openTickets.filter(t => t.priority === 'urgent' || t.priority === 'high')

  // ── Fleet metrics ────────────────────────────────────────────────────────
  const staleDevices = fleetSummary?.stale_devices || 0
  const failedDevices = fleetSummary?.failed_devices || 0
  const totalDevices = fleetSummary?.total_devices || 0

  // ── Sales pipeline ───────────────────────────────────────────────────────
  const newLeads = leads.filter(l => l.status === 'new')
  const contactedLeads = leads.filter(l => l.status === 'contacted')
  const convertedLeads = leads.filter(l => l.status === 'converted')
  const conversionRate = leads.length > 0 ? Math.round((convertedLeads.length / leads.length) * 100) : 0

  // ── Activity ─────────────────────────────────────────────────────────────
  const recentLogs = activityLogs.filter(l => new Date(l.created_at) >= thirtyDaysAgo)

  // ── Attention needed ─────────────────────────────────────────────────────
  const attention = []
  if (overdueCount > 0) attention.push({ icon: DollarSign, color: 'text-red-400', label: `${overdueCount} overdue invoice${overdueCount !== 1 ? 's' : ''}`, sub: `Total: ${fmtMoney(overdueTotal)}` })
  if (trialsEndingSoon.length > 0) attention.push({ icon: Clock, color: 'text-amber-400', label: `${trialsEndingSoon.length} trial${trialsEndingSoon.length !== 1 ? 's' : ''} ending soon`, sub: 'Within 7 days' })
  if (trialsExpired.length > 0) attention.push({ icon: XCircle, color: 'text-red-400', label: `${trialsExpired.length} expired trial${trialsExpired.length !== 1 ? 's' : ''}`, sub: 'Conversion opportunity' })
  if (urgentTickets.length > 0) attention.push({ icon: LifeBuoy, color: 'text-orange-400', label: `${urgentTickets.length} urgent ticket${urgentTickets.length !== 1 ? 's' : ''}`, sub: 'Needs immediate attention' })
  if (failedDevices > 0) attention.push({ icon: Server, color: 'text-red-400', label: `${failedDevices} device${failedDevices !== 1 ? 's' : ''} with failures`, sub: 'Sync issues detected' })
  if (staleDevices > 0) attention.push({ icon: Bell, color: 'text-amber-400', label: `${staleDevices} stale device${staleDevices !== 1 ? 's' : ''}`, sub: 'Haven\'t reported in >10 minutes' })
  if (newLeads.length > 0) attention.push({ icon: ArrowUpRight, color: 'text-blue-400', label: `${newLeads.length} new lead${newLeads.length !== 1 ? 's' : ''}`, sub: 'Awaiting first contact' })

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Executive Cockpit</h2>
        </div>
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-white underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Executive Cockpit</h2>
        </div>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white transition-colors">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {loadWarnings && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <p className="text-amber-300 text-xs flex-1">{loadWarnings}</p>
          <button onClick={load} className="text-xs text-amber-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Attention needed */}
      {attention.length > 0 && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-3">Attention Needed</p>
          <div className="space-y-2">
            {attention.map((a, i) => (
              <div key={i} className="flex items-center gap-3">
                <a.icon size={14} className={a.color} />
                <div>
                  <span className="text-sm text-white">{a.label}</span>
                  {a.sub && <span className="text-xs text-gray-500 ml-2">{a.sub}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Lodges" value={totalCompanies} icon={Building2} sub={`${activeCompanies} active`} />
        <StatCard label="Pro Lodges" value={activeProCount} icon={CheckCircle} color="text-green-400" />
        <StatCard label="Monthly Revenue" value={`$${fmtMoney(mrr)}`} icon={DollarSign} color="text-emerald-400" sub={`ARR: $${fmtMoney(arr)}`} />
        <StatCard label="Open Tickets" value={openTickets.length} icon={LifeBuoy} color={urgentTickets.length > 0 ? 'text-orange-400' : 'text-white'} sub={`${urgentTickets.length} urgent`} />
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Overdue Invoices" value={overdueCount} icon={AlertTriangle} color={overdueCount > 0 ? 'text-red-400' : 'text-green-400'} sub={overdueCount > 0 ? `$${fmtMoney(overdueTotal)} outstanding` : 'All clear'} />
        <StatCard label="Trials (7d)" value={trialsEndingSoon.length} icon={Clock} color={trialsEndingSoon.length > 0 ? 'text-amber-400' : 'text-white'} sub={`${trialsExpired.length} expired`} />
        <StatCard label="Fleet Health" value={totalDevices} icon={Server} color={failedDevices > 0 ? 'text-red-400' : 'text-green-400'} sub={`${failedDevices} failed, ${staleDevices} stale`} />
        <StatCard label="Sales Pipeline" value={leads.length} icon={TrendingUp} color="text-blue-400" sub={`${convertedLeads.length} won (${conversionRate}%)`} />
      </div>

      {/* Two-column layout: Revenue trend + Support burden */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Revenue breakdown */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Revenue Overview</p>
          <div className="space-y-3">
            <MiniBar label="Paid (30d)" current={paidThisMonth.length} max={invoices.length || 1} color="bg-green-500" />
            <MiniBar label="Overdue" current={overdueCount} max={invoices.length || 1} color="bg-red-500" />
            <MiniBar label="Expenses (30d)" current={expenses.filter(e => new Date(e.date || e.created_at) >= thirtyDaysAgo).length} max={expenses.length || 1} color="bg-amber-500" />
          </div>
          <div className="mt-4 pt-3 border-t border-gray-700 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-500">Total Invoiced</p>
              <p className="text-white font-semibold">${fmtMoney(invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0))}</p>
            </div>
            <div>
              <p className="text-gray-500">Total Expenses</p>
              <p className="text-white font-semibold">${fmtMoney(expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</p>
            </div>
          </div>
        </div>

        {/* Support & Activity */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Support & Activity</p>
          <div className="space-y-3">
            <MiniBar label="Open" current={tickets.filter(t => t.status === 'open').length} max={tickets.length || 1} color="bg-yellow-500" />
            <MiniBar label="In Progress" current={tickets.filter(t => t.status === 'in_progress').length} max={tickets.length || 1} color="bg-blue-500" />
            <MiniBar label="Resolved" current={tickets.filter(t => t.status === 'resolved').length} max={tickets.length || 1} color="bg-green-500" />
          </div>
          <div className="mt-4 pt-3 border-t border-gray-700 text-xs">
            <p className="text-gray-500 mb-2">Recent Activity (30d)</p>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-white font-semibold">{recentLogs.length}</span> <span className="text-gray-500">actions</span></div>
              <div><span className="text-white font-semibold">{new Set(recentLogs.map(l => l.lodge_id)).size}</span> <span className="text-gray-500">lodges active</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Sales pipeline */}
      <div className="bg-gray-800 rounded-xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Sales Pipeline</p>
        <div className="flex items-center gap-6">
          {[
            { label: 'New', count: newLeads.length, color: 'text-blue-400' },
            { label: 'Contacted', count: contactedLeads.length, color: 'text-amber-400' },
            { label: 'Converted', count: convertedLeads.length, color: 'text-green-400' },
            { label: 'Dropped', count: leads.filter(l => l.status === 'dropped').length, color: 'text-red-400' }
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-[10px] text-gray-500 uppercase">{s.label}</p>
            </div>
          ))}
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-500">Conversion Rate</p>
            <p className="text-lg font-bold text-white">{conversionRate}%</p>
          </div>
        </div>
      </div>

      {/* Fleet summary */}
      {fleetSummary && (
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Fleet Status</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">{fleetSummary.total_devices}</p>
              <p className="text-[10px] text-gray-500">Total Devices</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-400">{fleetSummary.healthy_devices}</p>
              <p className="text-[10px] text-gray-500">Healthy</p>
            </div>
            <div>
              <p className="text-lg font-bold text-amber-400">{fleetSummary.stale_devices}</p>
              <p className="text-[10px] text-gray-500">Stale</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-400">{fleetSummary.failed_devices}</p>
              <p className="text-[10px] text-gray-500">Failed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
