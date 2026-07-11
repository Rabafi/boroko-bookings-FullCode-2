import { useState, useEffect } from 'react'
import { Clock, Sun, Moon, Plus, CheckCircle, XCircle, DollarSign } from 'lucide-react'
import { useSettings } from '../app-context'

function PolicyCard({ policy, type, onEdit, onDelete }) {
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
        <p>Fee: {policy.fee_type === 'flat' ? `P${policy.fee_amount}` : `${policy.fee_percentage}%`}</p>
        <p>Window: {policy.allowed_window_hours}h</p>
        {policy.requires_approval && <p className="text-amber-600 font-medium">Requires approval</p>}
      </div>
    </div>
  )
}

function RequestCard({ request, onApprove, onReject, loading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Booking: {request.booking_id?.slice(0, 8)}...</p>
          <p className="text-xs text-gray-400">{new Date(request.requested_time).toLocaleString()}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          request.status === 'approved' ? 'bg-green-100 text-green-700' :
          request.status === 'rejected' ? 'bg-red-100 text-red-700' :
          'bg-yellow-100 text-yellow-700'
        }`}>{request.status}</span>
      </div>
      <p className="text-sm font-semibold text-gray-700">Fee: P{Number(request.fee_amount || 0).toFixed(2)}</p>
      {request.status === 'pending' && (
        <div className="flex gap-2 mt-3">
          <button onClick={() => onApprove(request.id)} disabled={loading} className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200">
            <CheckCircle size={12} /> Approve
          </button>
          <button onClick={() => onReject(request.id)} disabled={loading} className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200">
            <XCircle size={12} /> Reject
          </button>
        </div>
      )}
    </div>
  )
}

function PolicyForm({ initial, onSave, onCancel, loading }) {
  const [form, setForm] = useState(initial || { name: '', fee_type: 'flat', fee_amount: 0, fee_percentage: 0, allowed_window_hours: 2, requires_approval: false, active: true })

  const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
      <h3 className="font-semibold text-gray-700 mb-4">{initial ? 'Edit Policy' : 'New Policy'}</h3>
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
            </select>
          </div>
          {form.fee_type === 'flat' ? (
            <div>
              <label className="text-xs text-gray-500">Fee Amount</label>
              <input type="number" value={form.fee_amount} onChange={e => handleChange('fee_amount', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-500">Fee %</label>
              <input type="number" value={form.fee_percentage} onChange={e => handleChange('fee_percentage', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Window (hours)</label>
            <input type="number" value={form.allowed_window_hours} onChange={e => handleChange('allowed_window_hours', Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.requires_approval} onChange={e => handleChange('requires_approval', e.target.checked)} className="rounded" />
              Requires approval
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

export default function EarlyLateCheckout() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [type, setType] = useState('early')
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
      const fn = type === 'early' ? window.api.earlyLateCheckout.getEarlyPolicies : window.api.earlyLateCheckout.getLatePolicies
      const result = await fn()
      setPolicies(result?.policies || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadRequests = async () => {
    setLoading(true); setError('')
    try {
      const fn = type === 'early' ? window.api.earlyLateCheckout.getEarlyRequests : window.api.earlyLateCheckout.getLateRequests
      const result = await fn()
      setRequests(result?.requests || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'policies') loadPolicies()
    else loadRequests()
  }, [tab, type])

  const handleSavePolicy = async (form) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const createFn = type === 'early' ? window.api.earlyLateCheckout.createEarlyPolicy : window.api.earlyLateCheckout.createLatePolicy
      const updateFn = type === 'early' ? window.api.earlyLateCheckout.updateEarlyPolicy : window.api.earlyLateCheckout.updateLatePolicy
      if (editPolicy) {
        await updateFn(editPolicy.id, form)
      } else {
        await createFn(form)
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
      const fn = type === 'early' ? window.api.earlyLateCheckout.deleteEarlyPolicy : window.api.earlyLateCheckout.deleteLatePolicy
      await fn(id)
      setSuccess('Policy deleted')
      loadPolicies()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleApprove = async (id) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const fn = type === 'early' ? window.api.earlyLateCheckout.approveEarlyRequest : window.api.earlyLateCheckout.approveLateRequest
      await fn(id)
      setSuccess('Request approved')
      loadRequests()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleReject = async (id) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const fn = type === 'early' ? window.api.earlyLateCheckout.rejectEarlyRequest : window.api.earlyLateCheckout.rejectLateRequest
      await fn(id)
      setSuccess('Request rejected')
      loadRequests()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Early Check-in / Late Checkout</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage policies and requests</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>}
      {success && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">&#10003; {success}</div>}

      <div className="flex gap-2 mb-6">
        <button onClick={() => setType('early')} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${type === 'early' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Sun size={14} /> Early Check-in
        </button>
        <button onClick={() => setType('late')} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${type === 'late' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Moon size={14} /> Late Checkout
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('policies')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === 'policies' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Policies</button>
        <button onClick={() => setTab('requests')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === 'requests' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Requests</button>
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
            {policies.map(p => <PolicyCard key={p.id} policy={p} type={type} onEdit={(p) => { setEditPolicy(p); setShowForm(true) }} onDelete={handleDeletePolicy} />)}
            {policies.length === 0 && !loading && <p className="text-sm text-gray-400 col-span-2 text-center py-8">No policies defined.</p>}
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">No requests found.</p>}
          {requests.map(r => <RequestCard key={r.id} request={r} onApprove={handleApprove} onReject={handleReject} loading={loading} />)}
        </div>
      )}
    </div>
  )
}
