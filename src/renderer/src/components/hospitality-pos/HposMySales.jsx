import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, CircleDollarSign, ReceiptText, RefreshCw, Search } from 'lucide-react'
import { useSettings } from '../../app-context'
import { HposButton, HposEmptyState, HposNotice, HposPageHero, HposStatusBadge } from './HposUi'
import { classifyPosTransaction, hasRecordedPosTenderEnvelope } from '../../../../shared/posFinancialTruth'

const dateKeyInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timeZone || 'Africa/Gaborone', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}
const money = (value, currency) => `${currency} ${Number(value || 0).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const orderDate = (order) => String(order.business_date || order.created_at || '').slice(0, 10)
const orderLabel = (order) => order.receipt_number || (order.order_number ? `R-${order.order_number}` : `Order ${String(order.id || '').slice(0, 8)}`)
const transactionState = (order) => classifyPosTransaction(order)
const isCompleted = (order) => transactionState(order) === 'sale'
const stateLabel = (order) => {
  const state = transactionState(order)
  if (state === 'sale') return 'Completed sale'
  if (state === 'return') return 'Return'
  if (state === 'void') return 'Voided'
  if (state === 'cancelled') return 'Cancelled'
  if (state === 'pending') return 'Pending sync'
  if (state === 'failed/manual review') return 'Needs review'
  return 'Unclassified'
}
const paymentLabel = (order = {}) => {
  if (!hasRecordedPosTenderEnvelope(order)) return 'Tender unavailable'
  const rows = Array.isArray(order.payment_breakdown) ? order.payment_breakdown : []
  const methods = [...new Set(rows.map((row) => String(row?.method || row?.type || '').trim()).filter(Boolean))]
  return methods.length > 1 ? 'Split tender' : methods[0] || 'Tender unavailable'
}

export default function HposMySales() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const timeZone = settings?.timezone || 'Africa/Gaborone'
  const today = dateKeyInTimeZone(new Date(), timeZone)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [orders, setOrders] = useState([])
  const [readCompleteness, setReadCompleteness] = useState({ source: 'unknown', complete: false })
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [approvalPin, setApprovalPin] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [stockDisposition, setStockDisposition] = useState('return_to_stock')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const cached = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: false })
      setOrders(cached?.orders || [])
      setReadCompleteness({ source: cached?.source || 'local_cache', complete: cached?.complete === true })
      setMessage('Showing this terminal’s saved sales. Checking for updates…')
      setLoading(false)
      const refreshed = await window.api?.pos?.getSharedTillHistory?.(start, end, { refresh: true })
      setOrders(refreshed?.orders || [])
      setReadCompleteness({ source: refreshed?.source || 'server', complete: refreshed?.complete === true })
      setMessage(refreshed?.refreshed ? 'Up to date with the server.' : 'Offline: showing this terminal’s saved sales.')
    } catch (loadError) {
      setOrders([])
      setReadCompleteness({ source: 'error', complete: false })
      setError(loadError?.message || 'Unlock Till with your Staff PIN to view your sales.')
    } finally { setLoading(false) }
  }, [start, end])

  useEffect(() => { load() }, [load])
  const visibleOrders = useMemo(() => {
    const term = query.trim().toLowerCase()
    return orders.filter((order) => !term || `${orderLabel(order)} ${order.table_name || ''} ${order.service_mode || ''} ${order.payment_method || ''}`.toLowerCase().includes(term))
  }, [orders, query])
  const completed = useMemo(() => visibleOrders.filter(isCompleted), [visibleOrders])
  const tips = useMemo(() => completed.reduce((sum, order) => sum + Number(order.tip_total || 0), 0), [completed])
  const salesExcludingTips = useMemo(() => completed.reduce((sum, order) => sum + Number(order.total || 0) - Number(order.tip_total || 0), 0), [completed])
  const financialReady = readCompleteness.complete === true
  const selectOrder = (order) => { setSelected(order); setApprovalPin(''); setVoidReason(''); setStockDisposition('return_to_stock'); setVoidError('') }
  const closeReceipt = () => { if (!voiding) { setSelected(null); setApprovalPin(''); setVoidReason(''); setVoidError('') } }
  const submitVoid = async (event) => {
    event.preventDefault()
    if (!selected?.id || !approvalPin || !voidReason.trim()) { setVoidError('A manager, supervisor or admin PIN and a reason are required.'); return }
    setVoiding(true); setVoidError('')
    try {
      const result = await window.api?.pos?.approveVoidWithPin?.({ order_id: selected.id, pin: approvalPin, reason: voidReason.trim(), direct_stock_disposition: stockDisposition, outlet_id: selected.outlet_id || null })
      if (!result?.success) throw new Error(result?.error || 'The correction could not be approved.')
      setMessage(result?.offline ? 'Correction is pending server confirmation.' : 'Sale corrected. Receipt, stock outcome and audit trail are updated.')
      closeReceipt(); await load()
    } catch (submitError) { setVoidError(submitError?.message || 'The correction could not be approved.') }
    finally { setVoiding(false) }
  }
  const selectedHasDirectStock = (selected?.pos_order_items || []).some((item) => item.inventory_item_id)

  return <div className="hpos-my-sales">
    <HposPageHero eyebrow="Shared Till" title="My sales" description="These are the sales assigned to the Staff PIN that unlocked this Till. Open a receipt to request a manager-approved correction." actions={<div className="hpos-my-sales-actions"><HposButton icon={ArrowLeft} onClick={() => { window.location.hash = '/hpos/pos' }}>Back to Till</HposButton><HposButton icon={RefreshCw} onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</HposButton></div>} />
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {!error && <HposNotice tone={financialReady ? 'info' : 'warning'}>{financialReady ? (message || 'Loading your PIN-verified sales…') : 'Financial totals are unavailable until the PIN-verified server history is complete. Cached sales remain visible for audit only.'}</HposNotice>}
    <section className="hpos-my-sales-summary">
      <div><span><CircleDollarSign size={19}/></span><small>Sales excluding tips</small><strong>{financialReady ? money(salesExcludingTips, currency) : 'Unavailable'}</strong><p>Completed sale value before gratuities.</p></div>
      <div><span><CircleDollarSign size={19}/></span><small>Tips recorded</small><strong>{financialReady ? money(tips, currency) : 'Unavailable'}</strong><p>Tips retained or payable under the tip policy.</p></div>
      <div><span><ReceiptText size={19}/></span><small>Receipts</small><strong>{financialReady ? completed.length : 'Unavailable'}</strong><p>Voided receipts remain visible below.</p></div>
      <div><span><CalendarDays size={19}/></span><small>Period</small><strong>{start === end ? start : `${start} – ${end}`}</strong><p>Business-day dates, not UTC dates.</p></div>
    </section>
    <section className="hpos-my-sales-list">
      <header><div><p className="hpos-eyebrow">PIN-verified history</p><h2>Transactions</h2><small>Tap a receipt to view the items and payment recorded.</small></div><div className="hpos-my-sales-filters"><label>From<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>To<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div></header>
      <label className="hpos-my-sales-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipt, table or payment" /></label>
      <div className="hpos-my-sales-rows">
        {visibleOrders.map((order) => { const state = transactionState(order); return <button key={order.id} type="button" onClick={() => selectOrder(order)}><div><strong>{orderLabel(order)}</strong><span>{order.table_name || order.service_mode || 'Counter'} · {paymentLabel(order)}{financialReady && Number(order.tip_total || 0) > 0 ? ` · Tip ${money(order.tip_total, currency)}` : ''}</span></div><div><HposStatusBadge tone={state === 'sale' ? 'success' : state === 'pending' ? 'warning' : 'danger'}>{stateLabel(order)}</HposStatusBadge><strong>{financialReady ? money(order.total, currency) : 'Unavailable'}</strong><ChevronRight size={18}/></div></button> })}
        {!loading && !visibleOrders.length && <HposEmptyState icon={ReceiptText} title="No sales in this period" description="Try another business day, or unlock Till with the Staff PIN used to take the sale." />}
      </div>
    </section>
    {selected && <div className="hpos-modal-backdrop" role="presentation"><section className="hpos-service-dialog hpos-my-sales-detail" role="dialog" aria-modal="true" aria-label="My sale receipt details"><header><div><p className="hpos-eyebrow">Receipt detail</p><h2>{orderLabel(selected)}</h2><p>{orderDate(selected)} · {selected.table_name || selected.service_mode || 'Counter'}</p></div><HposButton onClick={closeReceipt} disabled={voiding}>Close</HposButton></header><div className="hpos-my-sales-detail-total"><span>{paymentLabel(selected)} · {stateLabel(selected)}</span><strong>{financialReady ? money(selected.total, currency) : 'Unavailable'}</strong></div>{financialReady && Number(selected.tip_total || 0) > 0 && <div className="hpos-my-sales-tip"><span>Tip recorded</span><strong>{money(selected.tip_total, currency)}</strong><small>This is shown separately from sales so tip handling remains clear.</small></div>}<div className="hpos-my-sales-detail-items">{(selected.pos_order_items || []).map((item, index) => { const itemTotal = item.net_subtotal ?? item.subtotal ?? item.gross_subtotal; return <p key={item.id || index}><span>{item.quantity} × {item.item_name}</span><strong>{!financialReady || itemTotal === null || itemTotal === undefined ? 'Unavailable' : money(itemTotal, currency)}</strong></p> })}{!(selected.pos_order_items || []).length && <p>Item detail is unavailable for this saved receipt.</p>}</div>{financialReady && isCompleted(selected) ? <form className="hpos-my-sales-void" onSubmit={submitVoid}><h3>{selectedHasDirectStock ? 'Void sale / packaged return' : 'Record prepared-item cancellation'}</h3><p>{selectedHasDirectStock ? 'Choose what happened to the unopened packaged item, give the reason, then ask a supervisor, manager or admin to enter their PIN here.' : 'The food or cocktail was prepared, so its ingredients stay consumed. Give the reason, then ask a supervisor, manager or admin to enter their PIN to record the financial correction.'}</p>{voidError && <HposNotice tone="error">{voidError}</HposNotice>}<label>Reason<input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength="200" placeholder="Explain why this sale must be corrected" disabled={voiding} required /></label>{selectedHasDirectStock && <label>Packaged stock outcome<select value={stockDisposition} onChange={(event) => setStockDisposition(event.target.value)} disabled={voiding}><option value="return_to_stock">Returned unopened — restore stock</option><option value="consumed_or_damaged">Opened, broken or damaged — keep stock depleted</option></select><small>Food, cocktails and recipe items always remain consumed.</small></label>}<label>Authorised approver PIN<input type="password" inputMode="numeric" value={approvalPin} onChange={(event) => setApprovalPin(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength="6" disabled={voiding} required /></label><footer><HposButton onClick={closeReceipt} disabled={voiding}>Cancel</HposButton><HposButton tone="primary" type="submit" disabled={voiding}>{voiding ? 'Authorising…' : selectedHasDirectStock ? 'Approve void / return' : 'Approve cancellation'}</HposButton></footer></form> : <p className="hpos-my-sales-detail-help">Only a server-confirmed completed sale can be corrected here. This transaction is {stateLabel(selected).toLowerCase()} and remains visible for audit.</p>}</section></div>}
  </div>
}
