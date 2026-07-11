import { useEffect, useState } from 'react'
import { CheckCircle2, MessageSquareHeart, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

export default function RestaurantCommercialControl() {
  const [date, setDate] = useState(today())
  const [settlements, setSettlements] = useState([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [settlement, setSettlement] = useState({ channel: 'card', provider: '', expected_amount: '', settled_amount: '', reference: '', notes: '' })
  const [deposit, setDeposit] = useState({ reservation_id: '', amount: '', method: 'card', reference: '' })
  const [feedback, setFeedback] = useState({ rating: '5', channel: 'in_store', message: '' })

  async function load() {
    const rows = await window.api.pos.getSettlements(date).catch(() => [])
    setSettlements(Array.isArray(rows) ? rows : [])
  }
  useEffect(() => { load() }, [date])

  async function saveSettlement(e) {
    e.preventDefault(); setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.recordSettlement({ ...settlement, business_date: date })
      if (!result?.success) throw new Error(result?.error || 'Could not record settlement')
      setSettlement({ channel: 'card', provider: '', expected_amount: '', settled_amount: '', reference: '', notes: '' })
      setMessage('Settlement recorded. A variance remains visible until a manager resolves it.'); await load()
    } catch (error) { setMessage(error.message || 'Could not record settlement') } finally { setSaving(false) }
  }
  async function saveDeposit(e) {
    e.preventDefault(); setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.recordReservationDeposit(deposit)
      if (!result?.success) throw new Error(result?.error || 'Could not hold deposit')
      setDeposit({ reservation_id: '', amount: '', method: 'card', reference: '' }); setMessage('Reservation deposit held with an audit trail.')
    } catch (error) { setMessage(error.message || 'Could not hold deposit') } finally { setSaving(false) }
  }
  async function saveFeedback(e) {
    e.preventDefault(); setSaving(true); setMessage('')
    try {
      const result = await window.api.pos.recordFeedback({ ...feedback, rating: Number(feedback.rating) })
      if (!result?.success) throw new Error(result?.error || 'Could not save feedback')
      setFeedback({ rating: '5', channel: 'in_store', message: '' }); setMessage('Feedback captured for manager follow-up.')
    } catch (error) { setMessage(error.message || 'Could not save feedback') } finally { setSaving(false) }
  }
  const variance = settlements.reduce((sum, row) => sum + Number(row.variance_amount || 0), 0)
  const input = 'bb-input w-full mt-1'

  return <div className="mx-auto max-w-6xl p-6">
    <div className="mb-6"><h1 className="text-2xl font-bold text-slate-900">Commercial Control</h1><p className="mt-1 text-sm text-slate-500">Reconcile external money, hold table deposits, and turn feedback into action.</p></div>
    {message && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="bb-card p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-800">Settlement reconciliation</h2><p className="text-xs text-slate-500">Compare POS-recorded money with provider settlements.</p></div><WalletCards className="text-emerald-700" /></div>
        <div className="mb-4 flex items-end gap-2"><label className="text-xs font-medium text-slate-600">Business date<input type="date" value={date} onChange={e => setDate(e.target.value)} className={input} /></label><button onClick={load} className="bb-btn-outline"><RefreshCw size={14} /></button><span className={variance === 0 ? 'text-xs text-emerald-700' : 'text-xs font-semibold text-amber-700'}>{variance === 0 ? 'No recorded variance' : `Variance ${variance.toFixed(2)}`}</span></div>
        <form onSubmit={saveSettlement} className="grid grid-cols-2 gap-3"><label className="text-xs">Channel<select value={settlement.channel} onChange={e => setSettlement({...settlement, channel:e.target.value})} className={input}>{['card','mobile_money','delivery_platform','bank','voucher'].map(x => <option key={x}>{x}</option>)}</select></label><label className="text-xs">Provider<input value={settlement.provider} onChange={e => setSettlement({...settlement, provider:e.target.value})} className={input} placeholder="e.g. terminal or platform" /></label><label className="text-xs">Expected POS total<input required min="0" step="0.01" type="number" value={settlement.expected_amount} onChange={e => setSettlement({...settlement, expected_amount:e.target.value})} className={input} /></label><label className="text-xs">Settled amount<input required min="0" step="0.01" type="number" value={settlement.settled_amount} onChange={e => setSettlement({...settlement, settled_amount:e.target.value})} className={input} /></label><label className="col-span-2 text-xs">Settlement reference<input value={settlement.reference} onChange={e => setSettlement({...settlement, reference:e.target.value})} className={input} /></label><button disabled={saving} className="bb-btn-primary col-span-2"><ShieldCheck size={15} className="mr-1 inline" />Record reconciliation</button></form>
        <div className="mt-4 space-y-2">{settlements.slice(0,5).map(row => <div key={row.id} className="flex justify-between rounded bg-slate-50 p-2 text-xs"><span>{row.channel} {row.provider && `· ${row.provider}`}</span><span className={Number(row.variance_amount) === 0 ? 'text-emerald-700' : 'font-bold text-amber-700'}>{Number(row.expected_amount).toFixed(2)} → {Number(row.settled_amount).toFixed(2)}</span></div>)}</div>
      </section>
      <div className="space-y-6"><section className="bb-card p-5"><h2 className="font-bold text-slate-800">Reservation deposit</h2><p className="mb-3 text-xs text-slate-500">Held deposits are online-only and auditable; they are not a new POS sale.</p><form onSubmit={saveDeposit} className="grid grid-cols-2 gap-3"><label className="col-span-2 text-xs">Reservation ID<input required value={deposit.reservation_id} onChange={e => setDeposit({...deposit,reservation_id:e.target.value})} className={input} /></label><label className="text-xs">Amount<input required min="0.01" step="0.01" type="number" value={deposit.amount} onChange={e => setDeposit({...deposit,amount:e.target.value})} className={input} /></label><label className="text-xs">Method<select value={deposit.method} onChange={e => setDeposit({...deposit,method:e.target.value})} className={input}>{['cash','card','mobile_money','bank_transfer','voucher'].map(x => <option key={x}>{x}</option>)}</select></label><label className="col-span-2 text-xs">Reference<input value={deposit.reference} onChange={e => setDeposit({...deposit,reference:e.target.value})} className={input} /></label><button disabled={saving} className="bb-btn-primary col-span-2">Hold deposit</button></form></section>
        <section className="bb-card p-5"><div className="mb-2 flex items-center gap-2"><MessageSquareHeart className="text-rose-600" size={18}/><h2 className="font-bold text-slate-800">Customer feedback</h2></div><form onSubmit={saveFeedback} className="grid grid-cols-2 gap-3"><label className="text-xs">Rating<select value={feedback.rating} onChange={e => setFeedback({...feedback,rating:e.target.value})} className={input}>{[5,4,3,2,1].map(x => <option key={x}>{x}</option>)}</select></label><label className="text-xs">Channel<select value={feedback.channel} onChange={e => setFeedback({...feedback,channel:e.target.value})} className={input}>{['in_store','phone','online','delivery_platform'].map(x => <option key={x}>{x}</option>)}</select></label><label className="col-span-2 text-xs">What happened?<textarea value={feedback.message} onChange={e => setFeedback({...feedback,message:e.target.value})} className={input} rows="2" /></label><button disabled={saving} className="bb-btn-outline col-span-2"><CheckCircle2 size={15} className="mr-1 inline" />Save feedback</button></form></section></div>
    </div>
  </div>
}
