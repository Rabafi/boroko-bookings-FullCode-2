import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, MessageSquareHeart, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function futureDateKey(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

const newSettlement = () => ({ channel: 'card', provider: '', settled_amount: '', fee_amount: '', bank_account_id: '', reference: '', notes: '', idempotency_key: crypto.randomUUID() })
const newDeposit = () => ({ reservation_id: '', amount: '', method: 'card', reference: '', idempotency_key: crypto.randomUUID() })
const EMPTY_FEEDBACK = { rating: '5', channel: 'in_store', message: '' }

export default function RestaurantCommercialControl({ section = 'all' }) {
  const access = useAccess()
  const canManagePos = canAccessCapability(access, 'pos.manage')
  const canViewReports = canAccessCapability(access, 'reports.view')
  const showSettlements = section === 'all' || section === 'settlements'
  const showDeposits = section === 'all' || section === 'deposits'
  const showFeedback = section === 'all' || section === 'feedback'
  const [date, setDate] = useState(localDateKey())
  const [settlements, setSettlements] = useState([])
  const [settlementsAvailable, setSettlementsAvailable] = useState(false)
  const [settlementBankAccounts, setSettlementBankAccounts] = useState([])
  const [reservations, setReservations] = useState([])
  const [depositRows, setDepositRows] = useState([])
  const [depositsAvailable, setDepositsAvailable] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busyForm, setBusyForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settlement, setSettlement] = useState(newSettlement)
  const [settlementStart, setSettlementStart] = useState(localDateKey())
  const [settlementEnd, setSettlementEnd] = useState(localDateKey())
  const [expectedSettlement, setExpectedSettlement] = useState(null)
  const [expectedLoading, setExpectedLoading] = useState(false)
  const [deposit, setDeposit] = useState(newDeposit)
  const [feedback, setFeedback] = useState(EMPTY_FEEDBACK)
  const [feedbackRows, setFeedbackRows] = useState([])

  async function load() {
    try {
      setLoading(true)
      setError('')
      const [settlementRows, settlementBanks, reservationRows, feedbackResult, depositsResult] = await Promise.all([
        showSettlements ? window.api.pos.getSettlements(date) : Promise.resolve([]),
        showSettlements ? window.api.pos.getSettlementBankAccounts() : Promise.resolve([]),
        showDeposits ? window.api.pos.getRestaurantReservations(localDateKey(), futureDateKey(90)) : Promise.resolve([]),
        showFeedback ? window.api.pos.getFeedback(30) : Promise.resolve([]),
        showDeposits ? window.api.pos.getReservationDeposits(90) : Promise.resolve([])
      ])
      const settlementsReady = Array.isArray(settlementRows) && settlementRows._source === 'server' && settlementRows._complete === true
      const depositsReady = Array.isArray(depositsResult) && depositsResult._source === 'server' && depositsResult._complete === true
      setSettlementsAvailable(settlementsReady)
      setDepositsAvailable(depositsReady)
      setSettlements(Array.isArray(settlementRows) ? settlementRows : [])
      setSettlementBankAccounts(Array.isArray(settlementBanks) ? settlementBanks : [])
      setReservations(Array.isArray(reservationRows) ? reservationRows : [])
      setFeedbackRows(Array.isArray(feedbackResult) ? feedbackResult : [])
      setDepositRows(Array.isArray(depositsResult) ? depositsResult : [])
      if ((showSettlements && !settlementsReady) || (showDeposits && !depositsReady)) setError('Settlement or reservation-deposit evidence is unavailable. Refresh before relying on totals or recording a reconciliation.')
    } catch (err) {
      setError(err.message || 'Could not load commercial controls.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [date])

  useEffect(() => {
    let active = true
    if (!showSettlements || !settlementStart || !settlementEnd || settlementEnd < settlementStart) { setExpectedSettlement(null); return undefined }
    setExpectedLoading(true)
    window.api.pos.getSettlementExpectedTotal(settlementStart, settlementEnd, settlement.channel)
      .then((result) => { if (active) setExpectedSettlement(result?.success === false ? null : Number(result?.expected_amount || 0)) })
      .catch(() => { if (active) setExpectedSettlement(null) })
      .finally(() => { if (active) setExpectedLoading(false) })
    return () => { active = false }
  }, [settlement.channel, settlementEnd, settlementStart, showSettlements])

  async function run(formName, action, successMessage, reset) {
    setBusyForm(formName)
    setNotice('')
    setError('')
    try {
      const result = await action()
      if (!result?.success) throw new Error(result?.error || 'Could not save this record.')
      reset()
      setNotice(typeof successMessage === 'function' ? successMessage(result) : successMessage)
      await load()
    } catch (err) {
      setError(err.message || 'Could not save this record.')
    } finally {
      setBusyForm(null)
    }
  }

  function saveSettlement(event) {
    event.preventDefault()
    return run(
      'settlement',
      () => window.api.pos.recordSettlement({ ...settlement, period_start: settlementStart, period_end: settlementEnd }),
      'Settlement recorded. Any variance remains visible for manager follow-up.',
      () => setSettlement(newSettlement())
    )
  }

  function saveDeposit(event) {
    event.preventDefault()
    return run(
      'deposit',
      () => window.api.pos.recordReservationDeposit(deposit),
      (result) => result?.duplicate
        ? 'This deposit was already held. No second payment or POS sale was created.'
        : 'Reservation deposit held with an audit trail. It was not recorded as a POS sale.',
      () => setDeposit(newDeposit())
    )
  }

  function saveFeedback(event) {
    event.preventDefault()
    return run(
      'feedback',
      () => window.api.pos.recordFeedback({ ...feedback, rating: Number(feedback.rating) }),
      'Feedback captured for manager follow-up.',
      () => setFeedback(EMPTY_FEEDBACK)
    )
  }

  const variance = useMemo(() => settlementsAvailable ? settlements.reduce((sum, row) => sum + Number(row.variance_amount || 0), 0) : null, [settlements, settlementsAvailable])
  const input = 'bb-input mt-1 w-full'

  const pageTitle = showSettlements && !showDeposits && !showFeedback
    ? 'Settlement Reconciliation'
    : showDeposits && !showSettlements && !showFeedback
      ? 'Customer Funds'
      : showFeedback && !showSettlements && !showDeposits
        ? 'Customer Feedback'
        : 'Commercial Control'
  const pageDescription = showSettlements && !showDeposits && !showFeedback
    ? 'Compare completed POS payments with the external amounts settled by each provider.'
    : showDeposits && !showSettlements && !showFeedback
      ? 'Hold reservation deposits with a traceable ledger. Gift cards are managed alongside this customer liability in Finance & close.'
      : showFeedback && !showSettlements && !showDeposits
        ? 'Capture guest feedback and keep manager follow-up visible without mixing it with financial controls.'
        : 'Reconcile external money, hold reservation deposits, and capture guest feedback without inventing a second sales ledger.'

  return (
    <div className="restaurant-native-page max-w-6xl">
      <div className="restaurant-native-hero">
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </div>
        <button onClick={load} disabled={loading} className="bb-btn-outline flex items-center gap-2 px-4 text-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-2">
        {showSettlements && <section className="bb-card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 className="font-bold text-slate-800">Settlement reconciliation</h2><p className="mt-1 text-xs text-slate-500">Compare the POS expectation with the amount deposited by a terminal, platform, bank or voucher provider.</p></div>
            <WalletCards className="text-emerald-700" />
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-600">Recorded date<input type="date" value={date} onChange={event => setDate(event.target.value)} className={input} /></label>
            <span className={`rounded-full px-3 py-2 text-xs font-semibold ${variance == null || variance !== 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{variance == null ? 'Variance unavailable' : variance === 0 ? 'No recorded variance' : `Variance P ${variance.toFixed(2)}`}</span>
          </div>

          {!canViewReports && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Your role does not include settlement reporting. Ask a manager, finance user, or administrator for access.</div>}
          <form onSubmit={saveSettlement} className="grid grid-cols-2 gap-3">
            <label className="text-xs">Channel<select value={settlement.channel} onChange={event => setSettlement({ ...settlement, channel: event.target.value })} className={input}>{['card', 'mobile_money', 'delivery_platform', 'bank', 'voucher'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="text-xs">Provider *<input required value={settlement.provider} onChange={event => setSettlement({ ...settlement, provider: event.target.value })} className={input} placeholder="Terminal, bank or platform" /></label>
            <label className="text-xs">From date *<input required type="date" value={settlementStart} onChange={event => setSettlementStart(event.target.value)} className={input} /></label>
            <label className="text-xs">To date *<input required min={settlementStart} type="date" value={settlementEnd} onChange={event => setSettlementEnd(event.target.value)} className={input} /></label>
            <div className="col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Expected POS total</strong><p className="mt-1">{expectedLoading ? 'Calculating from completed POS payments…' : expectedSettlement === null ? 'Choose a valid date range and channel.' : `P ${expectedSettlement.toFixed(2)} · calculated from POS ${settlement.channel.replaceAll('_', ' ')} payments`}</p></div>
            <label className="text-xs">Settled amount (P) *<input required min="0" step="0.01" type="number" value={settlement.settled_amount} onChange={event => setSettlement({ ...settlement, settled_amount: event.target.value })} className={input} /></label>
            <label className="text-xs">Provider fee (P)<input min="0" step="0.01" type="number" value={settlement.fee_amount} onChange={event => setSettlement({ ...settlement, fee_amount: event.target.value })} className={input} placeholder="0.00" /></label>
            <label className="col-span-2 text-xs">Deposit bank account {settlementBankAccounts.length > 0 && '*'}<select required={settlementBankAccounts.length > 0} value={settlement.bank_account_id} onChange={event => setSettlement({ ...settlement, bank_account_id: event.target.value })} className={input}><option value="">{settlementBankAccounts.length > 0 ? 'Choose the bank destination…' : 'No active bank destination configured'}</option>{settlementBankAccounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.bank_name ? ` · ${account.bank_name}` : ''}{account.account_number_masked ? ` · ${account.account_number_masked}` : ''}</option>)}</select></label>
            <label className="col-span-2 text-xs">Settlement reference *<input required value={settlement.reference} onChange={event => setSettlement({ ...settlement, reference: event.target.value })} className={input} placeholder="Provider batch or transfer reference" /></label>
            <label className="col-span-2 text-xs">Notes<textarea value={settlement.notes} onChange={event => setSettlement({ ...settlement, notes: event.target.value })} className={input} rows={2} placeholder="Evidence or variance explanation" /></label>
            <button disabled={!canManagePos || busyForm !== null || expectedLoading || expectedSettlement === null} className="bb-btn-primary col-span-2"><ShieldCheck size={15} className="mr-1 inline" />{busyForm === 'settlement' ? 'Recording…' : 'Record reconciliation'}</button>
          </form>
          {!canManagePos && <p className="mt-2 text-xs text-amber-700">Recording a reconciliation requires the manager-level POS authority enforced by the server.</p>}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recorded for {date}</h3>
            {!settlementsAvailable ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-800">Settlement evidence is unavailable until the server confirms a complete read.</div> : settlements.length === 0 ? <div className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">No settlements recorded for this date.</div> : settlements.slice(0, 8).map(row => (
              <div key={row.id} className="flex justify-between gap-3 border-t border-slate-100 py-2 text-xs first:border-0">
                <span className="capitalize">{row.channel?.replaceAll('_', ' ')} {row.provider && `· ${row.provider}`}</span>
                <span className={Number(row.variance_amount) === 0 ? 'text-emerald-700' : 'font-bold text-amber-700'}>P {Number(row.expected_amount).toFixed(2)} → P {Number(row.settled_amount).toFixed(2)} + fee P {Number(row.fee_amount || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>}

        {(showDeposits || showFeedback) && <div className="space-y-6">
          {showDeposits && <section className="bb-card p-5">
            <h2 className="font-bold text-slate-800">Reservation deposit</h2>
            <p className="mb-3 mt-1 text-xs text-slate-500">Deposits are online-only and auditable. Select the reservation instead of copying an internal ID.</p>
            <form onSubmit={saveDeposit} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs">Reservation *<select required value={deposit.reservation_id} onChange={event => setDeposit({ ...deposit, reservation_id: event.target.value })} className={input}><option value="">Choose upcoming reservation…</option>{reservations.map(row => <option key={row.id} value={row.id}>{row.reservation_date} {row.reservation_time?.slice(0, 5)} · {row.customer_name} · {row.party_size} guests</option>)}</select></label>
              <label className="text-xs">Amount (P) *<input required min="0.01" step="0.01" type="number" value={deposit.amount} onChange={event => setDeposit({ ...deposit, amount: event.target.value })} className={input} /></label>
              <label className="text-xs">Method<select value={deposit.method} onChange={event => setDeposit({ ...deposit, method: event.target.value })} className={input}>{['cash', 'card', 'mobile_money', 'bank_transfer', 'voucher'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
              <label className="col-span-2 text-xs">Reference *<input required value={deposit.reference} onChange={event => setDeposit({ ...deposit, reference: event.target.value })} className={input} placeholder="Receipt, terminal or transfer reference" /></label>
              <button disabled={!canManagePos || busyForm !== null || reservations.length === 0} className="bb-btn-primary col-span-2">{busyForm === 'deposit' ? 'Holding…' : 'Hold deposit'}</button>
            </form>
            {reservations.length === 0 && <p className="restaurant-native-financial-warning mt-3">No upcoming reservation is available to attach a deposit to.</p>}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Held deposit ledger · last 90 days</h3>
              {!depositsAvailable ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Reservation-deposit evidence is unavailable until the server confirms a complete read.</p> : depositRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">No reservation deposits are held.</p> : depositRows.slice(0, 10).map(row => <div key={row.id} className="border-t border-slate-100 py-3 text-xs first:border-0"><div className="flex items-center justify-between gap-3"><strong className="text-slate-700">{row.customer_name} · P {Number(row.amount || 0).toFixed(2)}</strong><span className="rounded-full bg-amber-50 px-2 py-1 font-semibold capitalize text-amber-800">{row.status}</span></div><p className="mt-1 text-slate-600">{row.reservation_date} {row.reservation_time?.slice(0, 5)} · {row.party_size} guests · {row.method?.replaceAll('_', ' ')}</p><small className="text-slate-400">Reference {row.reference} · received by {row.received_by_name} · {row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : ''}</small></div>)}
            </div>
          </section>}

          {showFeedback && <section className="bb-card p-5">
            <div className="mb-2 flex items-center gap-2"><MessageSquareHeart className="text-rose-600" size={18} /><h2 className="font-bold text-slate-800">Customer feedback</h2></div>
            <form onSubmit={saveFeedback} className="grid grid-cols-2 gap-3">
              <label className="text-xs">Rating<select value={feedback.rating} onChange={event => setFeedback({ ...feedback, rating: event.target.value })} className={input}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>
              <label className="text-xs">Channel<select value={feedback.channel} onChange={event => setFeedback({ ...feedback, channel: event.target.value })} className={input}>{['in_store', 'phone', 'online', 'delivery_platform'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
              <label className="col-span-2 text-xs">What happened? *<textarea required value={feedback.message} onChange={event => setFeedback({ ...feedback, message: event.target.value })} className={input} rows={3} /></label>
              <button disabled={!canManagePos || busyForm !== null} className="bb-btn-outline col-span-2"><CheckCircle2 size={15} className="mr-1 inline" />{busyForm === 'feedback' ? 'Saving…' : 'Save feedback'}</button>
            </form>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Manager follow-up queue · last 30 days</h3>
              {feedbackRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">No staff or manager feedback has been recorded yet.</p> : feedbackRows.slice(0, 8).map(row => <div key={row.id} className="border-t border-slate-100 py-3 text-xs first:border-0"><div className="flex items-center justify-between gap-3"><strong className="text-slate-700">{row.rating} / 5 · {row.channel?.replaceAll('_', ' ')}</strong><span className="text-slate-400">{row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : ''}</span></div><p className="mt-1 text-slate-600">{row.message}</p><small className="text-slate-400">Logged by {row.staff_name}</small></div>)}
            </div>
          </section>}
        </div>}
      </div>
    </div>
  )
}
