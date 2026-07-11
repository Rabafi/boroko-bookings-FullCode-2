import { useCallback, useEffect, useState } from 'react'
import { Store, Plus, Pencil, Trash2, RefreshCw, TrendingUp, ArrowLeftRight, AlertTriangle } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const emptyOutlet = { name: '', code: '', pos_type: 'restaurant', active: true }

const OUTLET_TYPES = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'bar', label: 'Bar / Lounge' },
  { value: 'pool', label: 'Pool / Beach' },
  { value: 'spa', label: 'Spa / Wellness' },
  { value: 'mini_mart', label: 'Mini Mart' },
  { value: 'gift_shop', label: 'Gift Shop' },
  { value: 'room_service', label: 'Room Service' },
  { value: 'other', label: 'Other' }
]

export default function MultiOutletPos() {
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('outlets')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyOutlet)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [transferForm, setTransferForm] = useState({ from_outlet: '', to_outlet: '', item: '', qty: 1 })
  const [showTransfer, setShowTransfer] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.multiOutletPos?.getOutlets().catch(() => []) || []
      setOutlets(Array.isArray(data) ? data : [])
    } catch {
      setOutlets([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are required'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const result = editing
        ? await window.api.multiOutletPos?.updateOutlet(editing.id, form)
        : await window.api.multiOutletPos?.createOutlet(form)
      if (result?.success) {
        setSuccess(editing ? 'Outlet updated' : 'Outlet created')
        setShowModal(false); setEditing(null); setForm(emptyOutlet)
        await load()
      } else { setError(result?.error || 'Save failed') }
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    setConfirmDialog(null); setError(''); setSuccess('')
    try {
      const result = await window.api.multiOutletPos?.deleteOutlet(id)
      if (result?.success) { setSuccess('Outlet deleted'); await load() }
      else { setError(result?.error || 'Delete failed') }
    } catch (err) { setError(err.message) }
  }

  const handleTransfer = async () => {
    if (!transferForm.from_outlet || !transferForm.to_outlet || !transferForm.item || !transferForm.qty) {
      setError('All transfer fields required'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const result = await window.api.multiOutletPos?.transferStock(transferForm)
      if (result?.success) { setSuccess('Stock transferred'); setShowTransfer(false); setTransferForm({ from_outlet: '', to_outlet: '', item: '', qty: 1 }) }
      else { setError(result?.error || 'Transfer failed') }
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const openEdit = (outlet) => {
    setEditing(outlet)
    setForm({ name: outlet.name || '', code: outlet.code || '', pos_type: outlet.pos_type || 'restaurant', active: outlet.active !== false })
    setShowModal(true)
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="bb-card flex min-w-[220px] flex-col items-center gap-4 px-8 py-7 text-center">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          <p className="text-sm font-semibold text-[#163229]">Loading outlets...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Multi-Outlet POS</h1>
          <p className="mt-1 text-sm text-gray-500">Manage POS outlets, transfers, and cross-outlet reporting</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditing(null); setForm(emptyOutlet); setShowModal(true) }} className="btn-primary"><Plus size={15} /> New Outlet</button>
          <button onClick={() => setShowTransfer(true)} className="btn-secondary"><ArrowLeftRight size={15} /> Transfer Stock</button>
          <button onClick={load} className="btn-secondary"><RefreshCw size={15} /></button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"><AlertTriangle size={14} className="mr-1 inline" />{error}</div>}
      {success && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">✓ {success}</div>}

      <div className="flex gap-1 border-b border-gray-200">
        {['outlets', 'transfers', 'profit'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium capitalize ${activeTab === tab ? 'border-b-2 border-[#174c3a] text-[#174c3a]' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'profit' ? <><TrendingUp size={14} className="mr-1 inline" />Profit</> : tab}
          </button>
        ))}
      </div>

      {activeTab === 'outlets' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {outlets.length === 0 && <p className="col-span-full text-center text-sm text-gray-400 py-10">No POS outlets yet. Create your first outlet to get started.</p>}
          {outlets.map(outlet => (
            <div key={outlet.id} className={`bb-card p-4 ${outlet.active === false ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-[#e8f5e9] p-2"><Store size={18} className="text-[#174c3a]" /></div>
                  <div>
                    <p className="font-semibold text-gray-900">{outlet.name}</p>
                    <p className="text-xs text-gray-500">{outlet.code} · {OUTLET_TYPES.find(t => t.value === outlet.pos_type)?.label || outlet.pos_type}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(outlet)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={14} /></button>
                  <button onClick={() => setConfirmDialog({ message: `Delete outlet "${outlet.name}"?`, onConfirm: () => handleDelete(outlet.id) })} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="bb-card p-6 text-center text-sm text-gray-500">
          <ArrowLeftRight size={32} className="mx-auto mb-3 text-gray-300" />
          <p>Cross-outlet stock transfer history will appear here.</p>
          <p className="mt-1 text-xs text-gray-400">Use "Transfer Stock" to move inventory between outlets.</p>
        </div>
      )}

      {activeTab === 'profit' && (
        <div className="bb-card p-6 text-center text-sm text-gray-500">
          <TrendingUp size={32} className="mx-auto mb-3 text-gray-300" />
          <p>Outlet-level profit tracking will appear here once outlets process orders.</p>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Outlet' : 'New POS Outlet'} onClose={() => { setShowModal(false); setEditing(null); setForm(emptyOutlet) }}>
          <div className="space-y-4">
            <div>
              <label className="bb-label">Outlet Name</label>
              <input className="bb-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Main Restaurant" />
            </div>
            <div>
              <label className="bb-label">Code</label>
              <input className="bb-input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="REST-01" />
            </div>
            <div>
              <label className="bb-label">Type</label>
              <select className="bb-input" value={form.pos_type} onChange={e => setForm({ ...form, pos_type: e.target.value })}>
                {OUTLET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyOutlet) }} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showTransfer && (
        <Modal title="Transfer Stock Between Outlets" onClose={() => setShowTransfer(false)}>
          <div className="space-y-4">
            <div>
              <label className="bb-label">From Outlet</label>
              <select className="bb-input" value={transferForm.from_outlet} onChange={e => setTransferForm({ ...transferForm, from_outlet: e.target.value })}>
                <option value="">Select...</option>
                {outlets.filter(o => o.id !== transferForm.to_outlet).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bb-label">To Outlet</label>
              <select className="bb-input" value={transferForm.to_outlet} onChange={e => setTransferForm({ ...transferForm, to_outlet: e.target.value })}>
                <option value="">Select...</option>
                {outlets.filter(o => o.id !== transferForm.from_outlet).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bb-label">Item / Stock Code</label>
              <input className="bb-input" value={transferForm.item} onChange={e => setTransferForm({ ...transferForm, item: e.target.value })} placeholder="COFFEE-BEANS" />
            </div>
            <div>
              <label className="bb-label">Quantity</label>
              <input type="number" className="bb-input" value={transferForm.qty} onChange={e => setTransferForm({ ...transferForm, qty: Math.max(1, Number(e.target.value)) })} min="1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowTransfer(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleTransfer} disabled={saving} className="btn-primary">{saving ? 'Transferring...' : 'Transfer'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
