import { useState, useEffect, useCallback } from 'react'
import { Building2, CreditCard, LifeBuoy, Activity, Server, FileText, Clock, CheckCircle, AlertTriangle, AlertCircle, XCircle, RefreshCw, Mail, Phone, MapPin, Calendar, TrendingUp, Users, ArrowLeft, Banknote } from 'lucide-react'
import { safeLoadAll, hasPartialFailures, getFailureSummary } from '../utils/safeLoad'

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtMoney(n, currency = 'BWP') {
  if (n == null) return '—'
  return `${currency || 'BWP'} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Section({ title, icon: Icon, children, error, onRetry }) {
  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        {Icon && <Icon size={14} className="text-purple-400" />}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      </div>
      <div className="p-4">
        {error ? (
          <div className="text-center py-4">
            <AlertCircle size={20} className="mx-auto mb-2 text-red-400 opacity-60" />
            <p className="text-red-300 text-xs">{error}</p>
            {onRetry && <button onClick={onRetry} className="mt-2 text-xs text-gray-400 hover:text-white underline">Retry</button>}
          </div>
        ) : children}
      </div>
    </div>
  )
}

function Badge({ label, color }) {
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{label}</span>
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className="text-sm text-white">{value || '—'}</p>
    </div>
  )
}

export default function Client360({ company, licenses, onBack }) {
  const [invoices, setInvoices] = useState([])
  const [tickets, setTickets] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [devices, setDevices] = useState([])
  const [financialSummary, setFinancialSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadWarnings, setLoadWarnings] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  const lodgeId = company?.lodge_id

  const load = useCallback(async () => {
    if (!lodgeId) return
    setLoading(true)
    setError(null)
    setLoadWarnings(null)
    try {
      const { data, errors } = await safeLoadAll(
        window.api.admin.getInvoicesByLodge?.(lodgeId) || Promise.reject(new Error('Booking invoice API is unavailable. Restart or update the desktop app.')),
        window.api.admin.getSupportTickets?.({ lodge_id: lodgeId }) || Promise.resolve([]),
        window.api.admin.getActivityLogs?.({ lodge_id: lodgeId, limit: 50 }) || Promise.resolve([]),
        window.api.admin.getFleetHealthRollup?.() || Promise.resolve([]),
        window.api.admin.getLodgeFinancialSummary?.() || Promise.reject(new Error('Financial summary API is unavailable. Restart or update the desktop app.'))
      )
      const [invData, ticketData, logData, deviceData, financialData] = data
      setInvoices(Array.isArray(invData) ? invData : [])
      setTickets(Array.isArray(ticketData) ? ticketData : [])
      setActivityLogs(Array.isArray(logData) ? logData : [])
      setDevices((Array.isArray(deviceData) ? deviceData : []).filter(d => d.lodge_id === lodgeId))
      setFinancialSummary(financialData?.lodges?.find(row => String(row.lodge_id) === String(lodgeId)) || null)
      if (financialData?.ok === false) {
        errors[4] = financialData.error || 'Financial summary query failed'
      }
      if (hasPartialFailures(errors)) {
        setLoadWarnings(getFailureSummary(errors, ['Booking Invoices', 'Tickets', 'Activity Logs', 'Fleet Health', 'Financial Summary']))
      }
    } catch (err) {
      setError(err?.message || 'Failed to load client data')
    } finally {
      setLoading(false)
    }
  }, [lodgeId])

  useEffect(() => { load() }, [load])

  // ── Derived data ──────────────────────────────────────────────────────────
  const activeLicense = licenses.find(l => l.lodge_id === lodgeId && l.is_active !== false)
  const plan = activeLicense?.subscription_plan || 'Trial'
  const planColor = plan === 'Pro' ? 'bg-green-500/20 text-green-300' : plan === 'Standard' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-500/20 text-gray-300'

  const overdueInvoices = invoices.filter(i => i.status === 'overdue' || i.status === 'unpaid')
  const totalOwed = Number(financialSummary?.total_outstanding || 0)
  const currency = invoices[0]?.currency || 'BWP'

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress')
  const urgentTickets = openTickets.filter(t => t.priority === 'urgent' || t.priority === 'high')

  const staleDevices = devices.filter(d => d.stale)
  const failedDevices = devices.filter(d => d.failed_queue > 0)
  const healthyDevices = devices.filter(d => !d.stale && !(d.failed_queue > 0))

  // ── Risk assessment ──────────────────────────────────────────────────────
  const risks = []
  if (overdueInvoices.length > 0) risks.push({ label: 'Unpaid invoices', color: 'text-red-400', icon: CreditCard })
  if (!activeLicense || activeLicense.is_active === false) risks.push({ label: 'No active license', color: 'text-amber-400', icon: XCircle })
  if (failedDevices.length > 0) risks.push({ label: 'Sync failures', color: 'text-red-400', icon: Server })
  if (staleDevices.length > 0) risks.push({ label: 'Stale devices', color: 'text-amber-400', icon: Activity })
  if (urgentTickets.length > 0) risks.push({ label: `${urgentTickets.length} urgent ticket(s)`, color: 'text-orange-400', icon: LifeBuoy })
  if (company?.status === 'disabled') risks.push({ label: 'Account disabled', color: 'text-red-400', icon: XCircle })

  if (error && !loading && invoices.length === 0 && tickets.length === 0) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back to Companies
        </button>
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-white underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={14} /> Back to Companies
      </button>

      {loadWarnings && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <p className="text-amber-300 text-xs flex-1">{loadWarnings}</p>
          <button onClick={load} className="text-xs text-amber-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Company header */}
      <div className="bg-gray-800 rounded-xl p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Building2 size={20} className="text-purple-400" />
              <h2 className="text-xl font-bold text-white">{company.lodge_name || '—'}</h2>
              {company.status === 'disabled' && <Badge label="Disabled" color="bg-red-500/20 text-red-300" />}
            </div>
            {company.company_name && <p className="text-sm text-gray-400 ml-8">{company.company_name}</p>}
            <div className="flex items-center gap-4 mt-3 ml-8 text-xs text-gray-500">
              {company.email && <span className="flex items-center gap-1"><Mail size={11} /> {company.email}</span>}
              {company.phone && <span className="flex items-center gap-1"><Phone size={11} /> {company.phone}</span>}
              {company.location && <span className="flex items-center gap-1"><MapPin size={11} /> {company.location}</span>}
            </div>
          </div>
          <div className="text-right">
            <Badge label={plan} color={planColor} />
            <p className="text-[10px] text-gray-500 mt-1">Lodge ID: {lodgeId?.slice(0, 8) || '—'}</p>
            {company.trial_started_at && (
              <p className="text-[10px] text-gray-500 mt-0.5">Trial started: {fmt(company.trial_started_at)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Risk banner */}
      {risks.length > 0 && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-2">Risk Status</p>
          <div className="flex flex-wrap gap-2">
            {risks.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <r.icon size={12} className={r.color} />
                <span className={r.color}>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-white">{invoices.length}</p>
          <p className="text-[10px] text-gray-500">Booking Invoices</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className={`text-lg font-bold ${Number(financialSummary?.unpaid_count || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>{financialSummary?.unpaid_count || 0}</p>
          <p className="text-[10px] text-gray-500">Unpaid Bookings</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className={`text-lg font-bold ${openTickets.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{openTickets.length}</p>
          <p className="text-[10px] text-gray-500">Open Tickets</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className={`text-lg font-bold ${failedDevices.length > 0 ? 'text-red-400' : 'text-green-400'}`}>{devices.length}</p>
          <p className="text-[10px] text-gray-500">Devices</p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-2">
        {['overview', 'invoices', 'tickets', 'devices', 'activity'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${activeTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section title="License & Subscription" icon={CreditCard}>
            {activeLicense ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">Plan</span><span className="text-white">{activeLicense.subscription_plan}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Status</span><span className="text-white">{activeLicense.subscription_state || activeLicense.payment_status || 'active'}</span></div>
                {activeLicense.expires_at && <div className="flex justify-between"><span className="text-gray-400">Expires</span><span className="text-white">{fmt(activeLicense.expires_at)}</span></div>}
                {activeLicense.next_due_date && <div className="flex justify-between"><span className="text-gray-400">Next Due</span><span className="text-white">{fmt(activeLicense.next_due_date)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-400">License Key</span><span className="text-white font-mono text-[10px]">{activeLicense.license_key?.slice(0, 16) || '—'}</span></div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">No active license. Lodge is on trial.</p>
            )}
          </Section>

          <Section title="Financial Summary" icon={Banknote}>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-400">Total Revenue</span><span className="text-white font-semibold">{fmtMoney(financialSummary?.total_revenue || 0, currency)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Total Collected</span><span className="text-green-400 font-semibold">{fmtMoney(financialSummary?.total_collected || 0, currency)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Total Outstanding</span><span className={`font-semibold ${totalOwed > 0 ? 'text-red-400' : 'text-white'}`}>{fmtMoney(totalOwed, currency)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Paid Bookings</span><span className="text-white">{financialSummary?.paid_count || 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Partially Paid</span><span className="text-amber-400">{financialSummary?.partial_count || 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Unpaid</span><span className={Number(financialSummary?.unpaid_count || 0) > 0 ? 'text-red-400' : 'text-white'}>{financialSummary?.unpaid_count || 0}</span></div>
            </div>
          </Section>

          <Section title="Support" icon={LifeBuoy}>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-400">Open Tickets</span><span className="text-white">{openTickets.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Urgent</span><span className={urgentTickets.length > 0 ? 'text-orange-400' : 'text-white'}>{urgentTickets.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Total Tickets</span><span className="text-white">{tickets.length}</span></div>
            </div>
          </Section>

          <Section title="App Health" icon={Server}>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-400">Devices</span><span className="text-white">{devices.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Healthy</span><span className="text-green-400">{healthyDevices.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Stale</span><span className={staleDevices.length > 0 ? 'text-amber-400' : 'text-white'}>{staleDevices.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Failed</span><span className={failedDevices.length > 0 ? 'text-red-400' : 'text-white'}>{failedDevices.length}</span></div>
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'invoices' && (
        <Section title="Invoices" icon={FileText} error={error} onRetry={load}>
          {invoices.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No invoices found.</p>
          ) : (
            <div className="space-y-2">
              {invoices.slice(0, 20).map(inv => (
                <div key={inv.id} className="flex items-center justify-between text-xs py-2 border-b border-gray-700 last:border-0">
                  <div>
                    <span className="text-white">{inv.invoice_number || inv.id?.slice(0, 8)}</span>
                    <span className="text-gray-500 ml-2">{fmt(inv.issued_date || inv.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white font-semibold">{fmtMoney(inv.amount, inv.currency)}</span>
                    <Badge
                      label={inv.status}
                      color={inv.status === 'paid' ? 'bg-green-500/20 text-green-300' : inv.status === 'overdue' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {activeTab === 'tickets' && (
        <Section title="Support Tickets" icon={LifeBuoy} error={error} onRetry={load}>
          {tickets.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No support tickets found.</p>
          ) : (
            <div className="space-y-2">
              {tickets.slice(0, 20).map(t => (
                <div key={t.id} className="flex items-center justify-between text-xs py-2 border-b border-gray-700 last:border-0">
                  <div>
                    <span className="text-white">{t.title}</span>
                    <span className="text-gray-500 ml-2">{fmt(t.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge label={t.priority || 'normal'} color={
                      t.priority === 'urgent' ? 'bg-red-500/20 text-red-300' :
                      t.priority === 'high' ? 'bg-orange-500/20 text-orange-300' :
                      'bg-gray-500/20 text-gray-300'
                    } />
                    <Badge label={t.status} color={
                      t.status === 'open' ? 'bg-yellow-500/20 text-yellow-300' :
                      t.status === 'in_progress' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-green-500/20 text-green-300'
                    } />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {activeTab === 'devices' && (
        <Section title="Device Health" icon={Server} error={error} onRetry={load}>
          {devices.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No devices reporting yet.</p>
          ) : (
            <div className="space-y-2">
              {devices.map(d => (
                <div key={d.device_id} className="flex items-center justify-between text-xs py-2 border-b border-gray-700 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${d.failed_queue > 0 ? 'bg-red-500' : d.stale ? 'bg-amber-500' : 'bg-green-500'}`} />
                    <span className="text-white font-mono">{d.device_id?.slice(0, 12)}</span>
                    <Badge label={d.client_type || 'unknown'} color="bg-gray-700 text-gray-300" />
                  </div>
                  <div className="flex items-center gap-4 text-gray-500">
                    <span>Pending: {d.pending_queue || 0}</span>
                    <span>Failed: {d.failed_queue || 0}</span>
                    <span>Heartbeat: {d.reported_at ? new Date(d.reported_at).toLocaleString() : 'never'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {activeTab === 'activity' && (
        <Section title="Audit Timeline" icon={Activity} error={error} onRetry={load}>
          {activityLogs.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No activity logged yet.</p>
          ) : (
            <div className="space-y-2">
              {activityLogs.slice(0, 30).map(log => (
                <div key={log.id} className="flex items-start gap-3 text-xs py-2 border-b border-gray-700 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white">{log.action}</span>
                      {log.actor_email && <span className="text-gray-500">by {log.actor_email}</span>}
                    </div>
                    {log.details && <p className="text-gray-500 mt-0.5 line-clamp-1">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}</p>}
                  </div>
                  <span className="text-gray-600 shrink-0">{fmt(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {loading && (
        <div className="text-center py-4">
          <RefreshCw size={16} className="mx-auto animate-spin text-gray-500" />
        </div>
      )}
    </div>
  )
}
