import { useState, useEffect } from 'react'
import { Ban, Plus, CheckCircle, XCircle, DollarSign, RotateCcw } from 'lucide-react'
import { useSettings } from '../app-context'

function PolicyCard({ policy, onEdit, onDelete }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-medium text-gray-800">{policy.name}</h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${policy.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {policy.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(policy)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">Edit</button>
          <button onClick={() => onDelete(policy.id)} className="text-xs text-red-600 hover:text-red-800 px-2 py-1">Delete</button>
        </div>
      </div>
      <div className="text-xs text-gray-500 space-y-1">
        <p>Fee: {policy.fee_type === 'flat' ? `P${policy.fee_amount_or_percent}` : policy.fee_type === 'percentage' ? `${policy.fee_amount_or_percent}%` : `${policy.fee_amount_or_percent} nights`}</p>
        <p>Free cancellation: {policy.free_cancellation_hours}h before check-in</p>
        <p>Deposit: {policy.deposit_retention_behavior}</p>
        {policy.customer_credit_behavior && <p className="text-amber-600 font-medium">Customer credit enabled</p>}
      </div>
    </div>
  )
}

function RequestCard({ request, onApprove, loading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Booking: {request.booking_id?.slice(0, 8)}...</p>
          <p className="text-xs text-gray-400">{request.reason_category || 'No reason'} &middot; {new Date(request.created_at).toLocaleDateString()}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          request.status === 'approved' ? 'bg-green-100 text-green-700' :
          request.status === 'rejected' ? 'bg-red-100 text-red-700' :
          request.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
          'bg-yellow-100 text-yellow-700'
        }`}>{request.status}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mt-2">
        <div><span className="text-gray-400">Fee:</span> <span className="font-medium">P{Number(request.fee_calculated || 0).toFixed(2)}</span></div>
        <div><span className="text-gray-400">Refund:</span> <span className="font-medium text-green-600">P{Number(request.refund_amount || 0).toFixed(2)}</span></div>
        <div><span className="text-gray-400">Retained:</span> <span className="font-medium text-red-600">P{Number(request.retained_amount || 0).toFixed(2)}</span></div>
      </div>
      {request.status === 'pending' && (
        <button onClick={() => onApprove(request.id)} disabled={loading} className="mt-3 flex items-center gap-1 text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200">
          <CheckCircle size={12} /> Approve Cancellation
        </button>
      )}
    </div>
  )
}

function PolicyForm({ initial, onSave, onCancel, loading }) {
  const [form, setForm] = useState(initial || {
    name: '', applicable_sources: [], free_cancellation_hours: 24, fee_type: 'flat',
    fee_amount_or_percent: 0, deposit_retention_behavior: 'forfeit',
    customer_credit_behavior: false, active: true, priority: 0
  })

  const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
      <h3 className="font-semibold text-gray-700 mb-4">{initial ? 'Edit Policy' : 'New Cancellation Policy'}</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">Name</label>
          <input type="text" value={form.name} onChange={e => handleChange('name', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Fee Type</label>
            <select value={form.fee_type} onChange={e => handleChange('fee_type', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
              <option value="flat">Flat</option>
              <option value="percentage">Percentage</option>
              <option value="nights">Nights</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Amount / Percent / Nights</label>
            <input type="number" value={form.fee_amount_or_percent} onChange={e => handleChange('fee_amount_or_percent', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Free cancel (hours before)</label>
            <input type="number" value={form.free_cancellation_hours} onChange={e => handleChange('free_cancellation_hours', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Deposit retention</label>
            <select value={form.deposit_retention_behavior} onChange={e => handleChange('deposit_retention_behavior', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
              <option value="forfeit">Forfeit</option>
              <option value="partial">Partial</option>
              <option value="refund">Refund</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Priority</label>
            <input type="number" value={form.priority} onChange={e => handleChange('priority', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div className="flex items-end pb-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.customer_credit_behavior} onChange={e => handleChange('customer_credit_behavior', e.target.checked)} className="rounded" />
              Customer credit
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.active} onChange={e => handleChange('active', e.target.checked)} className="rounded" />
              Active
            </label>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onSave(form)} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">Save</button>
          <button onClick={onCancel} className="text-gray-500 px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function CancellationPolicies() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [tab, setTab] = useState('policies')
  const [policies, setPolicies] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editPolicy, setEditPolicy] = useState(null)

  const loadPolicies = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.cancellationPolicies.getAll()
      setPolicies(result?.policies || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadRequests = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.cancellationPolicies.getRequests()
      setRequests(result?.requests || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'policies') loadPolicies()
    else loadRequests()
  }, [tab])

  const handleSavePolicy = async (form) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      if (editPolicy) {
        await window.api.cancellationPolicies.update(editPolicy.id, form)
      } else {
        await window.api.cancellationPolicies.create(form)
      }
      setSuccess('Policy saved')
      setShowForm(false); setEditPolicy(null)
      loadPolicies()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleDeletePolicy = async (id) => {
    setLoading(true); setError('')
    try {
      await window.api.cancellationPolicies.delete(id)
      setSuccess('Policy deleted')
      loadPolicies()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleApprove = async (requestId) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      await window.api.cancellationPolicies.approve(requestId, null)
      setSuccess('Cancellation approved')
      loadRequests()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Cancellation & No-Show Policies</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage cancellation fees, deposit handling, and approval workflow</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>}
      {success && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">&#10003; {success}</div>}

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('policies')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'policies' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Ban size={14} className="inline mr-1" /> Policies
        </button>
        <button onClick={() => setTab('requests')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'requests' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <DollarSign size={14} className="inline mr-1" /> Requests ({requests.filter(r => r.status === 'pending').length})
        </button>
      </div>

      {tab === 'policies' && (
        <div className="space-y-4">
          {!showForm && (
            <button onClick={() => { setShowForm(true); setEditPolicy(null) }} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 font-medium">
              <Plus size={14} /> Add Policy
            </button>
          )}
          {showForm && <PolicyForm initial={editPolicy} onSave={handleSavePolicy} onCancel={() => { setShowForm(false); setEditPolicy(null) }} loading={loading} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {policies.map(p => <PolicyCard key={p.id} policy={p} onEdit={(p) => { setEditPolicy(p); setShowForm(true) }} onDelete={handleDeletePolicy} />)}
            {policies.length === 0 && !loading && <p className="text-sm text-gray-400 col-span-2 text-center py-8">No policies defined.</p>}
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">No cancellation requests.</p>}
          {requests.map(r => <RequestCard key={r.id} request={r} onApprove={handleApprove} loading={loading} />)}
        </div>
      )}
    </div>
  )
}
