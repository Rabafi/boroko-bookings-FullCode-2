import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  Download,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
const monthStart = () => {
  return `${today().slice(0, 7)}-01`;
};
const EMPTY = { date: today(), category: 'Food & beverage', description: '', amount: '', notes: '', evidence_ref: '', reference_number: '', source_kind: 'direct', payment_method: 'cash' };
const CATEGORIES = ['Food & beverage', 'Utilities', 'Payroll', 'Maintenance', 'Transport', 'Marketing', 'Cleaning', 'Licences', 'Other'];

export default function HposExpenses() {
  const access = useAccess();
  const { settings } = useSettings();
  const currency = settings?.currency || 'P';
  const canManage = canAccessCapability(access, 'expenses.manage');
  const [expenses, setExpenses] = useState([]);
  const [readCompleteness, setReadCompleteness] = useState({ source: 'unknown', complete: false });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await window.api?.expenses?.getAll?.(start, end, 'all');
      setExpenses(Array.isArray(rows) ? rows : []);
      setReadCompleteness({ source: rows?._source || 'unknown', complete: rows?._complete === true });
    } catch (loadError) {
      setExpenses([]);
      setReadCompleteness({ source: 'error', complete: false });
      setError(loadError?.message || 'Operating expenses could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [end, start]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(
    () => [...new Set([...CATEGORIES, ...expenses.map((expense) => expense.category).filter(Boolean)])].sort(),
    [expenses],
  );
  const filtered = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          (category === 'all' || expense.category === category) &&
          (!query || `${expense.description || ''} ${expense.category || ''} ${expense.notes || ''}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [expenses, category, query],
  );
  const postedRows = filtered.filter((expense) => ['posted', 'paid'].includes(String(expense.status || '').toLowerCase()));
  const total = postedRows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const average = postedRows.length ? total / postedRows.length : 0;
  const formatMoney = (value) => `${currency} ${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const openCreate = () => {
    setEditing({});
    setForm({ ...EMPTY, date: today() });
    setError('');
  };
  const openEdit = (expense) => {
    setEditing(expense);
    setForm({ date: expense.date || today(), category: expense.category || CATEGORIES[0], description: expense.description || '', amount: String(expense.amount || ''), notes: expense.notes || '', evidence_ref: expense.evidence_ref || '', reference_number: expense.reference_number || '', source_kind: expense.source_kind || 'direct', payment_method: expense.payment_method || 'cash' });
    setError('');
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.date || !form.category || !form.description.trim() || Number(form.amount) <= 0) {
      setError('Date, category, description, and an amount above zero are required.');
      return;
    }
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const payload = { ...form, description: form.description.trim(), notes: form.notes.trim() || null, evidence_ref: form.evidence_ref.trim() || null, reference_number: form.reference_number.trim() || null, amount: Number(form.amount) };
      const result = editing?.id
        ? await window.api?.expenses?.update?.(editing.id, payload)
        : await window.api?.expenses?.create?.(payload);
      if (!result?.success) throw new Error(result?.error || 'Could not save this expense.');
      setEditing(null);
      setForm({ ...EMPTY, date: today() });
      setNotice(`${editing?.id ? 'Draft updated' : 'Draft saved'}${result?.queued ? ' and queued for sync' : ''}. Submit it after attaching evidence.`);
      await load();
    } catch (saveError) {
      setError(saveError?.message || 'Could not save this expense.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete?.id) return;
    await runExpenseAction('delete', pendingDelete);
    setPendingDelete(null);
  };

  const exportExpenses = async () => {
    setNotice('');
    setError('');
    try {
      const result = await window.api?.data?.exportAll?.({ preset: 'restaurant_dailyClose', startDate: start, endDate: end });
      if (!result?.success) throw new Error(result?.error || 'Export cancelled.');
      setNotice(`Daily close workbook created${result.filePath ? `: ${result.filePath}` : '.'}`);
    } catch (exportError) {
      setError(exportError?.message || 'Could not export expenses.');
    }
  };

  const runExpenseAction = async (action, expense, payload = {}) => {
    const storageKey = `hpos:expense-operation:${action}:${expense.id}`;
    let operationId = window.localStorage?.getItem(storageKey);
    if (!operationId) {
      operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage?.setItem(storageKey, operationId);
    }
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = action === 'delete'
        ? await window.api?.expenses?.delete?.(expense.id, operationId)
        : await window.api?.expenses?.[action]?.(expense.id, payload, operationId);
      if (!result?.success) throw new Error(result?.error || `Could not ${action} expense.`);
      if (!result?.queued) window.localStorage?.removeItem(storageKey);
      setNotice(`${action === 'delete' ? 'Expense voided' : `Expense ${action}d`}${result?.queued ? ' and queued for sync' : ''}.`);
      await load();
    } catch (actionError) {
      setError(actionError?.message || `Could not ${action} expense.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hpos-page-frame hpos-expenses-page">
      <HposPageHero
        eyebrow="Spend control"
        title="Operating expenses"
        description="Capture restaurant or bar costs against the right date, then review and export a clean operating register."
        actions={<div className="hpos-hero-actions"><HposButton icon={Download} onClick={exportExpenses} disabled={!readCompleteness.complete}>Export close pack</HposButton>{canManage && <HposButton tone="primary" icon={Plus} onClick={openCreate}>Record expense</HposButton>}</div>}
      />
      {error && !editing && !pendingDelete && <HposNotice tone="error">{error}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}
      {!loading && !readCompleteness.complete && <HposNotice tone="warning">This register is not server-complete ({readCompleteness.source || 'unknown'}). Financial totals and exports require a confirmed online read.</HposNotice>}

      <section className="hpos-money-kpis">
        {[['Posted spend', readCompleteness.complete ? formatMoney(total) : 'Unavailable'], ['Entries', filtered.length], ['Average posted expense', readCompleteness.complete ? formatMoney(average) : 'Unavailable'], ['Largest posted', readCompleteness.complete ? formatMoney(Math.max(0, ...postedRows.map((expense) => Number(expense.amount || 0)))) : 'Unavailable']].map(([label, value], index) => (
          <div className="hpos-money-kpi" key={label} style={{ '--hpos-kpi-tone': ['#c95635', '#7256a8', '#d49a3a', '#477b68'][index] }}><small>{label}</small><strong>{loading ? '—' : value}</strong></div>
        ))}
      </section>

      <section className="hpos-expense-tools">
        <label><span>From</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <label className="hpos-expense-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description or note" /></label>
        <select aria-label="Expense category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      </section>

      <section className="hpos-money-ledger">
        <div className="hpos-ledger-title"><span className="hpos-ledger-icon"><WalletCards size={17} /></span><div><strong>Expense register</strong><small>{filtered.length} matching entries · {start} to {end}</small></div></div>
        {filtered.map((expense) => (
          <article key={expense.id} className="hpos-expense-row">
            <div><strong>{expense.description || expense.category || 'Expense'}</strong><span>{expense.notes || expense.category || 'No note'}</span></div>
            <span>{expense.category || 'General'}</span>
            <span>{expense.date || expense.expense_date || expense.created_at?.slice(0, 10) || '—'}</span>
            <HposStatusBadge tone={expense._pending_sync ? 'warning' : ['voided', 'reversed', 'exception'].includes(expense.status) ? 'danger' : expense.status === 'paid' ? 'success' : 'warning'}>{expense._pending_sync ? 'Pending sync' : expense.status || 'draft'}</HposStatusBadge>
            <strong className="hpos-negative-value"><ArrowDownRight size={13} />{readCompleteness.complete ? formatMoney(expense.amount) : 'Unavailable'}</strong>
            {canManage && <div className="hpos-row-actions">
              {['draft', 'unposted'].includes(expense.status) && <button type="button" onClick={() => runExpenseAction('submit', expense)} disabled={saving}>Submit</button>}
              {expense.status === 'submitted' && <button type="button" onClick={() => runExpenseAction('approve', expense)} disabled={saving}>Approve</button>}
              {expense.status === 'approved' && <button type="button" onClick={() => runExpenseAction('post', expense)} disabled={saving}>Post</button>}
              {expense.status === 'posted' && <button type="button" onClick={() => runExpenseAction('pay', expense)} disabled={saving}>Pay</button>}
              {['posted', 'paid'].includes(expense.status) && <button type="button" onClick={() => runExpenseAction('reverse', expense, { reason: 'Operator-requested controlled reversal' })} disabled={saving}>Reverse</button>}
              {['draft', 'unposted'].includes(expense.status) && <button type="button" onClick={() => openEdit(expense)} aria-label={`Edit ${expense.description}`}><Pencil size={15} /></button>}
              {!['voided', 'reversed', 'paid'].includes(expense.status) && <button type="button" className="is-danger" onClick={() => setPendingDelete(expense)} aria-label={`Void ${expense.description}`}><Trash2 size={15} /></button>}
            </div>}
          </article>
        ))}
        {!loading && !filtered.length && <HposEmptyState icon={Receipt} title="No expenses match" description="Adjust the dates or filters, or record the first operating expense." />}
      </section>

      {editing && (
        <div className="hpos-modal-backdrop" role="presentation">
          <form className="hpos-expense-form" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title">
            <button type="button" className="hpos-modal-close" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            <p className="hpos-eyebrow">Operating register</p><h2 id="expense-dialog-title">{editing.id ? 'Edit expense' : 'Record expense'}</h2>
            <div className="hpos-form-grid">
              <label>Date<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="is-wide">Description<input autoFocus required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What was purchased and why?" /></label>
              <label>Amount ({currency})<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label>Reference / note<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Supplier, receipt or approval" /></label>
              <label>Receipt / evidence reference<input required={!editing.id} value={form.evidence_ref} onChange={(event) => setForm({ ...form, evidence_ref: event.target.value })} placeholder="Receipt number or document link" /></label>
              <label>Reference number<input value={form.reference_number} onChange={(event) => setForm({ ...form, reference_number: event.target.value })} placeholder="Supplier invoice / receipt no." /></label>
              <label>Payment method<select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}><option value="cash">Cash</option><option value="card">Card</option><option value="mobile_money">Mobile money</option><option value="bank">Bank transfer</option><option value="account">On account</option></select></label>
              <label>Source kind<select value={form.source_kind} onChange={(event) => setForm({ ...form, source_kind: event.target.value })}><option value="direct">Direct-paid expense</option><option value="ap_bill">AP bill link (no duplicate posting)</option><option value="other">Other source document</option></select></label>
            </div>
            {error && <HposNotice tone="error">{error}</HposNotice>}
            <div className="hpos-modal-actions"><HposButton onClick={() => setEditing(null)}>Cancel</HposButton><HposButton type="submit" tone="primary" disabled={saving}>{saving ? 'Saving…' : editing.id ? 'Update expense' : 'Record expense'}</HposButton></div>
          </form>
        </div>
      )}

      {pendingDelete && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-expense-title">
            <span className="hpos-confirm-icon"><Trash2 size={22} /></span><h2 id="delete-expense-title">Void this expense?</h2><p><strong>{pendingDelete.description}</strong> for {readCompleteness.complete ? formatMoney(pendingDelete.amount) : 'an amount currently unavailable'} will be voided from the register. The original record remains in the audit trail.</p>
            {error && <HposNotice tone="error">{error}</HposNotice>}
            <div className="hpos-modal-actions"><HposButton onClick={() => setPendingDelete(null)}>Cancel</HposButton><button type="button" className="hpos-danger-action" disabled={saving} onClick={remove}>{saving ? 'Voiding…' : 'Void expense'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
