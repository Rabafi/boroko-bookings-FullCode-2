import { useCallback, useEffect, useState } from 'react'
import { FileText, DollarSign, Ban, CheckCircle, AlertTriangle, RefreshCw, CreditCard } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500'
}

export default function CorporateBilling({ accountId, accountName, onClose }) {
  const [outstanding, setOutstanding] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCharge, setShowCharge] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [chargeForm, setChargeForm] = useState({ bookingId: '', amount: '', description: '' })
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'bank_transfer', reference: '' })
  const [saving, setSaving] = useState(false)
  const [creditCheck, setCreditCheck] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [outData, invData] = await Promise.all([
        window.api.corporateBilling.getOutstanding(accountId),
        window.api.corporateBilling.getAll ? window.api.corporateBilling.getAll() : []
      ])
      setOutstanding(outData)
      setInvoices(Array.isArray(invData) ? invData : [])
    } catch (err) {
      setError(err?.message || 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])

  const handleOpenCharge = async () => {
    try {
      const check = await window.api.corporateBilling.checkCreditLimit(accountId, 0)
      setCreditCheck(check)
    } catch (_) {}
    setChargeForm({ bookingId: '', amount: '', description: '' })
    setError('')
    setShowCharge(true)
  }

  const handleCharge = async (e) => {
    e.preventDefault()
    const bookingId = String(chargeForm.bookingId || '').trim()
    if (!bookingId) { setError('Booking ID is required to charge a guest folio/balance to corporate'); return }
    const amountRaw = String(chargeForm.amount ?? '').trim()
    // 0 / blank => server settles remaining booking balance
    const amount = amountRaw === '' ? 0 : Number(amountRaw)
    if (!Number.isFinite(amount) || amount < 0) { setError('Amount must be zero (full balance) or a positive number'); return }
    setSaving(true)
    setError('')
    try {
      if (amount > 0) {
        const check = await window.api.corporateBilling.checkCreditLimit(accountId, amount)
        if (check && check.within_limit === false) {
          setError(`Credit limit exceeded. Available: ${formatCurrency(check.available_credit || 0)}`)
          setSaving(false)
          return
        }
      }
      const intentId = crypto.randomUUID()
      await window.api.corporateBilling.charge(accountId, bookingId, amount, chargeForm.description, intentId)
      setSuccess(amount > 0 ? 'Corporate charge recorded and booking settled' : 'Corporate charge recorded for remaining booking balance')
      setShowCharge(false)
      load()
    } catch (err) {
      setError(err?.message || 'Charge failed')
    } finally {
      setSaving(false)
    }
  }

  const handlePayment = async (e) => {
    e.preventDefault()
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) { setError('Amount must be positive'); return }
    setSaving(true)
    setError('')
    try {
      const selected = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').map(i => i.id)
      if (selected.length === 0) { setError('No unpaid invoices'); setSaving(false); return }
      const intentId = crypto.randomUUID()
      await window.api.corporateBilling.recordPayment(accountId, selected, Number(paymentForm.amount), paymentForm.method, paymentForm.reference, intentId)
      setSuccess('Payment recorded')
      setShowPayment(false)
      load()
    } catch (err) {
      setError(err?.message || 'Payment failed')
    } finally {
      setSaving(false)
    }
  }

  const handleSuspend = () => {
    setConfirmDialog({
      title: 'Suspend Corporate Account',
      message: `Suspend ${accountName}? No new charges will be allowed.`,
      onConfirm: async () => {
        try {
          await window.api.corporateBilling.suspend(accountId, 'Suspended via billing')
          setSuccess('Account suspended')
          load()
        } catch (err) { setError(err?.message) }
        setConfirmDialog(null)
      }
    })
  }

  const handleReactivate = () => {
    setConfirmDialog({
      title: 'Reactivate Corporate Account',
      message: `Reactivate ${accountName}?`,
      onConfirm: async () => {
        try {
          await window.api.corporateBilling.reactivate(accountId)
          setSuccess('Account reactivated')
          load()
        } catch (err) { setError(err?.message) }
        setConfirmDialog(null)
      }
    })
  }

  if (loading) return <div className="flex items-center justify-center p-8"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>

  return (
    <div className="p-4">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{success}</div>}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><FileText className="w-5 h-5" /> {accountName} - Billing</h2>
        <div className="flex gap-2">
          <button onClick={handleOpenCharge} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"><DollarSign className="w-4 h-4 inline mr-1" />Charge</button>
          <button onClick={() => { setPaymentForm({ amount: '', method: 'bank_transfer', reference: '' }); setError(''); setShowPayment(true) }} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700"><CreditCard className="w-4 h-4 inline mr-1" />Payment</button>
          <button onClick={handleSuspend} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"><Ban className="w-4 h-4 inline mr-1" />Suspend</button>
          <button onClick={handleReactivate} className="px-3 py-1.5 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700"><CheckCircle className="w-4 h-4 inline mr-1" />Reactivate</button>
        </div>
      </div>

      {outstanding && (
        <div className="grid grid-cols-5 gap-3 mb-4">
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Current</div><div className="text-lg font-semibold">{formatCurrency(outstanding.current)}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">1-30 Days</div><div className="text-lg font-semibold">{formatCurrency(outstanding.days_1_30)}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">31-60 Days</div><div className="text-lg font-semibold">{formatCurrency(outstanding.days_31_60)}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">61-90 Days</div><div className="text-lg font-semibold">{formatCurrency(outstanding.days_61_90)}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">{'>'}90 Days</div><div className="text-lg font-semibold text-red-600">{formatCurrency(outstanding.over_90)}</div></div>
        </div>
      )}

      <div className="bg-white border rounded">
        <div className="p-3 border-b font-semibold text-sm">Invoices</div>
        {invoices.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No invoices</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">{['Invoice #', 'Description', 'Amount', 'Due Date', 'Status'].map(h => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-mono text-xs">{inv.invoice_number}</td>
                  <td className="p-2">{inv.description}</td>
                  <td className="p-2">{formatCurrency(inv.amount)}</td>
                  <td className="p-2">{inv.due_date}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[inv.status] || ''}`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {outstanding && Number(outstanding.credit_limit) > 0 && Number(outstanding.total_outstanding) > Number(outstanding.credit_limit) * 0.9 && (
        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Credit limit warning: {formatCurrency(outstanding.total_outstanding)} / {formatCurrency(outstanding.credit_limit)}
        </div>
      )}

      {showCharge && (
        <Modal title="Charge to Corporate Account" onClose={() => setShowCharge(false)}>
          <form onSubmit={handleCharge} className="space-y-3 p-4">
            <div>
              <label className="block text-sm font-medium mb-1">Booking ID *</label>
              <input type="text" value={chargeForm.bookingId} onChange={e => setChargeForm(f => ({ ...f, bookingId: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm font-mono" required placeholder="uuid of the guest booking" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount (blank/0 = remaining balance)</label>
              <input type="number" step="0.01" min="0" value={chargeForm.amount} onChange={e => setChargeForm(f => ({ ...f, amount: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" placeholder="0" />
              <p className="mt-1 text-xs text-gray-500">Creates a corporate invoice and settles the guest bill via method corporate (and open hotel folio if present).</p>
            </div>
            <div><label className="block text-sm font-medium mb-1">Description</label><input type="text" value={chargeForm.description} onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" /></div>
            {creditCheck && !creditCheck.within_limit && <div className="text-red-600 text-sm">Credit limit of {formatCurrency(creditCheck.credit_limit)} would be exceeded</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCharge(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Processing...' : 'Charge'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showPayment && (
        <Modal title="Record Payment" onClose={() => setShowPayment(false)}>
          <form onSubmit={handlePayment} className="space-y-3 p-4">
            <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" min="0" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" required /></div>
            <div><label className="block text-sm font-medium mb-1">Method</label><select value={paymentForm.method} onChange={e => setPaymentForm(f => ({ ...f, method: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">{['bank_transfer','cheque','cash','credit_card','other'].map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Reference</label><input type="text" value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowPayment(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">{saving ? 'Processing...' : 'Record Payment'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
