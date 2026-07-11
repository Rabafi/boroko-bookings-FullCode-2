import { useState, useEffect } from 'react'
import { ClipboardCheck, ClipboardList, Settings, CheckCircle, XCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { useSettings } from '../app-context'

function StepItem({ step, onComplete, onReset, loading }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${step.completed ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-3">
        {step.completed ? <CheckCircle size={18} className="text-green-600" /> : <ClipboardCheck size={18} className="text-gray-400" />}
        <div>
          <p className={`text-sm font-medium ${step.completed ? 'text-green-700' : 'text-gray-700'}`}>{step.step_label}</p>
          <p className="text-xs text-gray-400">{step.step_key}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {step.completed ? (
          <button onClick={() => onReset(step.id)} disabled={loading} className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1">
            <RotateCcw size={12} /> Reset
          </button>
        ) : (
          <button onClick={() => onComplete(step.id)} disabled={loading} className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1 font-medium">
            <CheckCircle size={12} /> Complete
          </button>
        )}
      </div>
    </div>
  )
}

function ConfigPanel({ config, onUpdate, loading }) {
  const [requiredSteps, setRequiredSteps] = useState('')
  const [optionalSteps, setOptionalSteps] = useState('')

  useEffect(() => {
    if (config) {
      setRequiredSteps(Array.isArray(config.required_steps) ? config.required_steps.join(', ') : '')
      setOptionalSteps(Array.isArray(config.optional_steps) ? config.optional_steps.join(', ') : '')
    }
  }, [config])

  const handleSave = () => {
    onUpdate({
      ...config,
      required_steps: requiredSteps.split(',').map(s => s.trim()).filter(Boolean),
      optional_steps: optionalSteps.split(',').map(s => s.trim()).filter(Boolean)
    })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><Settings size={16} /> Check-in Configuration</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 font-medium">Required Steps (comma-separated)</label>
          <input type="text" value={requiredSteps} onChange={e => setRequiredSteps(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" placeholder="id_capture, registration_card, deposit_check" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium">Optional Steps (comma-separated)</label>
          <input type="text" value={optionalSteps} onChange={e => setOptionalSteps(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" placeholder="signature, key_handoff" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_id_capture !== false} onChange={e => onUpdate({ ...config, require_id_capture: e.target.checked })} className="rounded" />
            ID Capture
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_registration_card !== false} onChange={e => onUpdate({ ...config, require_registration_card: e.target.checked })} className="rounded" />
            Registration Card
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_deposit_check !== false} onChange={e => onUpdate({ ...config, require_deposit_check: e.target.checked })} className="rounded" />
            Deposit Check
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_room_assignment !== false} onChange={e => onUpdate({ ...config, require_room_assignment: e.target.checked })} className="rounded" />
            Room Assignment
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_signature === true} onChange={e => onUpdate({ ...config, require_signature: e.target.checked })} className="rounded" />
            Signature
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={config?.require_key_handoff === true} onChange={e => onUpdate({ ...config, require_key_handoff: e.target.checked })} className="rounded" />
            Key Handoff
          </label>
        </div>
        <button onClick={handleSave} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
          {loading ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  )
}

export default function CheckinWorkflow() {
  const { settings } = useSettings()
  const [tab, setTab] = useState('checkin')
  const [checklist, setChecklist] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [bookingId, setBookingId] = useState('')

  const loadChecklist = async () => {
    if (!bookingId.trim()) { setError('Please enter a booking ID'); return }
    setLoading(true); setError(''); setSuccess('')
    try {
      const fn = tab === 'checkin' ? window.api.checkinWorkflow.getChecklist : window.api.checkoutWorkflow.getChecklist
      const result = await fn(bookingId.trim())
      setChecklist(result)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadConfig = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.checkinWorkflow.getConfig()
      setConfig(result?.config || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadConfig() }, [])

  const handleCompleteStep = async (stepId) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const fn = tab === 'checkin' ? window.api.checkinWorkflow.completeStep : window.api.checkoutWorkflow.completeStep
      await fn(stepId, null, null)
      setSuccess('Step completed')
      loadChecklist()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleResetStep = async (stepId) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const fn = tab === 'checkin' ? window.api.checkinWorkflow.resetStep : window.api.checkoutWorkflow.resetStep
      await fn(stepId)
      setSuccess('Step reset')
      loadChecklist()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleUpdateConfig = async (newConfig) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      await window.api.checkinWorkflow.updateConfig(newConfig)
      setSuccess('Configuration saved')
      loadConfig()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Check-in / Check-out Workflow</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage structured check-in and check-out checklists</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>}
      {success && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">&#10003; {success}</div>}

      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('checkin')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'checkin' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <ClipboardCheck size={14} className="inline mr-1" /> Check-in
        </button>
        <button onClick={() => setTab('checkout')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'checkout' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <ClipboardList size={14} className="inline mr-1" /> Check-out
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-700 mb-4">Booking Checklist</h3>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                value={bookingId}
                onChange={e => setBookingId(e.target.value)}
                placeholder="Enter booking ID..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={loadChecklist} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <ClipboardCheck size={14} />} Load
              </button>
            </div>
            {checklist && (
              <div className="space-y-2">
                {(checklist.items || []).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No checklist items found for this booking. Create steps via configuration.</p>
                ) : (
                  checklist.items.map(step => (
                    <StepItem key={step.id} step={step} onComplete={handleCompleteStep} onReset={handleResetStep} loading={loading} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <ConfigPanel config={config} onUpdate={handleUpdateConfig} loading={loading} />
        </div>
      </div>
    </div>
  )
}
