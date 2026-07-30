import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Clock3, LayoutGrid, List, MapPinned, RefreshCw, Users } from 'lucide-react'
import { useNavigate } from 'react-router'
import { HposButton, HposEmptyState, HposNotice, HposPageHero, HposStatusBadge } from './HposUi'

const TABLE_STATES = {
  available: { label: 'Available', tone: 'success' },
  occupied: { label: 'Occupied', tone: 'warning' },
  reserved: { label: 'Reserved', tone: 'info' },
  needs_attention: { label: 'Attention', tone: 'danger' }
}

function normalizeTableStatus(rawStatus) {
  if (rawStatus === 'available') return 'available'
  if (rawStatus === 'reserved') return 'reserved'
  if (['needs_attention', 'attention'].includes(rawStatus)) return 'needs_attention'
  return rawStatus ? 'occupied' : 'available'
}

function elapsedMinutes(table) {
  const openedAt = table.tab?.opened_at
  return openedAt ? Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000)) : 0
}

function TableCard({ table, onAction }) {
  const status = normalizeTableStatus(table.status)
  const state = TABLE_STATES[status] || TABLE_STATES.available
  const tab = table.tab || null
  const elapsed = elapsedMinutes(table)
  return <button type="button" className={`hpos-service-table-card is-${status}`} onClick={() => onAction(table)}>
    <div className="hpos-service-table-card__top"><span className="hpos-service-table-card__name">{table.name || table.table_number || `Table ${table.id}`}</span><HposStatusBadge tone={state.tone}>{state.label}</HposStatusBadge></div>
    <div className="hpos-service-table-card__meta"><span><Users size={15}/>{table.seats || 4} seats</span>{elapsed > 0 && <span className={elapsed > 60 ? 'is-late' : ''}><Clock3 size={15}/>{elapsed} min</span>}</div>
    <strong>{tab?.customer_name || tab?.guest_name || table.reservation?.customer_name || (status === 'available' ? 'Ready for guests' : 'Running check')}</strong>
    <div className="hpos-service-table-card__footer"><span>{tab?.waiter_name || (table.reservation ? `${table.reservation.party_size || '—'} guests · reservation` : status === 'available' ? 'Tap to start a transaction' : 'Server unassigned')}</span><ArrowRight size={16}/></div>
  </button>
}

export default function HposFloorPlan({ posRoute = '/hpos/pos', contextLabel = 'Floor plan' }) {
  const navigate = useNavigate()
  const [tables, setTables] = useState([])
  const [viewMode, setViewMode] = useState('floor')
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const loadTables = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    setActionError('')
    try { setTables(await window.api?.pos?.getTablesWithStatus?.() || []) }
    catch (error) { setActionError(error?.message || 'The live floor could not be refreshed.') }
    finally { if (!quiet) setLoading(false) }
  }, [])

  useEffect(() => {
    loadTables()
    const interval = setInterval(() => document.visibilityState === 'visible' && loadTables({ quiet: true }), 10000)
    const onVisible = () => document.visibilityState === 'visible' && loadTables({ quiet: true })
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadTables])

  const stats = Object.fromEntries(Object.keys(TABLE_STATES).map((status) => [status, tables.filter((table) => normalizeTableStatus(table.status) === status).length]))
  const openTill = (table) => navigate(posRoute, { state: { tableName: table.table_number || table.name || '' } })

  return <div className="hpos-page-frame hpos-service-floor">
    <HposPageHero eyebrow="Live dining room" title={contextLabel} description="A real-time view of available, reserved and occupied tables. Tap a table to start or continue its Till transaction." actions={<div className="flex gap-2"><HposButton onClick={() => navigate('/hpos/service')}>Reservations & waitlist</HposButton><HposButton icon={RefreshCw} onClick={() => loadTables()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton></div>}/>
    <section className="hpos-service-floor-toolbar" aria-label="Floor controls"><div className="hpos-service-floor-stats">{Object.entries(stats).map(([status, count]) => <div key={status} className={`is-${status}`}><span>{TABLE_STATES[status].label}</span><strong>{count}</strong></div>)}</div><div className="hpos-service-view-toggle" aria-label="View mode"><button type="button" className={viewMode === 'floor' ? 'is-active' : ''} onClick={() => setViewMode('floor')}><LayoutGrid size={16}/>Floor</button><button type="button" className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')}><List size={16}/>List</button></div></section>
    {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
    {loading ? <div className="hpos-service-loading"><RefreshCw className="is-spinning" size={22}/><span>Preparing the dining room…</span></div> : !tables.length ? <HposEmptyState icon={MapPinned} title="No tables configured" description="A manager can add tables from Manage → Floor & Service before service begins."/> : viewMode === 'floor' ? <section className="hpos-service-floor-map"><div className="hpos-service-floor-map__label"><span>Main dining room</span><small>Tap a table to start or continue its transaction</small></div><div className="hpos-service-table-grid">{tables.map((table) => <TableCard key={table.id} table={table} onAction={openTill}/>)}</div></section> : <section className="hpos-service-table-list"><table><thead><tr>{['Table', 'Seats', 'Status', 'Guest', 'Server', 'Open time', ''].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{tables.map((table) => { const status = normalizeTableStatus(table.status); const tab = table.tab || {}; const elapsed = elapsedMinutes(table); return <tr key={table.id} onClick={() => openTill(table)}><td><strong>{table.name || table.table_number || `Table ${table.id}`}</strong></td><td>{table.seats || 4}</td><td><HposStatusBadge tone={TABLE_STATES[status].tone}>{TABLE_STATES[status].label}</HposStatusBadge></td><td>{tab.customer_name || tab.guest_name || table.reservation?.customer_name || '—'}</td><td>{tab.waiter_name || (table.reservation ? 'Reservation' : '—')}</td><td className={elapsed > 60 ? 'is-late' : ''}>{elapsed ? `${elapsed} min` : '—'}</td><td><ArrowRight size={16}/></td></tr> })}</tbody></table></section>}
  </div>
}
