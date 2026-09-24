import { useEffect, useRef, useState } from 'react'
import { Printer, X, Download, ShoppingBag } from 'lucide-react'
import { useSettings } from '../../app-context'
import { hasRecordedPosTenderEnvelope, posTenderRows } from '../../../../shared/posFinancialTruth'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function itemLineTotal(item = {}) {
  const authoritative = item.net_subtotal ?? item.subtotal ?? item.gross_subtotal
  if (authoritative !== null && authoritative !== undefined && Number.isFinite(Number(authoritative))) {
    return Number(authoritative)
  }
  // Quantity × unit price is only an estimate. A receipt must never present
  // that estimate as a posted line amount when the server did not persist a
  // subtotal (for example, on an older/incomplete order row).
  return null
}

function recordedMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function POSReceipt({ order, onClose, autoPrint = false, onNewSale = null, onRepeatSale = null }) {
  const { settings } = useSettings()
  const [saving, setSaving] = useState(false)
  const autoPrintDoneRef = useRef(false)
  // Hooks must stay unconditional: an early return before useEffect changes
  // the hook count when `order` flips null <-> object and React throws
  // "Rendered fewer/more hooks than expected", which lands on the app
  // recovery screen. Derive everything null-safely, run effects, then render
  // the empty state. Do not move this guard back above the hooks.
  const safeOrder = order || null

  const currency = settings?.currency || 'P'
  const logo = settings?.logo || ''
  const lodgeName = settings?.company_name || settings?.lodge_name || settings?.property_name || 'Bar'
  const companyName = settings?.company_name && settings?.lodge_name && settings.company_name !== settings.lodge_name
    ? settings.lodge_name
    : ''
  const address = [settings?.address, settings?.city, settings?.country].filter(Boolean).join(', ')
  const phone = settings?.phone || ''
  const email = settings?.email || ''
  const vatNumber = settings?.vat_number || ''

  const rawItems = safeOrder?.pos_order_items ?? safeOrder?.items ?? []
  const orderItems = Array.isArray(rawItems) ? rawItems : []
  const orderDate = safeOrder?.created_at || new Date().toISOString()
  const payments = Array.isArray(safeOrder?.payment_breakdown)
    ? safeOrder.payment_breakdown
    : typeof safeOrder?.payment_breakdown === 'string'
      ? (() => { try { return JSON.parse(safeOrder.payment_breakdown) } catch { return [] } })()
      : []
  const recordedOrderTotal = recordedMoney(safeOrder?.total)
  const tenderLabel = safeOrder && hasRecordedPosTenderEnvelope(safeOrder)
    ? (() => {
      const methods = [...new Set(posTenderRows(safeOrder).map((row) => row.method).filter(Boolean))]
      return methods.length > 1 ? 'Split tender' : methods[0] || 'Tender unavailable'
    })()
    : 'Tender unavailable'

  const receiptNo = safeOrder?.receipt_number || (safeOrder?._pending_sync === true ? 'PROVISIONAL — PENDING SERVER NUMBER' : 'RECEIPT NUMBER UNAVAILABLE')
  const guestLabel = safeOrder?.walk_in_name || (safeOrder?.room_id ? `Room Guest` : 'Walk-in')

  const handlePrint = async () => {
    if (!safeOrder?.receipt_number && safeOrder?._pending_sync !== true) {
      window.alert?.('This sale has no server-issued receipt number. Printing is blocked until the sale is refreshed or resolved.')
      return
    }
    let hardware = {}
    try {
      hardware = await window.api?.pos?.getHardwareSettings?.() || {}
    } catch {
      hardware = {}
    }
    const printerName = hardware?.receipt_printer_name || ''
    let result = null
    try {
      result = await window.api?.receipts?.printCurrent?.({
        mode: hardware?.receipt_print_mode || 'windows',
        order: safeOrder,
        business: settings || {},
        deviceName: printerName,
        silent: Boolean(printerName),
        openDrawer: safeOrder?._open_drawer_on_print === true
      })
    } catch (error) {
      result = { success: false, error: error?.message || 'Print could not be started.' }
    }
    if (!result?.success) window.alert?.(result?.error || 'Print could not be started.')
  }

  const handleSavePDF = async () => {
    if (!safeOrder) {
      window.alert?.('This sale is no longer open on this terminal. Check Sales for the recorded receipt.')
      return
    }
    if (!safeOrder?.receipt_number && safeOrder?._pending_sync !== true) {
      window.alert?.('This sale has no server-issued receipt number. Save is blocked until the sale is refreshed or resolved.')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const result = await window.api?.receipts?.savePDF?.({
        guestName: guestLabel,
        invoiceNumber: receiptNo
      })
      // Cancelled save dialog is not a failure: main returns { success: false }
      // with no error. Only surface a message on a real failure.
      if (result?.success === false && result?.error) throw new Error(result.error)
    } catch (error) {
      window.alert?.(error?.message || 'The receipt PDF could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!autoPrint || !safeOrder || autoPrintDoneRef.current) return undefined
    autoPrintDoneRef.current = true
    const timer = window.setTimeout(() => {
      handlePrint().catch((error) => window.alert?.(error?.message || 'Print could not be started.'))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [autoPrint, safeOrder?.receipt_number, safeOrder?._pending_sync])

  // A cleared or not-yet-loaded sale must never throw during render (that
  // path lands on the app recovery screen). Show an explicit empty state.
  // NB: this return sits AFTER all hooks by design (see note at the top).
  // NB: z-[1100] sits above app modals (hpos-modal-backdrop is z-1000) so the
  // receipt never opens behind a detail/void card; command palette (2000+)
  // stays on top.
  if (!safeOrder) {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 print:hidden">
        <div className="relative w-full max-w-md bg-white shadow-2xl rounded-3xl p-8 text-center">
          <h2 className="font-bold text-slate-800">Receipt unavailable</h2>
          <p className="mt-2 text-sm text-slate-500">This sale is no longer open on this terminal. Check Sales for the recorded receipt.</p>
          <button
            onClick={onClose}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
          >
            <X size={20} /> Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 print:p-0 print:static print:bg-transparent print:backdrop-blur-none">
      <div className="relative w-full max-w-xl bg-white shadow-2xl rounded-3xl overflow-hidden flex flex-col max-h-full print:shadow-none print:max-h-none print:w-full print:rounded-none">
        
        {/* Header - Hidden on print */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 print:hidden">
          <div className="flex items-center gap-2">
            <ShoppingBag className="text-emerald-600" size={20} />
            <h2 className="font-bold text-slate-800">POS Receipt</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSavePDF}
              disabled={saving}
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
              title="Save as PDF"
            >
              <Download size={20} />
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
              title="Print receipt"
            >
              <Printer size={20} /> Print receipt
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors ml-2"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Receipt Content */}
        <div className="flex-1 overflow-y-auto p-8 print:p-0 print:overflow-visible">
          <div id="receipt-content" className="max-w-md mx-auto space-y-8">
            {safeOrder?._pending_sync === true && (
              <div className="border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-amber-800 print:hidden">
                PROVISIONAL — PENDING SERVER CONFIRMATION
              </div>
            )}
            
            {/* Bar/business identity */}
            <div className="text-center space-y-2">
              {logo && <img src={logo} alt="Logo" className="h-16 mx-auto mb-4 object-contain" />}
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">{lodgeName}</h1>
              {companyName && <p className="text-sm font-semibold text-slate-500">{companyName}</p>}
              <div className="text-xs text-slate-400 font-medium space-y-1">
                {address && <p>{address}</p>}
                {(phone || email) && <p>{[phone, email].filter(Boolean).join(' • ')}</p>}
                {vatNumber && <p className="pt-1">VAT No: {vatNumber}</p>}
              </div>
            </div>

            {/* Meta Info */}
            <div className="grid grid-cols-2 gap-4 py-6 border-y border-slate-100 text-sm">
              <div className="space-y-1">
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Receipt No</p>
                <p className="font-bold text-slate-800">{receiptNo}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Date</p>
                <p className="font-bold text-slate-800">{formatDateTime(orderDate)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Customer</p>
                <p className="font-bold text-slate-800">{guestLabel}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Method</p>
                <p className="font-bold text-slate-800 uppercase tracking-tight">{tenderLabel}</p>
              </div>
            </div>

            {/* Items Table */}
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="py-2 text-left font-semibold uppercase tracking-wider text-[10px]">Item</th>
                  <th className="py-2 text-center font-semibold uppercase tracking-wider text-[10px]">Qty</th>
                  <th className="py-2 text-right font-semibold uppercase tracking-wider text-[10px]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orderItems.map((item, idx) => {
                  const line = item || {}
                  const modifiers = Array.isArray(line.modifiers) ? line.modifiers : []
                  return (
                  <tr key={idx}>
                    <td className="py-3 pr-4">
                      <p className="font-bold text-slate-800">{line.item_name || 'Item'}</p>
                      <p className="text-xs text-slate-400 font-medium">
                        {recordedMoney(line.unit_price) === null ? 'Unit price unavailable' : `${currency} ${recordedMoney(line.unit_price).toFixed(2)} ea`}
                      </p>
                      {(modifiers.length > 0 || line.item_notes) && (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {[...modifiers.map((mod) => mod?.name), line.item_notes].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 text-center font-bold text-slate-800">
                      {line.quantity ?? '—'}
                    </td>
                    <td className="py-3 text-right font-black text-slate-900">
                      {itemLineTotal(line) === null ? 'Amount unavailable' : `${currency} ${itemLineTotal(line).toFixed(2)}`}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="space-y-3 pt-4 border-t-2 border-slate-900 border-dotted">
              {Number(safeOrder.gross_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Gross</span>
                  <span>{currency} {Number(safeOrder.gross_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(safeOrder.discount_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-emerald-700">
                  <span>Discount</span>
                  <span>-{currency} {Number(safeOrder.discount_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(safeOrder.tax_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Tax/VAT</span>
                  <span>{currency} {Number(safeOrder.tax_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(safeOrder.tip_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Tip</span>
                  <span>{currency} {Number(safeOrder.tip_total || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-widest text-xs">Total Amount</span>
                <span className="text-2xl font-black text-slate-950">
                  {recordedOrderTotal === null ? 'Amount unavailable' : `${currency} ${recordedOrderTotal.toFixed(2)}`}
                </span>
              </div>
              {payments.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Payments</p>
                  {payments.map((payment, idx) => {
                    const row = payment || {}
                    return (
                    <div key={idx} className="flex justify-between text-xs font-semibold text-slate-600">
                      <span>
                        {row.method || 'Payment'}
                        {row.reference && <span className="ml-2 text-[10px] font-medium text-slate-400">Ref {row.reference}</span>}
                      </span>
                      <span>{recordedMoney(row.amount) === null ? 'Amount unavailable' : `${currency} ${recordedMoney(row.amount).toFixed(2)}`}</span>
                    </div>
                    )
                  })}
                </div>
              )}
              {/* Cash tendering aids: display-only, recorded at sale time on
                  this terminal. Absent values render nothing and are never
                  back-filled from the allocation. */}
              {safeOrder?.cash_received != null && Number.isFinite(Number(safeOrder.cash_received)) && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="flex justify-between text-xs font-semibold text-slate-600">
                    <span>Cash received</span>
                    <span>{currency} {Number(safeOrder.cash_received).toFixed(2)}</span>
                  </div>
                  {safeOrder?.change_due != null && Number.isFinite(Number(safeOrder.change_due)) && (
                    <div className="flex justify-between text-xs font-black text-slate-800">
                      <span>Change</span>
                      <span>{currency} {Number(safeOrder.change_due).toFixed(2)}</span>
                    </div>
                  )}
                  {/* Operator nudge: screen only, never printed on the customer copy. */}
                  <p className="pt-2 text-center text-xs font-bold text-amber-700 print:hidden">Please close the cash drawer.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center pt-8 space-y-3">
              <div className="inline-block px-4 py-2 bg-slate-50 rounded-full">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Thank you for your business!</p>
              </div>
              <p className="text-[10px] text-slate-300 font-medium">Generated by Tsa Bonno HospitalityOS</p>
            </div>

          </div>
        </div>

        {/* Next-sale CTAs — Till only passes these; other receipt callers keep Close alone. */}
        {(onNewSale || onRepeatSale) && (
          <div className="flex flex-col gap-2 border-t border-slate-100 p-4 print:hidden sm:flex-row sm:justify-end">
            {onRepeatSale && (
              <button
                type="button"
                onClick={onRepeatSale}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Same again
              </button>
            )}
            {onNewSale && (
              <button
                type="button"
                onClick={onNewSale}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                New sale
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
