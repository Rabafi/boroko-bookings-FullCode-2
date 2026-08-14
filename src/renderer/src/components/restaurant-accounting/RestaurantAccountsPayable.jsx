import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CreditCard, FileCheck2, FilePlus2, FileText, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { AccountingButton, AccountingExportButton, AccountingLoading, AccountingNotice, AccountingPage, AccountingPanel, EmptyState, accountingInvoke, inputClass, labelClass, money, runIdempotent, today, unwrap } from './RestaurantAccountingUi'

const blankLine = () => ({ description: '', quantity: '1', unit_cost: '', tax_amount: '0', tax_code: '', expense_account_id: '' })
const blank = () => ({ supplierName: '', billNumber: '', billDate: today(), dueDate: today(), notes: '', currency: 'BWP', exchangeRate: '1', taxCode: '', sourceDocumentRef: '', sourceDocumentHash: '', lines: [blankLine()] })
const blankCredit = () => ({ billId: '', noteNumber: '', noteDate: today(), reason: '', sourceDocumentRef: '', sourceDocumentHash: '', lines: [blankLine()] })

function LineEditor({ lines, accounts, onChange, onAdd, onRemove, title = 'Bill lines' }) {
  return <AccountingPanel title={title} description="The server derives line totals, tax totals, and the recognized AP balance. Never enter a manually calculated bill total.">
    <div className="space-y-3">
      {lines.map((line, index) => <div key={index} className="rounded-xl border border-slate-200 p-3">
        <div className="grid gap-3 md:grid-cols-6">
          <label className={`${labelClass} md:col-span-2`}>Description<input required className={inputClass} value={line.description} onChange={e => onChange(index, 'description', e.target.value)} /></label>
          <label className={labelClass}>Quantity<input required type="number" min="0.001" step="0.001" className={inputClass} value={line.quantity} onChange={e => onChange(index, 'quantity', e.target.value)} /></label>
          <label className={labelClass}>Unit cost<input required type="number" min="0" step="0.01" className={inputClass} value={line.unit_cost} onChange={e => onChange(index, 'unit_cost', e.target.value)} /></label>
          <label className={labelClass}>Tax amount<input type="number" min="0" step="0.01" className={inputClass} value={line.tax_amount} onChange={e => onChange(index, 'tax_amount', e.target.value)} /></label>
          <label className={labelClass}>Tax code<input className={inputClass} value={line.tax_code || ''} onChange={e => onChange(index, 'tax_code', e.target.value)} /></label>
          <label className={`${labelClass} md:col-span-5`}>Expense / asset account<select required className={inputClass} value={line.expense_account_id} onChange={e => onChange(index, 'expense_account_id', e.target.value)}><option value="">Select</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
          {lines.length > 1 && <div className="flex items-end"><AccountingButton type="button" tone="secondary" onClick={() => onRemove(index)}><Trash2 size={14} />Remove</AccountingButton></div>}
        </div>
      </div>)}
      <AccountingButton type="button" tone="secondary" onClick={onAdd}><Plus size={14} />Add line</AccountingButton>
    </div>
  </AccountingPanel>
}

