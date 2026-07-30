import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { Plus, Pencil, Trash2, Building2, AlertTriangle, RefreshCw, Phone, Mail, MapPin } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const CorporateBilling = lazy(() => import('./CorporateBilling'))

const emptyForm = {
  company_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  billing_address: '',
  credit_limit: '',
  payment_terms_days: '30',
  tax_number: '',
  notes: '',
  status: 'active'
}

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CorporateAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('accounts')
  const [billingAccountId, setBillingAccountId] = useState(null)
  const [billingAccountName, setBillingAccountName] = useState('')

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam) setActiveTab(tabParam)
  }, [searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.corporateAccounts.getAll()
      setAccounts(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load corporate accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setError(''); setShowModal(true) }
  const openEdit = (a) => {
    setEditing(a.id)
    setForm({
      company_name: a.company_name || '',
      contact_name: a.contact_name || '',
      contact_email: a.contact_email || '',
      contact_phone: a.contact_phone || '',
      billing_address: a.billing_address || '',
      credit_limit: a.credit_limit || '',
      payment_terms_days: a.payment_terms_days || '30',
      tax_number: a.tax_number || '',
      notes: a.notes || '',
      status: a.status || 'active'
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.company_name.trim()) { setError('Company name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, credit_limit: Number(form.credit_limit) || 0, payment_terms_days: Number(form.payment_terms_days) || 30 }
      if (editing) {
        await window.api.corporateAccounts.update(editing, payload)
      } else {
        await window.api.corporateAccounts.create(payload)
      }
      setShowModal(false)
      load()
      setSuccess(editing ? 'Corporate account updated.' : 'Corporate account created.')
    } catch (err) {
      setError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (a) => {
    setConfirmDialog({
      title: `Delete "${a.company_name}"?`,
      message: 'This permanently removes the corporate account. Existing linked bookings will keep their references.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmDialog(null)
        try { await window.api.corporateAccounts.delete(a.id); load(); setSuccess('Corporate account deleted.') } catch (err) { setError(err?.message || 'Delete failed') }
      }
    })
  }

  if (loading) return (
    <div className="bb-page">
      <div className="bb-page-header"><p className="bb-section-kicker">HOTEL OPERATIONS</p><h1 className="bb-page-header-title">Corporate Accounts</h1></div>
      <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
    </div>
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Corporate</p>
          <h1 className="bb-page-header-title mt-2">Corporate Accounts</h1>
        </div>
      </div>
      
      <div className="flex gap-1 border-b border-slate-200">
        {[
          { key: 'accounts', label: 'Accounts' },
          { key: 'billing', label: 'Billing' }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setSearchParams({ tab: key }, { replace: true }) }}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${
              activeTab === key
                ? 'border-b-2 border-emerald-600 text-emerald-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      
      {activeTab === 'accounts' && (
        <>
          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</p>
            <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Account</button>
          </div>

          {accounts.length === 0 ? (
            <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
              <Building2 size={40} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No corporate accounts yet</p>
              <p className="mt-1 text-xs text-slate-400">Add corporate accounts for company billing and group blocks.</p>
              <button onClick={openAdd} className="mt-4 btn-primary"><Plus size={14} /> Add First Account</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <div key={a.id} className="bb-card group relative p-5">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-slate-800 truncate">{a.company_name}</h3>
                      {a.contact_name && <p className="mt-0.5 text-xs text-slate-500">{a.contact_name}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); setBillingAccountId(a.id); setBillingAccountName(a.company_name); setActiveTab('billing'); setSearchParams({ tab: 'billing' }, { replace: true }) }} className="text-xs text-blue-600 hover:text-blue-800">Billing</button>
                      <button onClick={() => openEdit(a)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(a)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    {a.contact_email && <div className="flex items-center gap-1.5"><Mail size={11} /> {a.contact_email}</div>}
                    {a.contact_phone && <div className="flex items-center gap-1.5"><Phone size={11} /> {a.contact_phone}</div>}
                    {a.billing_address && <div className="flex items-center gap-1.5"><MapPin size={11} /> {a.billing_address}</div>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Credit Limit</p>
                      <p className="text-sm font-bold text-slate-800">{formatCurrency(a.credit_limit)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Payment Terms</p>
                      <p className="text-sm font-bold text-slate-800">{a.payment_terms_days || 30} days</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {a.status || 'active'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      
      {activeTab === 'billing' && (
        billingAccountId
          ? <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><CorporateBilling accountId={billingAccountId} accountName={billingAccountName} onClose={() => { setBillingAccountId(null); setActiveTab('accounts') }} /></Suspense>
          : <div className="bb-card p-8 text-center text-slate-500">Select an account from the Accounts tab to view its billing.</div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Corporate Account' : 'Add Corporate Account'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Company Name <span className="text-red-400">*</span></label>
              <input className="input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Contact Name</label>
                <input className="input" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Contact Email</label>
                <input className="input" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Phone</label>
                <input className="input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Tax Number</label>
                <input className="input" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Billing Address</label>
              <textarea className="input" rows={2} value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Credit Limit</label>
                <input className="input" type="number" min="0" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Payment Terms (days)</label>
                <input className="input" type="number" min="0" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700"><AlertTriangle size={14} className="shrink-0" />{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Account'}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog open={!!confirmDialog} title={confirmDialog?.title} message={confirmDialog?.message} confirmLabel={confirmDialog?.confirmLabel} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialog?.onConfirm} />
    </div>
  )
}
