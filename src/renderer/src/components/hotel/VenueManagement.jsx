import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, Users, Calendar, ClipboardList, Truck, Wallet,
  FileCheck, TrendingUp, Plus, Edit3, Trash2, RefreshCw, AlertTriangle,
  X, CheckCircle, Clock, DollarSign, Percent, ArrowRight, Search,
  Ban, Check, ChevronDown, ChevronUp, Save
} from 'lucide-react'

const TABS = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['leads', 'Leads', Users],
  ['availability', 'Venue Availability', Calendar],
  ['runsheets', 'Run Sheets', ClipboardList],
  ['suppliers', 'Suppliers', Truck],
  ['deposits', 'Deposits', Wallet],
  ['settlement', 'Settlement', FileCheck],
  ['profitability', 'Profitability', TrendingUp]
]

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'lost', 'won']
const LEAD_COLORS = { new: 'bg-blue-50 text-blue-700', contacted: 'bg-amber-50 text-amber-700', qualified: 'bg-purple-50 text-purple-700', proposal: 'bg-indigo-50 text-indigo-700', lost: 'bg-red-50 text-red-700', won: 'bg-emerald-50 text-emerald-700' }
const SUPPLIER_STATUSES = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled']
const MILESTONE_STATUSES = ['pending', 'paid', 'waived', 'overdue']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const RUN_SHEET_STATUSES = ['draft', 'final', 'executed']

