import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, ReceiptText, RefreshCw, Wallet, Split, ArrowRightLeft, Lock, Unlock, XCircle, DollarSign } from 'lucide-react'
import { Modal } from './shared/Modal'
import { StatusBadge } from './shared/StatusBadge'
import { useSettings } from '../app-context'

const emptyCharge = {
  description: '',
  category: 'folio',
  quantity: '1',
  unit_price: ''
}

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function capitalize(str) {
  return String(str || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function Folios() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [activeTab, setActiveTab] = useState('overview')
  const [folios, setFolios] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [chargeForm, setChargeForm] = useState(emptyCharge)
  const [chargeError, setChargeError] = useState('')
  const [posting, setPosting] = useState(false)

  // Ledger state
  const [ledgerFolios, setLedgerFolios] = useState([])
  const [selectedLedgerFolioId, setSelectedLedgerFolioId] = useState(null)
  const [ledgerLineItems, setLedgerLineItems] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [lineItemsLoading, setLineItemsLoading] = useState(false)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showLedgerChargeModal, setShowLedgerChargeModal] = useState(false)
  const [showLedgerPaymentModal, setShowLedgerPaymentModal] = useState(false)
  const [splitForm, setSplitForm] = useState({ amount: '', label: '', folioType: 'guest' })
  const [transferForm, setTransferForm] = useState({ targetFolioId: '', amount: '', description: '' })
  const [ledgerChargeForm, setLedgerChargeForm] = useState({ amount: '', description: '' })
  const [ledgerPaymentForm, setLedgerPaymentForm] = useState({ amount: '', description: '' })

  const selectedFolio = useMemo(
    () => folios.find((folio) => folio.booking_id === selectedId) || folios[0] || null,
    [folios, selectedId]
  )

  const selectedLedgerFolio = useMemo(
    () => ledgerFolios.find((f) => f.id === selectedLedgerFolioId) || ledgerFolios[0] || null,
    [ledgerFolios, selectedLedgerFolioId]
  )

  const loadFolios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.folios.getAll()
      const next = Array.isArray(data) ? data : []
      setFolios(next)
      setSelectedId((current) => current || next[0]?.booking_id || null)
    } catch (err) {
      console.error('Failed to load folios:', err)
      setError(err?.message || 'Failed to load folios')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEntries = useCallback(async (bookingId) => {
    if (!bookingId) {
      setEntries([])
      return
    }
    setEntriesLoading(true)
    try {
      const data = await window.api.folios.getEntries(bookingId)
      setEntries(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load folio entries:', err)
      setError(err?.message || 'Failed to load folio entries')
    } finally {
      setEntriesLoading(false)
    }
  }, [])

  const loadLedgerFolios = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const data = await window.api.folioLedger.getFolios()
      const next = Array.isArray(data) ? data : []
      setLedgerFolios(next)
      setSelectedLedgerFolioId((current) => current || next[0]?.id || null)
    } catch (err) {
      console.error('Failed to load ledger folios:', err)
    } finally {
      setLedgerLoading(false)
    }
  }, [])

  const loadLedgerLineItems = useCallback(async (folioId) => {
    if (!folioId) {
      setLedgerLineItems([])
      return
    }
    setLineItemsLoading(true)
    try {
      const data = await window.api.folioLedger.getLineItems(folioId)
      setLedgerLineItems(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load ledger line items:', err)
    } finally {
      setLineItemsLoading(false)
    }
  }, [])

  useEffect(() => { loadFolios() }, [loadFolios])
  useEffect(() => { loadEntries(selectedFolio?.booking_id) }, [loadEntries, selectedFolio?.booking_id])
  useEffect(() => { loadLedgerFolios() }, [loadLedgerFolios])
  useEffect(() => { loadLedgerLineItems(selectedLedgerFolio?.id) }, [loadLedgerLineItems, selectedLedgerFolio?.id])

  useEffect(() => {
    if (!success) return undefined
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const openChargeModal = () => {
    setChargeForm(emptyCharge)
    setChargeError('')
    setShowChargeModal(true)
  }

  const postCharge = async (event) => {
    event.preventDefault()
    if (!selectedFolio?.booking_id) return
    if (!chargeForm.description.trim()) {
      setChargeError('Description is required')
      return
    }
    if (Number(chargeForm.unit_price) <= 0) {
      setChargeError('Unit price must be greater than zero')
      return
    }

    setPosting(true)
    setChargeError('')
    try {
      const result = await window.api.folios.postCharge(selectedFolio.booking_id, {
        ...chargeForm,
        description: chargeForm.description.trim(),
        quantity: Number(chargeForm.quantity) || 1,
        unit_price: Number(chargeForm.unit_price) || 0
      })
      if (result?.success === false) {
        setChargeError(result.error || 'Failed to post charge')
      } else {
        setShowChargeModal(false)
        await loadFolios()
        await loadEntries(selectedFolio.booking_id)
        setSuccess(result?.offline ? 'Charge queued for sync.' : 'Charge posted to folio.')
      }
    } catch (err) {
      setChargeError(err?.message || 'Failed to post charge')
    } finally {
      setPosting(false)
    }
  }

  const handleLedgerSplit = async (event) => {
    event.preventDefault()
    if (!selectedLedgerFolio) return
    try {
      const intentId = crypto.randomUUID()
      const result = await window.api.folioLedger.splitFolio(
        selectedLedgerFolio.id,
        splitForm.folioType,
        splitForm.label,
        Number(splitForm.amount),
        splitForm.label,
        intentId
      )
      if (result?.success === false) {
        setError(result.error || 'Split failed')
      } else {
        setShowSplitModal(false)
        setSplitForm({ amount: '', label: '', folioType: 'guest' })
        await loadLedgerFolios()
        setSuccess('Folio split successfully')
      }
    } catch (err) {
      setError(err?.message || 'Failed to split folio')
    }
  }

  const handleLedgerTransfer = async (event) => {
    event.preventDefault()
    if (!selectedLedgerFolio || !transferForm.targetFolioId) return
    try {
      const intentId = crypto.randomUUID()
      const result = await window.api.folioLedger.transferCharge(
        selectedLedgerFolio.id,
        transferForm.targetFolioId,
        Number(transferForm.amount),
        transferForm.description,
        intentId
      )
      if (result?.success === false) {
        setError(result.error || 'Transfer failed')
      } else {
        setShowTransferModal(false)
        setTransferForm({ targetFolioId: '', amount: '', description: '' })
        await loadLedgerFolios()
        await loadLedgerLineItems(selectedLedgerFolio?.id)
        setSuccess('Charge transferred successfully')
      }
    } catch (err) {
      setError(err?.message || 'Failed to transfer charge')
    }
  }

  const handleLedgerCharge = async (event) => {
    event.preventDefault()
    if (!selectedLedgerFolio) return
    if (!ledgerChargeForm.description.trim() || Number(ledgerChargeForm.amount) <= 0) {
      setError('Description and positive amount required')
      return
    }
    try {
      const intentId = crypto.randomUUID()
      const result = await window.api.folioLedger.addCharge(
        selectedLedgerFolio.id,
        Number(ledgerChargeForm.amount),
        ledgerChargeForm.description.trim(),
        null,
        null,
        intentId
      )
      if (result?.success === false) {
        setError(result.error || 'Add charge failed')
      } else {
        setShowLedgerChargeModal(false)
        setLedgerChargeForm({ amount: '', description: '' })
        await loadLedgerFolios()
        await loadLedgerLineItems(selectedLedgerFolio?.id)
        setSuccess('Charge added to ledger folio')
      }
    } catch (err) {
      setError(err?.message || 'Failed to add charge')
    }
  }

  const handleLedgerPayment = async (event) => {
    event.preventDefault()
    if (!selectedLedgerFolio) return
    if (Number(ledgerPaymentForm.amount) <= 0) {
      setError('Payment amount must be greater than zero')
      return
    }
    try {
      const intentId = crypto.randomUUID()
      const result = await window.api.folioLedger.addPayment(
        selectedLedgerFolio.id,
        Number(ledgerPaymentForm.amount),
        ledgerPaymentForm.description.trim() || 'Payment',
        intentId
      )
      if (result?.success === false) {
        setError(result.error || 'Add payment failed')
      } else {
        setShowLedgerPaymentModal(false)
        setLedgerPaymentForm({ amount: '', description: '' })
        await loadLedgerFolios()
        await loadLedgerLineItems(selectedLedgerFolio?.id)
        setSuccess('Payment posted to ledger folio')
      }
    } catch (err) {
      setError(err?.message || 'Failed to add payment')
    }
  }

  const handleLedgerAction = async (action, folioId) => {
    try {
      const intentId = crypto.randomUUID()
      const actions = {
        close: () => window.api.folioLedger.closeFolio(folioId, intentId),
        reopen: () => window.api.folioLedger.reopenFolio(folioId, intentId),
        lock: () => window.api.folioLedger.lockFolio(folioId, intentId)
      }
      const result = await actions[action]()
      if (result?.success === false) {
        setError(result.error || `${action} failed`)
      } else {
        await loadLedgerFolios()
        setSuccess(`Folio ${action}ed successfully`)
      }
    } catch (err) {
      setError(err?.message || `Failed to ${action} folio`)
    }
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">HOTEL BILLING</p>
          <h1 className="bb-page-header-title">Folios</h1>
          <p className="bb-page-header-subtitle">Booking-backed folios using the existing audited booking charge ledger.</p>
        </div>
        <button onClick={() => { loadFolios(); loadLedgerFolios() }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'overview' ? 'border-b-2 border-[#174c3a] text-[#174c3a]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'ledger' ? 'border-b-2 border-[#174c3a] text-[#174c3a]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Ledger
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
            </div>
          ) : folios.length === 0 ? (
            <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
              <Wallet size={40} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No active folios</p>
              <p className="mt-1 text-xs text-slate-400">Active bookings will appear here as hotel folios.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
              <section className="bb-card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800">Open Folios</h2>
                </div>
                <div className="max-h-[640px] divide-y divide-slate-50 overflow-y-auto">
                  {folios.map((folio) => (
                    <button
                      key={folio.booking_id}
                      onClick={() => setSelectedId(folio.booking_id)}
                      className={`block w-full px-5 py-4 text-left transition-colors hover:bg-slate-50 ${selectedFolio?.booking_id === folio.booking_id ? 'bg-emerald-50/70' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800">{folio.guest_name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">Room {folio.room_number || '—'} · {folio.check_in} to {folio.check_out}</p>
                        </div>
                        <StatusBadge status={folio.payment_status || 'pending'} size="sm" />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{folio.entries_count} charge{folio.entries_count !== 1 ? 's' : ''}</span>
                        <span className={`font-bold ${folio.balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(folio.balance, currency)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="bb-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">{selectedFolio?.guest_name || 'Folio'}</h2>
                    <p className="text-xs text-slate-500">Room {selectedFolio?.room_number || '—'} · Balance {formatCurrency(selectedFolio?.balance, currency)}</p>
                  </div>
                  <button onClick={openChargeModal} className="inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e5c47]">
                    <Plus size={16} /> Post Charge
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Room Total</p>
                    <p className="text-sm font-bold text-slate-800">{formatCurrency(selectedFolio?.room_total, currency)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Charges</p>
                    <p className="text-sm font-bold text-slate-800">{formatCurrency(selectedFolio?.charges_total, currency)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Paid</p>
                    <p className="text-sm font-bold text-slate-800">{formatCurrency(selectedFolio?.amount_paid, currency)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Balance</p>
                    <p className="text-sm font-bold text-amber-600">{formatCurrency(selectedFolio?.balance, currency)}</p>
                  </div>
                </div>

                <div className="rounded-none border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-800">
                  Folio charges use the existing audited booking charge RPC. Payments, refunds, and final settlement remain in the established booking payment flows.
                </div>

                {entriesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
                  </div>
                ) : entries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ReceiptText size={36} className="mb-3 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No extra charges yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-3 text-left">Description</th>
                          <th className="px-4 py-3 text-left">Category</th>
                          <th className="px-4 py-3 text-right">Qty</th>
                          <th className="px-4 py-3 text-right">Unit</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="px-4 py-3 font-medium text-slate-700">{entry.description}{entry.pending_sync ? ' (pending)' : ''}</td>
                            <td className="px-4 py-3 text-slate-500">{entry.category}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{entry.quantity}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(entry.unit_price, currency)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(entry.amount, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {showChargeModal && (
            <Modal title="Post Folio Charge" onClose={() => setShowChargeModal(false)}>
              <form onSubmit={postCharge} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Description</label>
                  <input className="input" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} placeholder="e.g. Minibar, laundry, room service" required />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Category</label>
                    <select className="input" value={chargeForm.category} onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}>
                      <option value="folio">Folio</option>
                      <option value="room_service">Room service</option>
                      <option value="minibar">Minibar</option>
                      <option value="laundry">Laundry</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Qty</label>
                    <input className="input" type="number" min="0.01" step="0.01" value={chargeForm.quantity} onChange={(e) => setChargeForm({ ...chargeForm, quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Unit Price</label>
                    <input className="input" type="number" min="0.01" step="0.01" value={chargeForm.unit_price} onChange={(e) => setChargeForm({ ...chargeForm, unit_price: e.target.value })} required />
                  </div>
                </div>

                {chargeError && (
                  <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    <AlertTriangle size={14} className="shrink-0" />
                    {chargeError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowChargeModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={posting} className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47] disabled:opacity-50">
                    {posting ? 'Posting...' : 'Post Charge'}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}

      {activeTab === 'ledger' && (
        <>
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
            </div>
          ) : ledgerFolios.length === 0 ? (
            <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
              <Wallet size={40} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No ledger folios</p>
              <p className="mt-1 text-xs text-slate-400">Create a folio to start tracking charges independently.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
              <section className="bb-card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800">Folios</h2>
                </div>
                <div className="max-h-[640px] divide-y divide-slate-50 overflow-y-auto">
                  {ledgerFolios.map((folio) => (
                    <button
                      key={folio.id}
                      onClick={() => setSelectedLedgerFolioId(folio.id)}
                      className={`block w-full px-5 py-4 text-left transition-colors hover:bg-slate-50 ${selectedLedgerFolio?.id === folio.id ? 'bg-emerald-50/70' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800">{folio.folio_number}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{folio.label || capitalize(folio.folio_type)}</p>
                        </div>
                        <StatusBadge status={folio.status} size="sm" />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{capitalize(folio.folio_type)}</span>
                        <span className={`font-bold ${Number(folio.balance) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(folio.balance, currency)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="bb-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">{selectedLedgerFolio?.folio_number || 'Ledger Folio'}</h2>
                    <p className="text-xs text-slate-500">{selectedLedgerFolio?.label || capitalize(selectedLedgerFolio?.folio_type || '')} · Balance {formatCurrency(selectedLedgerFolio?.balance, currency)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowLedgerChargeModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e5c47]">
                      <Plus size={16} /> Add Charge
                    </button>
                    <button onClick={() => setShowLedgerPaymentModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                      <DollarSign size={16} /> Add Payment
                    </button>
                    <button onClick={() => setShowSplitModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                      <Split size={16} /> Split
                    </button>
                    <button onClick={() => setShowTransferModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                      <ArrowRightLeft size={16} /> Transfer
                    </button>
                    {selectedLedgerFolio?.status === 'open' && (
                      <button onClick={() => handleLedgerAction('close', selectedLedgerFolio.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        <Unlock size={16} /> Close
                      </button>
                    )}
                    {selectedLedgerFolio?.status === 'closed' && (
                      <button onClick={() => handleLedgerAction('reopen', selectedLedgerFolio.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        <Unlock size={16} /> Reopen
                      </button>
                    )}
                    {selectedLedgerFolio?.status !== 'locked' && (
                      <button onClick={() => handleLedgerAction('lock', selectedLedgerFolio.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
                        <Lock size={16} /> Lock
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Folio #</p>
                    <p className="text-sm font-bold text-slate-800">{selectedLedgerFolio?.folio_number || '—'}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Type</p>
                    <p className="text-sm font-bold text-slate-800">{capitalize(selectedLedgerFolio?.folio_type || '—')}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Status</p>
                    <p className="text-sm font-bold text-slate-800">{capitalize(selectedLedgerFolio?.status || '—')}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Balance</p>
                    <p className={`text-sm font-bold ${Number(selectedLedgerFolio?.balance) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(selectedLedgerFolio?.balance, currency)}</p>
                  </div>
                </div>

                {lineItemsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
                  </div>
                ) : ledgerLineItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ReceiptText size={36} className="mb-3 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No line items yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-left">Description</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledgerLineItems.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-xs text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                                item.line_type === 'charge' ? 'bg-amber-50 text-amber-700' :
                                item.line_type === 'payment' ? 'bg-emerald-50 text-emerald-700' :
                                item.line_type === 'transfer_in' ? 'bg-blue-50 text-blue-700' :
                                item.line_type === 'transfer_out' ? 'bg-purple-50 text-purple-700' :
                                item.line_type === 'void' ? 'bg-red-50 text-red-700' :
                                'bg-slate-50 text-slate-700'
                              }`}>{capitalize(item.line_type)}</span>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-700">{item.description}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${
                              ['charge', 'transfer_in'].includes(item.line_type) ? 'text-amber-600' :
                              ['payment', 'transfer_out'].includes(item.line_type) ? 'text-emerald-600' :
                              'text-red-600'
                            }`}>
                              {['charge', 'transfer_in'].includes(item.line_type) ? '+' : ''}{formatCurrency(item.amount, currency)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {item.line_type !== 'void' && (
                                <button
                                  onClick={() => {
                                    if (!window.confirm('Void this line item?')) return
                                    const intentId = crypto.randomUUID()
                                    window.api.folioLedger.voidLineItem(item.id, 'User requested void', intentId)
                                      .then(() => {
                                        setSuccess('Line item voided')
                                        loadLedgerFolios()
                                        loadLedgerLineItems(selectedLedgerFolio?.id)
                                      })
                                      .catch((err) => setError(err?.message || 'Failed to void line item'))
                                  }}
                                  className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                                >
                                  <XCircle size={14} /> Void
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {showSplitModal && (
            <Modal title="Split Folio" onClose={() => setShowSplitModal(false)}>
              <form onSubmit={handleLedgerSplit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</label>
                  <input className="input" type="number" min="0.01" step="0.01" value={splitForm.amount} onChange={(e) => setSplitForm({ ...splitForm, amount: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">New Folio Label</label>
                  <input className="input" value={splitForm.label} onChange={(e) => setSplitForm({ ...splitForm, label: e.target.value })} placeholder="e.g. Incidentals" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Folio Type</label>
                  <select className="input" value={splitForm.folioType} onChange={(e) => setSplitForm({ ...splitForm, folioType: e.target.value })}>
                    <option value="guest">Guest</option>
                    <option value="master">Master</option>
                    <option value="company">Company</option>
                    <option value="department">Department</option>
                    <option value="incidental">Incidental</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowSplitModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47]">Split Folio</button>
                </div>
              </form>
            </Modal>
          )}

          {showTransferModal && (
            <Modal title="Transfer Charge" onClose={() => setShowTransferModal(false)}>
              <form onSubmit={handleLedgerTransfer} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Target Folio ID</label>
                  <select className="input" value={transferForm.targetFolioId} onChange={(e) => setTransferForm({ ...transferForm, targetFolioId: e.target.value })} required>
                    <option value="">Select folio</option>
                    {ledgerFolios.filter((f) => f.id !== selectedLedgerFolio?.id).map((f) => (
                      <option key={f.id} value={f.id}>{f.folio_number} - {f.label || capitalize(f.folio_type)} ({formatCurrency(f.balance, currency)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</label>
                  <input className="input" type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Description</label>
                  <input className="input" value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} placeholder="Reason for transfer" required />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowTransferModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47]">Transfer</button>
                </div>
              </form>
            </Modal>
          )}

          {showLedgerChargeModal && (
            <Modal title="Add Ledger Charge" onClose={() => setShowLedgerChargeModal(false)}>
              <form onSubmit={handleLedgerCharge} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Description</label>
                  <input className="input" value={ledgerChargeForm.description} onChange={(e) => setLedgerChargeForm({ ...ledgerChargeForm, description: e.target.value })} placeholder="Charge description" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</label>
                  <input className="input" type="number" min="0.01" step="0.01" value={ledgerChargeForm.amount} onChange={(e) => setLedgerChargeForm({ ...ledgerChargeForm, amount: e.target.value })} required />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowLedgerChargeModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47]">Add Charge</button>
                </div>
              </form>
            </Modal>
          )}

          {showLedgerPaymentModal && (
            <Modal title="Add Ledger Payment" onClose={() => setShowLedgerPaymentModal(false)}>
              <form onSubmit={handleLedgerPayment} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Description</label>
                  <input className="input" value={ledgerPaymentForm.description} onChange={(e) => setLedgerPaymentForm({ ...ledgerPaymentForm, description: e.target.value })} placeholder="Payment reference (optional)" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</label>
                  <input className="input" type="number" min="0.01" step="0.01" value={ledgerPaymentForm.amount} onChange={(e) => setLedgerPaymentForm({ ...ledgerPaymentForm, amount: e.target.value })} required />
                </div>
                <p className="text-xs text-slate-500">Ledger payments post through the add_folio_payment RPC. Booking payment_status is never set from this screen.</p>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowLedgerPaymentModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47]">Add Payment</button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
    </div>
  )
}