export default function RestaurantAccountsPayable() {
  const access = useAccess()
  const canManage = canAccessCapability(access, 'accounting.manage')
  const canPay = canAccessCapability(access, 'accounting.ap_pay')
  const [accounts, setAccounts] = useState([])
  const [data, setData] = useState({ bills: [], summary: {}, controls: {} })
  const [form, setForm] = useState(blank)
  const [credit, setCredit] = useState(blankCredit)
  const [settings, setSettings] = useState({ payableAccountId: '', inputTaxAccountId: '' })
  const [payment, setPayment] = useState({ billId: '', paymentDate: today(), amount: '', paymentAccountId: '', reference: '', notes: '' })
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, workspace] = await Promise.all([accountingInvoke('getAccounts'), accountingInvoke('getAp')])
      setAccounts(unwrap(a, [])); setData(unwrap(workspace, { bills: [], summary: {}, controls: {} }))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const suppliers = useMemo(() => [...new Set(data.bills.map(b => b.supplier_name).filter(Boolean))].sort(), [data.bills])
  useEffect(() => { if (!selectedSupplier && suppliers[0]) setSelectedSupplier(suppliers[0]) }, [selectedSupplier, suppliers])
  useEffect(() => {
    let cancelled = false
    if (!selectedSupplier) { setStatement(null); return undefined }
    accountingInvoke('getApSupplierStatement', selectedSupplier).then(result => { if (!cancelled) setStatement(unwrap(result, null)) }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [selectedSupplier])

  const updateLine = (setter) => (index, key, value) => setter(current => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, [key]: value } : line) }))
  const updateBillLine = updateLine(setForm)
  const updateCreditLine = updateLine(setCredit)
  const addBillLine = () => setForm(current => ({ ...current, lines: [...current.lines, blankLine()] }))
  const addCreditLine = () => setCredit(current => ({ ...current, lines: [...current.lines, blankLine()] }))
  const removeBillLine = (index) => setForm(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }))
  const removeCreditLine = (index) => setCredit(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }))
  const normalizeLines = (lines) => lines.map(line => ({ ...line, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost), tax_amount: Number(line.tax_amount || 0) }))

  const create = async (event) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('')
    try {
      await runIdempotent(`bill:${form.supplierName}:${form.billNumber}`, operationKey => accountingInvoke('createBill', { ...form, operationKey, lines: normalizeLines(form.lines) }))
      setForm(blank()); setNotice('Draft bill and its complete line set were created atomically. It is excluded from AP liability until independently approved.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const action = async (name, bill) => {
    setBusy(`${name}:${bill.id}`); setError(''); setNotice('')
    try {
      if (name === 'submit') await runIdempotent(`bill-submit:${bill.id}`, () => accountingInvoke('submitBill', bill.id))
      else await runIdempotent(`bill-approval:${bill.id}`, key => accountingInvoke('approveBill', bill.id, key))
      setNotice(name === 'submit' ? 'Bill submitted for independent approval.' : 'Bill approved and accrued to the ledger.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const pay = async (event) => {
    event.preventDefault(); setBusy('pay'); setError(''); setNotice('')
    try {
      await runIdempotent(`bill-payment:${payment.billId}:${payment.reference || payment.paymentDate}`, operationKey => accountingInvoke('payBill', { ...payment, amount: Number(payment.amount), operationKey }))
      setPayment({ billId: '', paymentDate: today(), amount: '', paymentAccountId: '', reference: '', notes: '' }); setNotice('Payment was recorded once and posted to the ledger.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const saveSettings = async (event) => {
    event.preventDefault(); setBusy('settings'); setError('')
    try { await accountingInvoke('setApSettings', settings); setNotice('AP control accounts saved.') } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const createCredit = async (event) => {
    event.preventDefault(); setBusy('credit-create'); setError(''); setNotice('')
    try {
      const result = await runIdempotent(`credit-note:${credit.billId}:${credit.noteNumber}`, operationKey => accountingInvoke('createCreditNote', { ...credit, operationKey, lines: normalizeLines(credit.lines) }))
      const created = unwrap(result, {}); setCredit(blankCredit()); setNotice(`Credit note draft ${created.id || ''} was created with immutable document evidence.`); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const creditAction = async (name, note) => {
    setBusy(`credit-${name}:${note.id}`); setError(''); setNotice('')
    try {
      if (name === 'submit') await runIdempotent(`credit-note-submit:${note.id}`, () => accountingInvoke('submitCreditNote', note.id))
      else await runIdempotent(`credit-note-approval:${note.id}`, key => accountingInvoke('approveCreditNote', note.id, key))
      setNotice(name === 'submit' ? 'Credit note submitted for independent approval.' : 'Credit note approved and posted as an AP reversal.'); await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const liabilities = accounts.filter(a => a.is_active && a.account_type === 'liability')
  const assets = accounts.filter(a => a.is_active && a.account_type === 'asset')
  const expenseAccounts = accounts.filter(a => a.is_active && ['asset', 'expense'].includes(a.account_type))
  const payableBills = data.bills.filter(b => ['approved', 'partially_paid', 'overdue'].includes(b.status) && Number(b.outstanding ?? (Number(b.total) - Number(b.amount_paid))) > 0)

  return <AccountingPage title="Accounts payable" description="Capture complete supplier invoices, recognize liability only after independent approval, reconcile supplier statements, and correct recognized AP with evidenced credit notes." actions={<><AccountingExportButton fileName="accounts-payable" exportOperation="exportAp" onError={setError} /><AccountingButton tone="secondary" onClick={load}><RefreshCw size={15} />Refresh</AccountingButton></>}>
    <AccountingNotice>Draft and submitted bills are not AP liability. Posted credit notes reduce the payable balance before payment. Purchasing/PO/GRN matching is deliberately not asserted because this installation has no authoritative purchasing source tables.</AccountingNotice>
    {error && <AccountingNotice type="error">{error}</AccountingNotice>}{notice && <AccountingNotice type="success">{notice}</AccountingNotice>}
    {loading ? <AccountingLoading /> : <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4"><AccountingPanel title="Open recognized bills"><b className="text-2xl">{data.summary.open_bills || 0}</b></AccountingPanel><AccountingPanel title="Outstanding"><b className="text-2xl">{money(data.summary.total_outstanding)}</b></AccountingPanel><AccountingPanel title="Overdue"><b className="text-2xl text-rose-700">{money(data.summary.overdue_outstanding)}</b></AccountingPanel><AccountingPanel title="Unrecognized drafts"><b className="text-2xl">{data.summary.unrecognized_bills || 0}</b></AccountingPanel></div>

      <AccountingPanel title="Supplier statement and reconciliation" description="A statement is built from recognized bills, payments, and approved credit notes, then compared with the AP control account. A mismatch is an exception, not a rounded-away adjustment.">
        <div className="flex flex-wrap items-end gap-3"><label className={labelClass}>Supplier<select className={`${inputClass} min-w-64`} value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}><option value="">Select supplier</option>{suppliers.map(s => <option key={s} value={s}>{s}</option>)}</select></label>{statement && <span className={`rounded-full px-3 py-2 text-sm font-semibold ${statement.reconciliation?.status === 'reconciled' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{statement.reconciliation?.status === 'reconciled' ? 'Reconciled' : 'Exception'} · Difference {money(statement.reconciliation?.difference)}</span>}</div>
        {statement && <div className="mt-4 space-y-3"><div className="grid gap-3 md:grid-cols-4"><div><small>Opening</small><p className="font-bold">{money(statement.opening_balance)}</p></div><div><small>Recognized bills</small><p className="font-bold">{money(statement.control_totals?.recognized_bills)}</p></div><div><small>Payments / credits</small><p className="font-bold">{money(Number(statement.control_totals?.payments || 0) + Number(statement.control_totals?.credit_notes || 0))}</p></div><div><small>Subledger balance</small><p className="font-bold">{money(statement.control_totals?.outstanding)}</p></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2">Date</th><th>Type / reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead><tbody>{(statement.rows || []).map(row => <tr key={`${row.event_type}-${row.event_id}`} className="border-b border-slate-100"><td className="py-2">{row.event_date}</td><td>{row.event_type} · {row.reference || row.event_id}</td><td className="text-right">{money(row.debit)}</td><td className="text-right">{money(row.credit)}</td><td className="text-right">{money(row.balance)}</td></tr>)}</tbody></table></div></div>}
      </AccountingPanel>

      <AccountingPanel title="Supplier bills"><div className="overflow-x-auto">{data.bills.length === 0 ? <EmptyState title="No supplier bills" /> : <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2">Supplier / invoice</th><th>Dates / evidence</th><th className="text-right">Total</th><th className="text-right">Outstanding</th><th>Status</th><th /></tr></thead><tbody>{data.bills.map(b => <tr key={b.id} className="border-b border-slate-100 align-top"><td className="py-2"><b>{b.supplier_name}</b><br /><small>{b.bill_number} · {b.currency || 'BWP'}</small><br /><small>{b.items?.length || 0} line(s)</small></td><td>{b.bill_date}<br /><small>Due {b.due_date}</small><br /><small>{b.evidence?.length || 0} evidence file(s)</small></td><td className="text-right">{money(b.total, b.currency || 'BWP')}<br /><small>Credits {money(b.credited_amount, b.currency || 'BWP')}</small></td><td className="text-right">{money(b.outstanding, b.currency || 'BWP')}</td><td>{b.status}</td><td className="text-right"><div className="flex flex-col items-end gap-2">{canManage && b.status === 'draft' && <AccountingButton tone="secondary" busy={busy === `submit:${b.id}`} onClick={() => action('submit', b)}><Send size={13} />Submit</AccountingButton>}{canManage && b.status === 'submitted' && <AccountingButton busy={busy === `approve:${b.id}`} onClick={() => action('approve', b)}><Check size={13} />Approve</AccountingButton>}{canPay && payableBills.some(x => x.id === b.id) && <AccountingButton tone="amber" onClick={() => setPayment({ ...payment, billId: b.id, amount: String(b.outstanding ?? Number(b.total) - Number(b.amount_paid)) })}><CreditCard size={13} />Pay</AccountingButton>}{canManage && ['approved', 'partially_paid', 'overdue'].includes(b.status) && <AccountingButton tone="secondary" onClick={() => setCredit({ ...blankCredit(), billId: b.id })}><FileCheck2 size={13} />Credit note</AccountingButton>}</div></td></tr>)}</tbody></table>}</div></AccountingPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        {canManage && <div className="space-y-4"><AccountingPanel title="AP control accounts"><form className="space-y-3" onSubmit={saveSettings}><label className={labelClass}>Payable liability<select required className={inputClass} value={settings.payableAccountId} onChange={e => setSettings({ ...settings, payableAccountId: e.target.value })}><option value="">Select</option>{liabilities.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label><label className={labelClass}>Input tax asset (optional)<select className={inputClass} value={settings.inputTaxAccountId} onChange={e => setSettings({ ...settings, inputTaxAccountId: e.target.value })}><option value="">None</option>{assets.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label><AccountingButton busy={busy === 'settings'}>Save controls</AccountingButton></form></AccountingPanel>
          <form className="space-y-4" onSubmit={create}><AccountingPanel title="Create supplier bill" description="Attach a source reference and SHA-256 document hash when available. The server stores the evidence identity and rejects conflicting retries."><div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>Supplier<input required className={inputClass} value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })} /></label><label className={labelClass}>Invoice number<input required className={inputClass} value={form.billNumber} onChange={e => setForm({ ...form, billNumber: e.target.value })} /></label><label className={labelClass}>Bill date<input required type="date" className={inputClass} value={form.billDate} onChange={e => setForm({ ...form, billDate: e.target.value })} /></label><label className={labelClass}>Due date<input required type="date" className={inputClass} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></label><label className={labelClass}>Currency<input required maxLength="3" className={inputClass} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label><label className={labelClass}>Exchange rate<input required type="number" min="0.000001" step="0.000001" className={inputClass} value={form.exchangeRate} onChange={e => setForm({ ...form, exchangeRate: e.target.value })} /></label><label className={labelClass}>Tax code<input className={inputClass} value={form.taxCode} onChange={e => setForm({ ...form, taxCode: e.target.value })} /></label><label className={labelClass}>Notes<input className={inputClass} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><label className={labelClass}>Document reference<input className={inputClass} value={form.sourceDocumentRef} onChange={e => setForm({ ...form, sourceDocumentRef: e.target.value })} /></label><label className={labelClass}>Document SHA-256<input className={inputClass} placeholder="Required with reference" value={form.sourceDocumentHash} onChange={e => setForm({ ...form, sourceDocumentHash: e.target.value })} /></label></div></AccountingPanel><LineEditor lines={form.lines} accounts={expenseAccounts} onChange={updateBillLine} onAdd={addBillLine} onRemove={removeBillLine} /><AccountingButton busy={busy === 'create'}><FilePlus2 size={15} />Create draft</AccountingButton></form>
        </div>}

        {canManage && <form className="space-y-4" onSubmit={createCredit}><AccountingPanel title="Create evidenced credit note" description="Credit notes are corrections, not edits. They require a source-document hash, an independent approval, and a reversing AP journal."><label className={labelClass}>Bill<select required className={inputClass} value={credit.billId} onChange={e => setCredit({ ...credit, billId: e.target.value })}><option value="">Select recognized bill</option>{data.bills.filter(b => ['approved', 'partially_paid', 'overdue'].includes(b.status)).map(b => <option key={b.id} value={b.id}>{b.supplier_name} · {b.bill_number} · {money(b.outstanding)}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>Credit-note number<input required className={inputClass} value={credit.noteNumber} onChange={e => setCredit({ ...credit, noteNumber: e.target.value })} /></label><label className={labelClass}>Date<input required type="date" className={inputClass} value={credit.noteDate} onChange={e => setCredit({ ...credit, noteDate: e.target.value })} /></label><label className={`${labelClass} sm:col-span-2`}>Reason<input required minLength="8" className={inputClass} value={credit.reason} onChange={e => setCredit({ ...credit, reason: e.target.value })} /></label><label className={labelClass}>Document reference<input required className={inputClass} value={credit.sourceDocumentRef} onChange={e => setCredit({ ...credit, sourceDocumentRef: e.target.value })} /></label><label className={labelClass}>Document SHA-256<input required className={inputClass} value={credit.sourceDocumentHash} onChange={e => setCredit({ ...credit, sourceDocumentHash: e.target.value })} /></label></div></AccountingPanel><LineEditor title="Credit-note lines" lines={credit.lines} accounts={expenseAccounts} onChange={updateCreditLine} onAdd={addCreditLine} onRemove={removeCreditLine} /><AccountingButton busy={busy === 'credit-create'}><FileCheck2 size={15} />Create credit-note draft</AccountingButton></form>}
      </div>

      {canPay && <AccountingPanel title="Record approved bill payment" description="Selecting Pay above fills the recognized outstanding amount. Credit notes are included in the server-side overpayment check."><form className="space-y-3" onSubmit={pay}><label className={labelClass}>Bill<select required className={inputClass} value={payment.billId} onChange={e => setPayment({ ...payment, billId: e.target.value })}><option value="">Select approved bill</option>{payableBills.map(b => <option key={b.id} value={b.id}>{b.supplier_name} · {b.bill_number} · {money(b.outstanding)}</option>)}</select></label><label className={labelClass}>Payment date<input required type="date" className={inputClass} value={payment.paymentDate} onChange={e => setPayment({ ...payment, paymentDate: e.target.value })} /></label><label className={labelClass}>Amount<input required type="number" min="0.01" step="0.01" className={inputClass} value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} /></label><label className={labelClass}>Payment asset account<select required className={inputClass} value={payment.paymentAccountId} onChange={e => setPayment({ ...payment, paymentAccountId: e.target.value })}><option value="">Select cash or bank</option>{assets.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label><label className={labelClass}>Reference<input className={inputClass} value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} /></label><AccountingButton busy={busy === 'pay'}><CreditCard size={15} />Record payment</AccountingButton></form></AccountingPanel>}

      {data.bills.some(b => (b.credit_notes || []).length) && <AccountingPanel title="Credit-note approvals" description="A submitted credit note must be approved by a different operator before its reversal journal is posted."><div className="space-y-2">{data.bills.flatMap(b => (b.credit_notes || []).map(note => ({ ...note, supplier_name: b.supplier_name, bill_number: b.bill_number }))).map(note => <div key={note.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><span><b>{note.supplier_name} · {note.note_number}</b><br /><small>{note.reason} · {money(note.total)} · {note.status}</small></span><span className="flex gap-2">{canManage && note.status === 'draft' && <AccountingButton tone="secondary" busy={busy === `credit-submit:${note.id}`} onClick={() => creditAction('submit', note)}><Send size={13} />Submit</AccountingButton>}{canManage && note.status === 'submitted' && <AccountingButton busy={busy === `credit-approve:${note.id}`} onClick={() => creditAction('approve', note)}><Check size={13} />Approve</AccountingButton>}</span></div>)}</div></AccountingPanel>}
    </div>}
  </AccountingPage>
}