function money(amount, currency = 'P') {
  const symbol = currency || 'P'
  return `${symbol}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusPill(status, colors, label) {
  const c = colors?.[status] || 'text-slate-600 bg-slate-50'
  return <span className={`ht-status-pill ${c}`}>{label || status}</span>
}

function dateLabel(d) {
  if (!d) return '—'
  if (typeof d === 'string' && d.length <= 10) return d
  try { return new Date(d).toISOString().slice(0, 10) } catch { return String(d).slice(0, 10) }
}

function timeLabel(t) {
  if (!t) return '—'
  if (typeof t === 'string' && t.length <= 8) return t.slice(0, 5)
  return String(t).slice(0, 5)
}

export default function VenueManagement() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [activeTab, setActiveTab] = useState('dashboard')

  const [events, setEvents] = useState([])
  const [leads, setLeads] = useState([])
  const [availabilityRules, setAvailabilityRules] = useState([])
  const [availabilityCalendar, setAvailabilityCalendar] = useState(null)
  const [runSheets, setRunSheets] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [milestones, setMilestones] = useState([])
  const [profitability, setProfitability] = useState(null)
  const [venueReport, setVenueReport] = useState([])

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [leadModal, setLeadModal] = useState(null)
  const [availResourceKey, setAvailResourceKey] = useState('')
  const [availCalendarDate, setAvailCalendarDate] = useState(new Date().toISOString().slice(0, 10))
  const [runSheetModal, setRunSheetModal] = useState(null)
  const [supplierModal, setSupplierModal] = useState(null)
  const [milestoneModal, setMilestoneModal] = useState(null)
  const [settlementForm, setSettlementForm] = useState({ final_total: 0, adjustment_amount: 0, adjustment_type: '', adjustment_reason: '', notes: '' })
  const [settlementResult, setSettlementResult] = useState(null)
  const [settling, setSettling] = useState(false)
  const [settlementKey, setSettlementKey] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [supplierFilterEvent, setSupplierFilterEvent] = useState('')
  const [depositFilterEvent, setDepositFilterEvent] = useState('')

  const today = new Date().toISOString().slice(0, 10)
  const monthStart = useMemo(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().slice(0, 10)
  }, [])
  const monthEnd = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0)
    return d.toISOString().slice(0, 10)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null); setWarnings([])
    const warn = []
    const settle = async (label, promise) => {
      try { return await promise } catch (e) { warn.push(`${label}: ${e?.message || 'failed'}`); return null }
    }
    try {
      const [evts, lds, rpts] = await Promise.all([
        settle('Events', window.api.venueManagement?.getEventLeads ? window.api.events.getAll(null, null) : Promise.resolve([])),
        settle('Leads', window.api.venueManagement?.getEventLeads?.()),
        settle('VenueReport', window.api.venueManagement?.getVenueProfitabilityReport?.(monthStart, monthEnd))
      ])
      if (warn.length && !evts && !lds) {
        setError(warn.join(' · ') || 'Could not load venue management data.')
        return
      }
      setWarnings(warn)
      if (evts) setEvents(Array.isArray(evts) ? evts : [])
      if (lds) setLeads(Array.isArray(lds) ? lds : [])
      if (rpts?.data) setVenueReport(rpts.data)
    } catch (e) {
      setError(e?.message || 'Failed to load venue management')
    } finally { setLoading(false) }
  }, [monthStart, monthEnd])

  useEffect(() => { loadAll() }, [loadAll])

  const leadsByStatus = useMemo(() => {
    const g = { new: [], contacted: [], qualified: [], proposal: [], lost: [], won: [] }
    for (const l of leads) { const s = l.status || 'new'; if (g[s]) g[s].push(l); else g.new.push(l) }
    return g
  }, [leads])

  const leadConversionRate = useMemo(() => {
    const total = leads.length
    if (!total) return 0
    const won = leads.filter((l) => l.status === 'won').length
    return Math.round((won / total) * 100)
  }, [leads])

  const upcomingDeposits = useMemo(() => {
    const all = []
    for (const m of milestones) {
      if (m.status === 'pending' && m.due_date && m.due_date >= today) all.push(m)
    }
    return all.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 10)
  }, [milestones, today])

  const pendingRunSheets = useMemo(() => {
    return runSheets.filter((r) => r.status === 'draft')
  }, [runSheets])

  const activeEvents = useMemo(() => {
    return events.filter((e) => e.status === 'active' || e.status === 'confirmed').slice(0, 10)
  }, [events])

  // ── Lead handlers ────────────────────────────────────────────────────────
  const handleSaveLead = async () => {
    if (!leadModal?.contact_name?.trim()) return
    try {
      if (leadModal.id) {
        await window.api.venueManagement.updateEventLead(leadModal.id, leadModal)
      } else {
        await window.api.venueManagement.createEventLead(leadModal)
      }
      setLeadModal(null); loadAll()
    } catch (e) { setError(e?.message || 'Failed to save lead') }
  }

  const handleConvertLead = async (leadId) => {
    try {
      const result = await window.api.venueManagement.convertLeadToBooking(leadId)
      if (result?.success === false) { setError(result.error || 'Conversion failed'); return }
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to convert lead') }
  }

  // ── Availability handlers ────────────────────────────────────────────────
  const handleLoadAvailability = async () => {
    try {
      const rules = await window.api.venueManagement.getVenueAvailabilityRules(availResourceKey || null)
      setAvailabilityRules(Array.isArray(rules) ? rules : [])
    } catch (e) { setError(e?.message || 'Failed to load availability rules') }
  }

  const handleToggleAvailability = async (rule) => {
    try {
      const payload = {
        resource_key: rule.resource_key || availResourceKey || 'default',
        day_of_week: rule.day_of_week,
        start_time: rule.start_time || '09:00',
        end_time: rule.end_time || '17:00',
        is_available: !rule.is_available,
        reason_if_unavailable: rule.is_available ? 'Manually closed' : null
      }
      const result = await window.api.venueManagement.upsertVenueAvailabilityRule(payload)
      if (result?.success === false) { setError(result.error || 'Failed to update'); return }
      handleLoadAvailability()
    } catch (e) { setError(e?.message || 'Failed to toggle availability') }
  }

  const handleLoadCalendar = async () => {
    if (!availResourceKey) { setError('Select a venue/resource key first'); return }
    const end = new Date(availCalendarDate)
    end.setDate(end.getDate() + 30)
    try {
      const data = await window.api.venueManagement.getVenueAvailabilityCalendar(
        availResourceKey, availCalendarDate, end.toISOString().slice(0, 10)
      )
      setAvailabilityCalendar(data)
    } catch (e) { setError(e?.message || 'Failed to load calendar') }
  }

  // ── Run Sheet handlers ───────────────────────────────────────────────────
  const handleLoadRunSheet = async (eventBookingId) => {
    try {
      const data = await window.api.venueManagement.getRunSheet(eventBookingId)
      const existing = data?.id ? data : null
      setRunSheetModal(existing || { event_booking_id: eventBookingId, title: '', event_date: today, setup_notes: '', timeline: [], catering_notes: '', audio_visual_notes: '', floor_plan_notes: '', special_instructions: '', status: 'draft' })
      return existing
    } catch (e) { setError(e?.message || 'Failed to load run sheet') }
  }

  const handleSaveRunSheet = async () => {
    if (!runSheetModal?.title?.trim() || !runSheetModal?.event_booking_id) return
    try {
      if (runSheetModal.id) {
        await window.api.venueManagement.updateRunSheet(runSheetModal.id, runSheetModal)
      } else {
        await window.api.venueManagement.createRunSheet(runSheetModal)
      }
      setRunSheetModal(null); loadAll()
    } catch (e) { setError(e?.message || 'Failed to save run sheet') }
  }

  const handleFinalizeRunSheet = async (id) => {
    try {
      const result = await window.api.venueManagement.finalizeRunSheet(id)
      if (result?.success === false) { setError(result.error || 'Failed to finalize'); return }
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to finalize run sheet') }
  }

  const handleExecuteRunSheet = async (id) => {
    try {
      const result = await window.api.venueManagement.executeRunSheet(id)
      if (result?.success === false) { setError(result.error || 'Failed to execute'); return }
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to execute run sheet') }
  }

  const handleAddTimelineItem = () => {
    if (!runSheetModal) return
    setRunSheetModal({
      ...runSheetModal,
      timeline: [...(runSheetModal.timeline || []), { time: '', task: '', assignee: '', notes: '' }]
    })
  }

  const handleUpdateTimelineItem = (idx, field, value) => {
    const t = [...(runSheetModal.timeline || [])]
    if (t[idx]) { t[idx] = { ...t[idx], [field]: value }; setRunSheetModal({ ...runSheetModal, timeline: t }) }
  }

  const handleRemoveTimelineItem = (idx) => {
    const t = [...(runSheetModal.timeline || [])]
    t.splice(idx, 1)
    setRunSheetModal({ ...runSheetModal, timeline: t })
  }

  // ── Supplier handlers ────────────────────────────────────────────────────
  const handleLoadSuppliers = async (eventBookingId) => {
    if (!eventBookingId) return
    setSupplierFilterEvent(eventBookingId)
    try {
      const data = await window.api.venueManagement.getEventSuppliers(eventBookingId)
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (e) { setError(e?.message || 'Failed to load suppliers') }
  }

  const handleSaveSupplier = async () => {
    if (!supplierModal?.supplier_name?.trim() || !supplierModal?.event_booking_id) return
    try {
      if (supplierModal.id) {
        await window.api.venueManagement.updateSupplierEntry(supplierModal.id, supplierModal)
      } else {
        await window.api.venueManagement.createSupplierEntry(supplierModal)
      }
      setSupplierModal(null)
      if (supplierFilterEvent) handleLoadSuppliers(supplierFilterEvent)
    } catch (e) { setError(e?.message || 'Failed to save supplier') }
  }

  const handleUpdateSupplierStatus = async (id, status, actualAmount) => {
    try {
      const result = await window.api.venueManagement.updateSupplierStatus(id, status, actualAmount)
      if (result?.success === false) { setError(result.error || 'Failed to update status'); return }
      if (supplierFilterEvent) handleLoadSuppliers(supplierFilterEvent)
    } catch (e) { setError(e?.message || 'Failed to update supplier status') }
  }

  // ── Deposit handlers ─────────────────────────────────────────────────────
  const handleLoadDeposits = async (eventBookingId) => {
    if (!eventBookingId) return
    setDepositFilterEvent(eventBookingId)
    try {
      const data = await window.api.venueManagement.getDepositMilestones(eventBookingId)
      setMilestones(Array.isArray(data) ? data : [])
    } catch (e) { setError(e?.message || 'Failed to load deposit milestones') }
  }

  const handleSaveMilestone = async () => {
    if (!milestoneModal?.milestone_name?.trim() || !milestoneModal?.event_booking_id) return
    try {
      await window.api.venueManagement.createDepositMilestone(milestoneModal)
      setMilestoneModal(null)
      if (depositFilterEvent) handleLoadDeposits(depositFilterEvent)
    } catch (e) { setError(e?.message || 'Failed to save milestone') }
  }

  const handleMarkPaid = async (id, paidDate, method, reference) => {
    try {
      const result = await window.api.venueManagement.markMilestonePaid(id, paidDate || today, method || 'cash', reference || '')
      if (result?.success === false) { setError(result.error || 'Failed to mark paid'); return }
      if (depositFilterEvent) handleLoadDeposits(depositFilterEvent)
    } catch (e) { setError(e?.message || 'Failed to mark milestone paid') }
  }

  const handleWaive = async (id) => {
    try {
      const result = await window.api.venueManagement.waiveMilestone(id, prompt('Reason for waiving:') || '')
      if (result?.success === false) { setError(result.error || 'Failed to waive'); return }
      if (depositFilterEvent) handleLoadDeposits(depositFilterEvent)
    } catch (e) { setError(e?.message || 'Failed to waive milestone') }
  }

  const depositProgress = useMemo(() => {
    if (!milestones.length) return 0
    const paid = milestones.filter((m) => m.status === 'paid').reduce((s, m) => s + Number(m.amount || 0), 0)
    const total = milestones.reduce((s, m) => s + Number(m.amount || 0), 0)
    return total > 0 ? Math.round((paid / total) * 100) : 0
  }, [milestones])

  // ── Settlement handlers ──────────────────────────────────────────────────
  const handleSettle = async () => {
    if (!selectedEvent) { setError('Select an event first'); return }
    if (settling) return
    setSettling(true)
    setError(null)
    try {
      const key = settlementKey || `settle-${selectedEvent.id}-${Date.now()}`
      if (!settlementKey) setSettlementKey(key)
      const adjType = settlementForm.adjustment_type || null
      const adjReason = settlementForm.adjustment_reason?.trim() || null
      const result = await window.api.venueManagement.settleEvent(
        selectedEvent.id,
        key,
        Number(settlementForm.adjustment_amount || 0),
        adjType,
        adjReason,
        settlementForm.notes?.trim() || null
      )
      if (result?.success === false) {
        setError(result.error || 'Settlement failed')
        return
      }
      setSettlementResult(result)
      setSettlementKey(null)
      loadAll()
    } catch (e) {
      if (e?.message?.includes('already settled')) {
        setSettlementResult({ success: true, message: 'Already settled' })
        setSettlementKey(null)
        loadAll()
      } else {
        setError(e?.message || 'Settlement failed')
      }
    } finally {
      setSettling(false)
    }
  }

  // ── Profitability handlers ───────────────────────────────────────────────
  const handleLoadProfitability = async (eventBookingId) => {
    if (!eventBookingId) return
    try {
      const data = await window.api.venueManagement.getEventProfitability(eventBookingId)
      setProfitability(data)
      setSelectedEvent(events.find((e) => e.id === eventBookingId) || { id: eventBookingId })
    } catch (e) { setError(e?.message || 'Failed to load profitability') }
  }

  if (loading && !events.length && !leads.length) {
    return (
      <div className="bb-page">
        <div className="ht-empty">Loading venue management…</div>
      </div>
    )
  }

  if (error && !events.length && !leads.length) {
    return (
      <div className="bb-page">
        <div className="ht-alert">
          <div>
            <strong>Venue management unavailable</strong>
            <div style={{ marginTop: 4, fontSize: 12 }}>{error}</div>
          </div>
          <button type="button" className="ht-text-btn primary" onClick={loadAll}>Retry</button>
        </div>
      </div>
    )
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return renderDashboard()
      case 'leads': return renderLeads()
      case 'availability': return renderAvailability()
      case 'runsheets': return renderRunSheets()
      case 'suppliers': return renderSuppliers()
      case 'deposits': return renderDeposits()
      case 'settlement': return renderSettlement()
      case 'profitability': return renderProfitability()
      default: return renderDashboard()
    }
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  function renderDashboard() {
    return (
      <>
        <div className="ht-kpi-row">
          <div className="ht-kpi">
            <div className="ht-kpi-label"><span className="ht-dot ok" /> Active Events</div>
            <div className="ht-kpi-value">{activeEvents.length}</div>
            <div className="ht-kpi-hint">{events.length} total this period</div>
          </div>
          <div className="ht-kpi">
            <div className="ht-kpi-label"><span className="ht-dot info" /> Lead Conversion</div>
            <div className="ht-kpi-value">{leadConversionRate}%</div>
            <div className="ht-kpi-hint">{leads.length} total leads</div>
          </div>
          <div className="ht-kpi">
            <div className="ht-kpi-label"><span className="ht-dot warn" /> Upcoming Deposits</div>
            <div className="ht-kpi-value">{upcomingDeposits.length}</div>
            <div className="ht-kpi-hint">Due within the current period</div>
          </div>
          <div className="ht-kpi">
            <div className="ht-kpi-label"><span className="ht-dot danger" /> Pending Run Sheets</div>
            <div className="ht-kpi-value">{pendingRunSheets.length}</div>
            <div className="ht-kpi-hint">Still in draft status</div>
          </div>
        </div>
        <div className="ht-home-grid">
          <section className="ht-card">
            <div className="ht-card-head">
              <h2 className="ht-card-title">Active Events</h2>
              <button type="button" className="ht-text-btn" onClick={() => setActiveTab('runsheets')}>Open</button>
            </div>
            {activeEvents.length === 0 ? (
              <div className="ht-empty">No active events.</div>
            ) : (
              <table className="ht-table">
                <thead><tr><th>Event</th><th>Date</th><th>Client</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {activeEvents.map((e) => (
                    <tr key={e.id}>
                      <td>{e.event_name || e.client_name || 'Event'}</td>
                      <td className="muted">{dateLabel(e.booking_date)}</td>
                      <td>{e.client_name || '—'}</td>
                      <td>{statusPill(e.status, { active: 'bg-emerald-50 text-emerald-700', confirmed: 'bg-blue-50 text-blue-700' })}</td>
                      <td><button type="button" className="ht-text-btn" onClick={() => { setSelectedEvent(e); setActiveTab('settlement') }}>Settle</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="ht-stack">
            <section className="ht-card">
              <div className="ht-card-head"><h2 className="ht-card-title">Leads Pipeline</h2><button type="button" className="ht-text-btn" onClick={() => setActiveTab('leads')}>Manage</button></div>
              <ul className="ht-list">
                {LEAD_STATUSES.filter((s) => s !== 'lost' && s !== 'won').map((s) => (
                  <li key={s}>
                    <span className={`ht-status-pill ${LEAD_COLORS[s] || ''}`}>{s}</span>
                    <span>{leadsByStatus[s]?.length || 0}</span>
                  </li>
                ))}
              </ul>
            </section>
            {warnings.length > 0 && (
              <div className="ht-alert" role="status">
                <AlertTriangle size={14} />
                <div style={{ fontSize: 12 }}>{warnings.join(' · ')}</div>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // ── Leads ────────────────────────────────────────────────────────────────
  function renderLeads() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Event Leads</h2>
          <button type="button" className="ht-text-btn primary" onClick={() => setLeadModal({ contact_name: '', status: 'new', source: 'other' })}>
            <Plus size={14} /> New Lead
          </button>
          <button type="button" className="ht-text-btn" onClick={loadAll}><RefreshCw size={14} /></button>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {LEAD_STATUSES.map((status) => (
            <div key={status} style={{ minWidth: 220, flex: 1 }}>
              <div className={`ht-status-pill ${LEAD_COLORS[status] || ''}`} style={{ display: 'block', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                {status.charAt(0).toUpperCase() + status.slice(1)} ({leadsByStatus[status]?.length || 0})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leadsByStatus[status]?.map((lead) => (
                  <div key={lead.id} className="ht-card" style={{ padding: 10, cursor: 'pointer' }} onClick={() => setLeadModal(lead)}>
                    <strong style={{ fontSize: 13 }}>{lead.contact_name}</strong>
                    {lead.company_name && <div className="muted" style={{ fontSize: 11 }}>{lead.company_name}</div>}
                    {lead.contact_email && <div className="muted" style={{ fontSize: 11 }}>{lead.contact_email}</div>}
                    {lead.estimated_attendees && <div className="muted" style={{ fontSize: 11 }}>{lead.estimated_attendees} guests</div>}
                    {lead.preferred_date && <div className="muted" style={{ fontSize: 11 }}>{dateLabel(lead.preferred_date)}</div>}
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      {lead.status !== 'won' && lead.status !== 'lost' && (
                        <button type="button" className="ht-text-btn" style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleConvertLead(lead.id) }}>
                          <ArrowRight size={12} /> Convert
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(!leadsByStatus[status] || leadsByStatus[status].length === 0) && (
                  <div className="ht-empty" style={{ fontSize: 12, padding: 12 }}>No leads</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {leadModal && (
          <div className="modal-overlay" onClick={() => setLeadModal(null)}>
            <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{leadModal.id ? 'Edit Lead' : 'New Lead'}</h3>
                <button type="button" className="ht-text-btn" onClick={() => setLeadModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input className="ht-input" placeholder="Contact name *" value={leadModal.contact_name || ''} onChange={(e) => setLeadModal({ ...leadModal, contact_name: e.target.value })} />
                <input className="ht-input" placeholder="Company name" value={leadModal.company_name || ''} onChange={(e) => setLeadModal({ ...leadModal, company_name: e.target.value })} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" placeholder="Email" value={leadModal.contact_email || ''} onChange={(e) => setLeadModal({ ...leadModal, contact_email: e.target.value })} style={{ flex: 1 }} />
                  <input className="ht-input" placeholder="Phone" value={leadModal.contact_phone || ''} onChange={(e) => setLeadModal({ ...leadModal, contact_phone: e.target.value })} style={{ flex: 1 }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" placeholder="Event type" value={leadModal.event_type || ''} onChange={(e) => setLeadModal({ ...leadModal, event_type: e.target.value })} style={{ flex: 1 }} />
                  <input className="ht-input" type="number" placeholder="Est. attendees" value={leadModal.estimated_attendees || ''} onChange={(e) => setLeadModal({ ...leadModal, estimated_attendees: Number(e.target.value) })} style={{ width: 120 }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" type="date" placeholder="Preferred date" value={leadModal.preferred_date || ''} onChange={(e) => setLeadModal({ ...leadModal, preferred_date: e.target.value })} style={{ flex: 1 }} />
                  <input className="ht-input" placeholder="Venue" value={leadModal.preferred_venue || ''} onChange={(e) => setLeadModal({ ...leadModal, preferred_venue: e.target.value })} style={{ flex: 1 }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" type="number" placeholder="Budget min" value={leadModal.budget_range_min || ''} onChange={(e) => setLeadModal({ ...leadModal, budget_range_min: Number(e.target.value) })} style={{ flex: 1 }} />
                  <input className="ht-input" type="number" placeholder="Budget max" value={leadModal.budget_range_max || ''} onChange={(e) => setLeadModal({ ...leadModal, budget_range_max: Number(e.target.value) })} style={{ flex: 1 }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <select className="ht-input" value={leadModal.source || 'other'} onChange={(e) => setLeadModal({ ...leadModal, source: e.target.value })} style={{ flex: 1 }}>
                    {['website', 'referral', 'walk-in', 'phone', 'email', 'other'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="ht-input" value={leadModal.status || 'new'} onChange={(e) => setLeadModal({ ...leadModal, status: e.target.value })} style={{ flex: 1 }}>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <textarea className="ht-input" placeholder="Notes" rows={3} value={leadModal.notes || ''} onChange={(e) => setLeadModal({ ...leadModal, notes: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="ht-text-btn" onClick={() => setLeadModal(null)}>Cancel</button>
                <button type="button" className="ht-text-btn primary" onClick={handleSaveLead}>
                  {leadModal.id ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Venue Availability ───────────────────────────────────────────────────
  function renderAvailability() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Venue Availability</h2>
          <input className="ht-input" placeholder="Resource key (venue name)" value={availResourceKey} onChange={(e) => setAvailResourceKey(e.target.value)} style={{ width: 200 }} />
          <button type="button" className="ht-text-btn primary" onClick={handleLoadAvailability}><Search size={14} /> Load Rules</button>
          <input className="ht-input" type="date" value={availCalendarDate} onChange={(e) => setAvailCalendarDate(e.target.value)} style={{ width: 160 }} />
          <button type="button" className="ht-text-btn" onClick={handleLoadCalendar}><Calendar size={14} /> View Calendar</button>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Weekly Rules</h3>
            <table className="ht-table">
              <thead><tr><th>Day</th><th>Available</th><th>Start</th><th>End</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {DAY_NAMES.map((dayName, idx) => {
                  const rule = availabilityRules.find((r) => r.day_of_week === idx)
                  return (
                    <tr key={idx}>
                      <td>{dayName}</td>
                      <td>{rule ? (rule.is_available ? <CheckCircle size={14} className="text-emerald-600" /> : <Ban size={14} className="text-red-600" />) : '—'}</td>
                      <td>{rule ? timeLabel(rule.start_time) : '—'}</td>
                      <td>{rule ? timeLabel(rule.end_time) : '—'}</td>
                      <td className="muted">{rule?.reason_if_unavailable || '—'}</td>
                      <td>
                        <button type="button" className="ht-text-btn" style={{ fontSize: 11 }} onClick={() => handleToggleAvailability(rule || { day_of_week: idx, is_available: true })}>
                          {rule?.is_available ? 'Close' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {availabilityCalendar && (
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Bookings Calendar — {availabilityCalendar.resource_key}</h3>
              <table className="ht-table">
                <thead><tr><th>Date</th><th>Event</th><th>Time</th><th>Client</th><th>Status</th></tr></thead>
                <tbody>
                  {(availabilityCalendar.bookings || []).length === 0 ? (
                    <tr><td colSpan={5} className="ht-empty">No bookings in this period</td></tr>
                  ) : (availabilityCalendar.bookings || []).map((b, i) => (
                    <tr key={i}>
                      <td>{dateLabel(b.booking_date)}</td>
                      <td>{b.event_name || 'Event'}</td>
                      <td>{timeLabel(b.start_time)}–{timeLabel(b.end_time)}</td>
                      <td>{b.client_name || '—'}</td>
                      <td>{statusPill(b.status, { reserved: 'bg-blue-50 text-blue-700', confirmed: 'bg-emerald-50 text-emerald-700' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Run Sheets ───────────────────────────────────────────────────────────
  function renderRunSheets() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Run Sheets</h2>
          <select className="ht-input" style={{ width: 250 }} value={selectedEvent?.id || ''} onChange={(e) => {
            const ev = events.find((evt) => evt.id === e.target.value)
            setSelectedEvent(ev || { id: e.target.value })
            if (e.target.value) handleLoadRunSheet(e.target.value)
          }}>
            <option value="">Select an event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.event_name || e.client_name || 'Event'} — {dateLabel(e.booking_date)}</option>)}
          </select>
          <button type="button" className="ht-text-btn" onClick={loadAll}><RefreshCw size={14} /></button>
        </div>
        {runSheetModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input className="ht-input" placeholder="Run sheet title *" value={runSheetModal.title || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, title: e.target.value })} style={{ flex: 1 }} />
              <input className="ht-input" type="date" value={runSheetModal.event_date || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, event_date: e.target.value })} style={{ width: 160 }} />
              <select className="ht-input" style={{ width: 120 }} value={runSheetModal.status || 'draft'} onChange={(e) => setRunSheetModal({ ...runSheetModal, status: e.target.value })}>
                {RUN_SHEET_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <textarea className="ht-input" placeholder="Setup notes" rows={2} value={runSheetModal.setup_notes || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, setup_notes: e.target.value })} style={{ flex: 1 }} />
              <textarea className="ht-input" placeholder="Catering notes" rows={2} value={runSheetModal.catering_notes || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, catering_notes: e.target.value })} style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <textarea className="ht-input" placeholder="Audio/visual notes" rows={2} value={runSheetModal.audio_visual_notes || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, audio_visual_notes: e.target.value })} style={{ flex: 1 }} />
              <textarea className="ht-input" placeholder="Floor plan notes" rows={2} value={runSheetModal.floor_plan_notes || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, floor_plan_notes: e.target.value })} style={{ flex: 1 }} />
            </div>
            <textarea className="ht-input" placeholder="Special instructions" rows={2} value={runSheetModal.special_instructions || ''} onChange={(e) => setRunSheetModal({ ...runSheetModal, special_instructions: e.target.value })} />
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Timeline</strong>
                <button type="button" className="ht-text-btn" onClick={handleAddTimelineItem}><Plus size={14} /> Add Task</button>
              </div>
              <table className="ht-table">
                <thead><tr><th>Time</th><th>Task</th><th>Assignee</th><th>Notes</th><th /></tr></thead>
                <tbody>
                  {(runSheetModal.timeline || []).length === 0 ? (
                    <tr><td colSpan={5} className="ht-empty">No timeline items. Add tasks for this run sheet.</td></tr>
                  ) : (runSheetModal.timeline || []).map((item, idx) => (
                    <tr key={idx}>
                      <td><input className="ht-input" style={{ width: 80 }} placeholder="09:00" value={item.time || ''} onChange={(e) => handleUpdateTimelineItem(idx, 'time', e.target.value)} /></td>
                      <td><input className="ht-input" placeholder="Task description" value={item.task || ''} onChange={(e) => handleUpdateTimelineItem(idx, 'task', e.target.value)} /></td>
                      <td><input className="ht-input" style={{ width: 140 }} placeholder="Assignee" value={item.assignee || ''} onChange={(e) => handleUpdateTimelineItem(idx, 'assignee', e.target.value)} /></td>
                      <td><input className="ht-input" placeholder="Notes" value={item.notes || ''} onChange={(e) => handleUpdateTimelineItem(idx, 'notes', e.target.value)} /></td>
                      <td><button type="button" className="ht-text-btn" onClick={() => handleRemoveTimelineItem(idx)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="ht-text-btn" onClick={() => setRunSheetModal(null)}>Cancel</button>
              {runSheetModal.id && runSheetModal.status === 'draft' && (
                <button type="button" className="ht-text-btn" onClick={() => handleFinalizeRunSheet(runSheetModal.id)}><Check size={14} /> Finalize</button>
              )}
              {runSheetModal.id && runSheetModal.status === 'final' && (
                <button type="button" className="ht-text-btn" onClick={() => handleExecuteRunSheet(runSheetModal.id)}><CheckCircle size={14} /> Execute</button>
              )}
              <button type="button" className="ht-text-btn primary" onClick={handleSaveRunSheet}><Save size={14} /> {runSheetModal.id ? 'Update' : 'Create'} Run Sheet</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Suppliers ────────────────────────────────────────────────────────────
  function renderSuppliers() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Supplier Coordination</h2>
          <select className="ht-input" style={{ width: 250 }} value={supplierFilterEvent} onChange={(e) => { if (e.target.value) handleLoadSuppliers(e.target.value); else setSuppliers([]) }}>
            <option value="">Select an event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.event_name || e.client_name || 'Event'} — {dateLabel(e.booking_date)}</option>)}
          </select>
          {supplierFilterEvent && (
            <button type="button" className="ht-text-btn primary" onClick={() => setSupplierModal({ event_booking_id: supplierFilterEvent, supplier_name: '', status: 'pending' })}>
              <Plus size={14} /> Add Supplier
            </button>
          )}
        </div>
        <table className="ht-table">
          <thead><tr><th>Supplier</th><th>Contact</th><th>Service</th><th>Quoted</th><th>Actual</th><th>Arrival</th><th>Status</th><th /></tr></thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr><td colSpan={8} className="ht-empty">Select an event and load suppliers, or add a new supplier entry.</td></tr>
            ) : suppliers.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.supplier_name}</strong></td>
                <td className="muted">{s.contact_person || '—'}<br />{s.contact_phone || ''}</td>
                <td className="muted">{s.service_description || '—'}</td>
                <td>{money(s.quoted_amount)}</td>
                <td>{s.actual_amount != null ? money(s.actual_amount) : '—'}</td>
                <td className="muted">{s.scheduled_arrival ? new Date(s.scheduled_arrival).toLocaleString() : '—'}</td>
                <td>{statusPill(s.status, { pending: 'bg-amber-50 text-amber-700', confirmed: 'bg-blue-50 text-blue-700', arrived: 'bg-purple-50 text-purple-700', completed: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-red-50 text-red-700' })}</td>
                <td>
                  <button type="button" className="ht-text-btn" style={{ fontSize: 11 }} onClick={() => setSupplierModal(s)}><Edit3 size={12} /></button>
                  <select className="ht-input" style={{ width: 100, fontSize: 11, marginLeft: 4 }} value={s.status} onChange={(e) => handleUpdateSupplierStatus(s.id, e.target.value, s.actual_amount)}>
                    {SUPPLIER_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {supplierModal && (
          <div className="modal-overlay" onClick={() => setSupplierModal(null)}>
            <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{supplierModal.id ? 'Edit Supplier' : 'Add Supplier'}</h3>
                <button type="button" className="ht-text-btn" onClick={() => setSupplierModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input className="ht-input" placeholder="Supplier name *" value={supplierModal.supplier_name || ''} onChange={(e) => setSupplierModal({ ...supplierModal, supplier_name: e.target.value })} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" placeholder="Contact person" value={supplierModal.contact_person || ''} onChange={(e) => setSupplierModal({ ...supplierModal, contact_person: e.target.value })} style={{ flex: 1 }} />
                  <input className="ht-input" placeholder="Contact phone" value={supplierModal.contact_phone || ''} onChange={(e) => setSupplierModal({ ...supplierModal, contact_phone: e.target.value })} style={{ flex: 1 }} />
                </div>
                <textarea className="ht-input" placeholder="Service description" rows={2} value={supplierModal.service_description || ''} onChange={(e) => setSupplierModal({ ...supplierModal, service_description: e.target.value })} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" type="number" placeholder="Quoted amount" value={supplierModal.quoted_amount || ''} onChange={(e) => setSupplierModal({ ...supplierModal, quoted_amount: Number(e.target.value) })} style={{ flex: 1 }} />
                  <input className="ht-input" type="number" placeholder="Actual amount" value={supplierModal.actual_amount || ''} onChange={(e) => setSupplierModal({ ...supplierModal, actual_amount: Number(e.target.value) })} style={{ flex: 1 }} />
                </div>
                <input className="ht-input" type="datetime-local" placeholder="Scheduled arrival" value={supplierModal.scheduled_arrival ? new Date(supplierModal.scheduled_arrival).toISOString().slice(0, 16) : ''} onChange={(e) => setSupplierModal({ ...supplierModal, scheduled_arrival: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                <textarea className="ht-input" placeholder="Notes" rows={2} value={supplierModal.notes || ''} onChange={(e) => setSupplierModal({ ...supplierModal, notes: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="ht-text-btn" onClick={() => setSupplierModal(null)}>Cancel</button>
                <button type="button" className="ht-text-btn primary" onClick={handleSaveSupplier}>{supplierModal.id ? 'Update' : 'Create'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Deposits ─────────────────────────────────────────────────────────────
  function renderDeposits() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Deposit Milestones</h2>
          <select className="ht-input" style={{ width: 250 }} value={depositFilterEvent} onChange={(e) => { if (e.target.value) handleLoadDeposits(e.target.value); else setMilestones([]) }}>
            <option value="">Select an event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.event_name || e.client_name || 'Event'} — {dateLabel(e.booking_date)}</option>)}
          </select>
          {depositFilterEvent && (
            <button type="button" className="ht-text-btn primary" onClick={() => setMilestoneModal({ event_booking_id: depositFilterEvent, milestone_name: '', amount: 0, is_percentage: false, percentage_value: 0 })}>
              <Plus size={14} /> Add Milestone
            </button>
          )}
        </div>
        {depositFilterEvent && milestones.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>Payment progress</span>
              <span>{depositProgress}%</span>
            </div>
            <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${depositProgress}%`, background: depositProgress === 100 ? '#16a34a' : '#2563eb', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
        <table className="ht-table">
          <thead><tr><th>Milestone</th><th>Due Date</th><th>Amount</th><th>Type</th><th>Status</th><th>Paid Date</th><th>Method</th><th>Ref</th><th /></tr></thead>
          <tbody>
            {milestones.length === 0 ? (
              <tr><td colSpan={9} className="ht-empty">Select an event to view deposit milestones or add one.</td></tr>
            ) : milestones.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.milestone_name}</strong></td>
                <td className="muted">{dateLabel(m.due_date)}</td>
                <td>{money(m.amount)}</td>
                <td className="muted">{m.is_percentage ? `${m.percentage_value}%` : 'Fixed'}</td>
                <td>{statusPill(m.status, { pending: 'bg-amber-50 text-amber-700', paid: 'bg-emerald-50 text-emerald-700', waived: 'bg-slate-50 text-slate-500', overdue: 'bg-red-50 text-red-700' })}</td>
                <td className="muted">{dateLabel(m.paid_date)}</td>
                <td className="muted">{m.payment_method || '—'}</td>
                <td className="muted">{m.payment_reference || '—'}</td>
                <td>
                  {(m.status === 'pending' || m.status === 'overdue') && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="ht-text-btn" style={{ fontSize: 11 }} onClick={() => {
                        const ref = prompt('Payment reference:', '')
                        const method = prompt('Payment method (cash/transfer/card):', 'cash')
                        if (ref !== null && method) handleMarkPaid(m.id, today, method, ref)
                      }}><DollarSign size={12} /> Pay</button>
                      <button type="button" className="ht-text-btn" style={{ fontSize: 11 }} onClick={() => handleWaive(m.id)}><Ban size={12} /> Waive</button>
                    </div>
                  )}
                  {m.notes && <div className="muted" style={{ fontSize: 11 }}>{m.notes}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {milestoneModal && (
          <div className="modal-overlay" onClick={() => setMilestoneModal(null)}>
            <div className="modal" style={{ maxWidth: 450 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Add Deposit Milestone</h3>
                <button type="button" className="ht-text-btn" onClick={() => setMilestoneModal(null)}><X size={16} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input className="ht-input" placeholder="Milestone name *" value={milestoneModal.milestone_name || ''} onChange={(e) => setMilestoneModal({ ...milestoneModal, milestone_name: e.target.value })} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="ht-input" type="date" value={milestoneModal.due_date || ''} onChange={(e) => setMilestoneModal({ ...milestoneModal, due_date: e.target.value })} style={{ flex: 1 }} />
                  <input className="ht-input" type="number" placeholder="Amount" value={milestoneModal.amount || ''} onChange={(e) => setMilestoneModal({ ...milestoneModal, amount: Number(e.target.value) })} style={{ flex: 1 }} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={milestoneModal.is_percentage || false} onChange={(e) => setMilestoneModal({ ...milestoneModal, is_percentage: e.target.checked, percentage_value: e.target.checked ? milestoneModal.percentage_value : 0 })} />
                  Percentage-based
                </label>
                {milestoneModal.is_percentage && (
                  <input className="ht-input" type="number" placeholder="Percentage value" value={milestoneModal.percentage_value || ''} onChange={(e) => setMilestoneModal({ ...milestoneModal, percentage_value: Number(e.target.value) })} />
                )}
                <textarea className="ht-input" placeholder="Notes" rows={2} value={milestoneModal.notes || ''} onChange={(e) => setMilestoneModal({ ...milestoneModal, notes: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="ht-text-btn" onClick={() => setMilestoneModal(null)}>Cancel</button>
                <button type="button" className="ht-text-btn primary" onClick={handleSaveMilestone}>Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Settlement ───────────────────────────────────────────────────────────
  function renderSettlement() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Event Settlement</h2>
          <select className="ht-input" style={{ width: 250 }} value={selectedEvent?.id || ''} onChange={(e) => {
            const ev = events.find((evt) => evt.id === e.target.value)
            setSelectedEvent(ev || null)
            if (ev) setSettlementForm({ final_total: Number(ev.total_amount || 0), adjustment_amount: 0, adjustment_type: '', adjustment_reason: '', notes: '' })
            setSettlementResult(null)
            setSettlementKey(null)
          }}>
            <option value="">Select an event…</option>
            {events.filter((e) => e.status !== 'cancelled').map((e) => <option key={e.id} value={e.id}>{e.event_name || e.client_name || 'Event'} — {dateLabel(e.booking_date)}</option>)}
          </select>
        </div>
        {selectedEvent && (
          <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ht-card" style={{ padding: 12 }}>
              <strong>Current totals</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, fontSize: 13 }}>
                <span>Total amount:</span><span>{money(selectedEvent.total_amount)}</span>
                <span>Amount paid:</span><span>{money(selectedEvent.amount_paid || selectedEvent.deposit_paid)}</span>
                <span>Balance due:</span><span>{money(selectedEvent.balance_due || Number(selectedEvent.total_amount || 0) - Number(selectedEvent.amount_paid || selectedEvent.deposit_paid || 0))}</span>
                <span>Status:</span><span>{statusPill(selectedEvent.status, { reserved: 'bg-blue-50 text-blue-700', confirmed: 'bg-emerald-50 text-emerald-700', active: 'bg-purple-50 text-purple-700', completed: 'bg-slate-50 text-slate-600' })}</span>
              </div>
            </div>
            <label style={{ fontSize: 13 }}>Final total amount (estimated; server recalculates authoritatively)</label>
            <input className="ht-input" type="number" value={settlementForm.final_total} disabled style={{ opacity: 0.7 }} onChange={() => {}} />
            <label style={{ fontSize: 13 }}>Adjustment amount</label>
            <input className="ht-input" type="number" min="0" value={settlementForm.adjustment_amount} onChange={(e) => setSettlementForm({ ...settlementForm, adjustment_amount: Math.max(0, Number(e.target.value)) })} />
            <label style={{ fontSize: 13 }}>Adjustment type</label>
            <select className="ht-input" value={settlementForm.adjustment_type} onChange={(e) => setSettlementForm({ ...settlementForm, adjustment_type: e.target.value })}>
              <option value="">None</option>
              <option value="credit">Credit</option>
              <option value="waiver">Waiver</option>
              <option value="discount">Discount</option>
            </select>
            <label style={{ fontSize: 13 }}>Adjustment reason</label>
            <input className="ht-input" placeholder="e.g. Damages, early departure discount" value={settlementForm.adjustment_reason} onChange={(e) => setSettlementForm({ ...settlementForm, adjustment_reason: e.target.value })} />
            <textarea className="ht-input" placeholder="Settlement notes" rows={3} value={settlementForm.notes} onChange={(e) => setSettlementForm({ ...settlementForm, notes: e.target.value })} />
            <button type="button" className="ht-text-btn primary" disabled={settling} onClick={handleSettle}>
              {settling ? 'Settling…' : <><FileCheck size={14} /> Settle Event</>}
            </button>
            {settlementResult && (
              <div className="ht-alert" style={{ borderLeft: `4px solid ${settlementResult.balance <= 0 ? '#16a34a' : '#ea580c'}` }}>
                <div>
                  <strong>Settlement recorded</strong>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Final total: {money(settlementResult.final_total)} · Total paid: {money(settlementResult.total_paid)} · Balance: {money(settlementResult.balance)}
                    {settlementResult.adjustment ? ` · Adjustment: ${money(settlementResult.adjustment)}` : ''}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Profitability ────────────────────────────────────────────────────────
  function renderProfitability() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Profitability</h2>
          <select className="ht-input" style={{ width: 250 }} value={selectedEvent?.id || ''} onChange={(e) => { if (e.target.value) handleLoadProfitability(e.target.value); else { setProfitability(null); setSelectedEvent(null) } }}>
            <option value="">Select an event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.event_name || e.client_name || 'Event'} — {dateLabel(e.booking_date)}</option>)}
          </select>
        </div>
        {profitability && profitability.success !== false && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="ht-kpi-row">
                <div className="ht-kpi">
                  <div className="ht-kpi-label">Revenue</div>
                  <div className="ht-kpi-value" style={{ color: '#16a34a' }}>{money(profitability.revenue)}</div>
                </div>
                <div className="ht-kpi">
                  <div className="ht-kpi-label">Supplier Costs</div>
                  <div className="ht-kpi-value" style={{ color: '#dc2626' }}>{money(profitability.supplier_costs)}</div>
                </div>
                <div className="ht-kpi">
                  <div className="ht-kpi-label">Line Item Costs</div>
                  <div className="ht-kpi-value" style={{ color: '#dc2626' }}>{money(profitability.line_item_costs)}</div>
                </div>
                <div className="ht-kpi">
                  <div className="ht-kpi-label">Total Costs</div>
                  <div className="ht-kpi-value" style={{ color: '#ea580c' }}>{money(profitability.total_costs)}</div>
                </div>
                <div className="ht-kpi">
                  <div className="ht-kpi-label">Profit</div>
                  <div className="ht-kpi-value" style={{ color: profitability.profit >= 0 ? '#16a34a' : '#dc2626' }}>{money(profitability.profit)}</div>
                  <div className="ht-kpi-hint">{profitability.margin_percent}% margin</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {profitability && profitability.success === false && (
          <div className="ht-empty">{profitability.error || 'Could not load profitability'}</div>
        )}
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Venue Profitability Report ({monthStart} to {monthEnd})</h3>
          <table className="ht-table">
            <thead><tr><th>Venue</th><th>Month</th><th>Events</th><th>Revenue</th><th>Amount Paid</th><th>Outstanding</th></tr></thead>
            <tbody>
              {venueReport.length === 0 ? (
                <tr><td colSpan={6} className="ht-empty">No data for the current month range.</td></tr>
              ) : venueReport.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.venue}</strong></td>
                  <td className="muted">{r.month}</td>
                  <td>{r.event_count}</td>
                  <td>{money(r.revenue)}</td>
                  <td>{money(r.amount_paid)}</td>
                  <td>{money(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header" style={{ marginBottom: 16 }}>
        <h1 className="bb-page-header-title">Venue Management</h1>
        <p className="bb-page-header-subtitle">Event leads, venue availability, run sheets, supplier coordination, deposits, settlement, and profitability</p>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e2e8f0', paddingBottom: 0 }}>
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className={`ht-tab ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', cursor: 'pointer', border: 'none', background: activeTab === key ? '#f1f5f9' : 'transparent', borderBottom: activeTab === key ? '2px solid #2563eb' : '2px solid transparent', fontWeight: activeTab === key ? 600 : 400, fontSize: 13, color: activeTab === key ? '#1e293b' : '#64748b' }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="ht-alert" role="status" style={{ marginBottom: 16 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button type="button" className="ht-text-btn" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {renderTab()}
    </div>
  )
}
