import { useState, useEffect } from 'react'
import { ClipboardList, Plus, Loader2, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react'
import { rpc } from '../lib/publicApi.js'
import { useGuestPortal } from './GuestPortalSession.jsx'

const REQUEST_TYPES = [
  { value: 'late_checkout', label: 'Late Check-out' },
  { value: 'early_checkin', label: 'Early Check-in' },
  { value: 'extra_towels', label: 'Extra Towels' },
  { value: 'room_service', label: 'Room Service' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'wake_up_call', label: 'Wake-up Call' },
  { value: 'transport', label: 'Transport' },
  { value: 'other', label: 'Other' }
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' }
]

const STATUS_CONFIG = {
  new: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pending' },
  acknowledged: { icon: AlertCircle, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Acknowledged' },
  completed: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Completed' },
  declined: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Declined' }
}

export default function GuestRequests() {
  const { token } = useGuestPortal()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const [requestType, setRequestType] = useState('')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    loadRequests()
  }, [token])

  async function loadRequests() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await rpc('get_guest_requests', { p_token: token })
      if (rpcErr) { setError(rpcErr.message); return }
      if (!data || data.success === false) { setError(data?.error || 'Could not load requests.'); return }
      setRequests(data.requests || [])
    } catch (e) {
      setError(e.message || 'Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!requestType) {
      setFormError('Please select a request type.')
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        description: description.trim(),
        priority
      }
      const { data, error: rpcErr } = await rpc('submit_guest_portal_request', {
        p_token: token,
        p_request_type: requestType,
        p_payload: payload
      })
      if (rpcErr) { setFormError(rpcErr.message); return }
      if (!data || data.success === false) { setFormError(data?.error || 'Could not submit request.'); return }

      setRequestType('')
      setPriority('normal')
      setDescription('')
      setShowForm(false)
      await loadRequests()
    } catch (e) {
      setFormError(e.message || 'Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="skeleton h-20 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Your Requests</h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-strong)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New Request
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="surface-card rounded-[20px] border border-[var(--line)] p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Request Type</label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              className="guest-input"
              disabled={submitting}
            >
              <option value="">Select a request type…</option>
              {REQUEST_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Priority</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((po) => (
                <button
                  key={po.value}
                  type="button"
                  onClick={() => setPriority(po.value)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                    priority === po.value
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]'
                      : 'border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--line-strong)]'
                  }`}
                  disabled={submitting}
                >
                  {po.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what you need…"
              rows={3}
              maxLength={2000}
              className="guest-input resize-none"
              disabled={submitting}
            />
          </div>

          {formError && (
            <p className="text-xs font-semibold text-[var(--danger)]">{formError}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null) }}
              className="flex-1 rounded-full border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--muted)] transition-colors hover:border-[var(--line-strong)]"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!requestType || submitting}
              className="brand-button flex-1 rounded-full px-4 py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </span>
              ) : (
                'Submit Request'
              )}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={loadRequests}
            className="mt-3 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {!error && requests.length === 0 && !showForm ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">No requests yet. Tap "New Request" to get started.</p>
        </div>
      ) : requests.length > 0 ? (
        <div className="space-y-3">
          {requests.map((req, i) => {
            const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.new
            const Icon = cfg.icon
            const typeLabel = REQUEST_TYPES.find((rt) => rt.value === req.request_type)?.label || req.request_type
            return (
              <div key={req.id || i} className="surface-card rounded-[16px] border border-[var(--line)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text)]">{typeLabel}</p>
                    {req.payload?.description && (
                      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{req.payload.description}</p>
                    )}
                    {req.payload?.priority && (
                      <span className="mt-2 inline-block rounded-full bg-[var(--surface-strong)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                        {req.payload.priority}
                      </span>
                    )}
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 ${cfg.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                    <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </span>
                </div>
                {req.created_at && (
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                    {new Date(req.created_at).toLocaleString()}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
