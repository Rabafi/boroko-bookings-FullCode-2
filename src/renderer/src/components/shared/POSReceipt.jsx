import { useEffect, useRef, useState } from 'react'
import { Printer, X, Download, ShoppingBag } from 'lucide-react'
import { useSettings } from '../../app-context'

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

export function POSReceipt({ order, onClose, autoPrint = false }) {
  const { settings } = useSettings()
  const [saving, setSaving] = useState(false)
  const autoPrintDoneRef = useRef(false)

  const currency = settings?.currency || 'P'
  const logo = settings?.logo || ''
  const lodgeName = settings?.lodge_name || 'Lodge'
  const companyName = settings?.company_name || ''
  const address = [settings?.address, settings?.city, settings?.country].filter(Boolean).join(', ')
  const phone = settings?.phone || ''
  const email = settings?.email || ''
  const vatNumber = settings?.vat_number || ''

  const orderItems = order.pos_order_items || order.items || []
  const orderDate = order.created_at || new Date().toISOString()
  const payments = Array.isArray(order.payment_breakdown)
    ? order.payment_breakdown
    : typeof order.payment_breakdown === 'string'
      ? (() => { try { return JSON.parse(order.payment_breakdown) } catch { return [] } })()
      : []
  
  const receiptNo = order.receipt_number
    || (order.id ? `POS-${String(order.id).slice(0, 8).toUpperCase()}` : 'DRAFT')
  const guestLabel = order.walk_in_name || (order.room_id ? `Room Guest` : 'Walk-in')

  const handlePrint = async () => {
    const hardware = await window.api?.pos?.getHardwareSettings?.().catch(() => null)
    const printerName = hardware?.receipt_printer_name || ''
    const result = await window.api?.receipts?.printCurrent?.({
      mode: hardware?.receipt_print_mode || 'windows',
      order,
      business: settings || {},
      deviceName: printerName,
      silent: Boolean(printerName),
      openDrawer: order?._open_drawer_on_print === true
    }).catch(() => null)
    if (!result?.success) window.alert?.(result?.error || 'Print could not be started.')
  }

  const handleSavePDF = async () => {
    setSaving(true)
    try {
      await window.api.receipts.savePDF({
        guestName: guestLabel,
        invoiceNumber: receiptNo
      })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!autoPrint || autoPrintDoneRef.current) return undefined
    autoPrintDoneRef.current = true
    const timer = window.setTimeout(() => {
      handlePrint().catch(() => {})
    }, 450)
    return () => window.clearTimeout(timer)
  }, [autoPrint])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 print:p-0 print:static print:bg-transparent print:backdrop-blur-none">
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
            {order?._pending_sync === true && (
              <div className="border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-amber-800">
                Provisional receipt — pending server confirmation
              </div>
            )}
            
            {/* Lodge Identity */}
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
                <p className="font-bold text-slate-800 uppercase tracking-tight">{order.payment_method || 'Cash'}</p>
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
                {orderItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-3 pr-4">
                      <p className="font-bold text-slate-800">{item.item_name}</p>
                      <p className="text-xs text-slate-400 font-medium">{currency} {Number(item.unit_price || 0).toFixed(2)} ea</p>
                      {(item.modifiers?.length > 0 || item.item_notes) && (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 text-center font-bold text-slate-800">
                      {item.quantity}
                    </td>
                    <td className="py-3 text-right font-black text-slate-900">
                      {currency} {(Number(item.quantity || 0) * Number(item.unit_price || 0)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="space-y-3 pt-4 border-t-2 border-slate-900 border-dotted">
              {Number(order.gross_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Gross</span>
                  <span>{currency} {Number(order.gross_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(order.discount_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-emerald-700">
                  <span>Discount</span>
                  <span>-{currency} {Number(order.discount_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(order.tax_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Tax/VAT</span>
                  <span>{currency} {Number(order.tax_total || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(order.tip_total || 0) > 0 && (
                <div className="flex justify-between text-sm font-semibold text-slate-500">
                  <span>Tip</span>
                  <span>{currency} {Number(order.tip_total || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-widest text-xs">Total Amount</span>
                <span className="text-2xl font-black text-slate-950">{currency} {Number(order.total || 0).toFixed(2)}</span>
              </div>
              {payments.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Payments</p>
                  {payments.map((payment, idx) => (
                    <div key={idx} className="flex justify-between text-xs font-semibold text-slate-600">
                      <span>
                        {payment.method}
                        {payment.reference && <span className="ml-2 text-[10px] font-medium text-slate-400">Ref {payment.reference}</span>}
                      </span>
                      <span>{currency} {Number(payment.amount || 0).toFixed(2)}</span>
                    </div>
                  ))}
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
      </div>

    </div>
  )
}
