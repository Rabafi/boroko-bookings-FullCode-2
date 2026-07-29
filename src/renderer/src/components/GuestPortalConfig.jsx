import { useCallback, useEffect, useState } from 'react'
import { Save, RefreshCw, Globe, Users, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Modal } from './shared/Modal'

const ALL_ACTIONS = [
  { key: 'view_booking', label: 'View Booking' },
  { key: 'pay_balance', label: 'Pay Balance' },
  { key: 'upload_documents', label: 'Upload Documents' },
  { key: 'request_changes', label: 'Request Changes' },
  { key: 'message_property', label: 'Message Property' },
  { key: 'view_documents', label: 'View Documents' }
]

export default function GuestPortalConfig() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pendingRequests, setPendingRequests] = useState([])

  const [portalEnabled, setPortalEnabled] = useState(false)
  const [allowedActions, setAllowedActions] = useState(['view_booking'])
  const [branding, setBranding] = useState({ logo_url: '', colors: { primary: '#1e293b', accent: '#059669' }, terms_text: '' })
  const [requiredUploadFields, setRequiredUploadFields] = useState([])
  const [newField, setNewField] = useState('')

  const [staleWarning, setStaleWarning] = useState('')
  const [requestsError, setRequestsError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setStaleWarning('')
    setRequestsError('')
    try {
      const [cfgResult, reqsResult] = await Promise.allSettled([
        window.api.guestPortal.getConfig(),
        window.api.guestPortal.getPendingRequests()
      ])

      if (cfgResult.status === 'fulfilled') {
        const cfg = cfgResult.value
        if (cfg) {
          setConfig(cfg)
          setPortalEnabled(cfg.portal_enabled || false)
          setAllowedActions(Array.isArray(cfg.allowed_actions) ? cfg.allowed_actions : ['view_booking'])
          setBranding(cfg.branding || { logo_url: '', colors: { primary: '#1e293b', accent: '#059669' }, terms_text: '' })
          setRequiredUploadFields(Array.isArray(cfg.required_upload_fields) ? cfg.required_upload_fields : [])
          if (cfg.stale || cfg.fromCache || cfg.warning) {
            setStaleWarning(cfg.warning || 'Showing cached portal configuration')
          }
        }
      } else {
        setError(cfgResult.reason?.message || 'Failed to load portal config')
      }

      if (reqsResult.status === 'fulfilled') {
        const reqs = reqsResult.value
        setPendingRequests(Array.isArray(reqs) ? reqs : (reqs?.cached || []))
      } else {
        const reason = reqsResult.reason
        if (reason?.cached) {
          setPendingRequests(Array.isArray(reason.cached) ? reason.cached : [])
          setRequestsError(reason.message || 'Showing cached pending requests')
        } else {
          setPendingRequests([])
          setRequestsError(reason?.message || 'Failed to load pending guest requests')
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to load portal config')
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

  const toggleAction = (key) => {
    setAllowedActions((prev) => prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key])
  }

  const addField = () => {
    if (newField.trim() && !requiredUploadFields.includes(newField.trim())) {
      setRequiredUploadFields((prev) => [...prev, newField.trim()])
      setNewField('')
    }
  }

  const removeField = (field) => {
    setRequiredUploadFields((prev) => prev.filter((f) => f !== field))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        portal_enabled: portalEnabled,
        allowed_actions: allowedActions,
        branding,
        required_upload_fields: requiredUploadFields
      }
      await window.api.guestPortal.updateConfig(payload)
      setSuccess('Portal configuration saved.')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bb-page flex items-center justify-center">
        <div className="text-sm text-slate-500">Loading guest portal config...</div>
      </div>
    )
  }

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">ENTERPRISE</p>
          <h1 className="bb-page-header-title">Guest Portal</h1>
          <p className="bb-page-header-subtitle">Self-service portal configuration for guests</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {staleWarning && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{staleWarning}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      <section className="bb-card p-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-4 text-xs text-slate-600">
          This screen configures the guest portal. Guests use the public booking-site portal at <code className="font-mono">/portal?token=…</code> after a session is created.
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe size={20} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Portal Status</h2>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" checked={portalEnabled} onChange={() => setPortalEnabled(!portalEnabled)} className="peer sr-only" />
            <div className="h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-emerald-600 peer-checked:after:translate-x-full" />
          </label>
        </div>
        <p className="mt-2 text-sm text-slate-500">{portalEnabled ? 'Portal is active and accepting guest sessions' : 'Portal is disabled'}</p>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-900">Allowed Actions</h2>
          <p className="mt-1 text-xs text-slate-500">Choose which self-service actions guests can perform</p>
          <div className="mt-3 space-y-2">
            {ALL_ACTIONS.map((action) => (
              <label key={action.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                <input type="checkbox" checked={allowedActions.includes(action.key)} onChange={() => toggleAction(action.key)} className="h-4 w-4" />
                <span className="text-sm text-slate-700">{action.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-900">Branding</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Logo URL</label>
              <input className="input w-full" value={branding.logo_url || ''} onChange={(e) => setBranding((b) => ({ ...b, logo_url: e.target.value }))} placeholder="https://example.com/logo.png" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Primary Color</label>
                <input className="input w-full" type="color" value={branding.colors?.primary || '#1e293b'} onChange={(e) => setBranding((b) => ({ ...b, colors: { ...b.colors, primary: e.target.value } }))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Accent Color</label>
                <input className="input w-full" type="color" value={branding.colors?.accent || '#059669'} onChange={(e) => setBranding((b) => ({ ...b, colors: { ...b.colors, accent: e.target.value } }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Terms Text</label>
              <textarea className="input w-full" rows={3} value={branding.terms_text || ''} onChange={(e) => setBranding((b) => ({ ...b, terms_text: e.target.value }))} placeholder="Terms and conditions displayed in the portal..." />
            </div>
          </div>
        </section>
      </div>

      <section className="bb-card p-5">
        <h2 className="text-sm font-bold text-slate-900">Required Upload Fields</h2>
        <p className="mt-1 text-xs text-slate-500">Fields guests must complete when uploading documents</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {requiredUploadFields.map((field) => (
            <span key={field} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {field}
              <button onClick={() => removeField(field)} className="text-slate-400 hover:text-red-500"><XCircle size={14} /></button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input flex-1" value={newField} onChange={(e) => setNewField(e.target.value)} placeholder="e.g. passport_photo" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField() } }} />
          <button onClick={addField} className="btn-secondary text-sm">Add</button>
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary"><Save size={15} /> {saving ? 'Saving...' : 'Save Configuration'}</button>
      </div>

      <section className="bb-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={17} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Pending Guest Requests</h2>
          </div>
          <button onClick={load} className="btn-ghost p-2"><RefreshCw size={15} /></button>
        </div>
        <div className="mt-4 space-y-2">
          {requestsError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{requestsError}</div>
          )}
          {pendingRequests.length === 0 && !requestsError && <p className="text-sm text-slate-500">No pending requests.</p>}
          {pendingRequests.map((req) => (
            <div key={req.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{req.request_type}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{req.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{new Date(req.created_at).toLocaleString()}</p>
              </div>
              <ExternalLink size={15} className="text-slate-400" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
