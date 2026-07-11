import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Send, Eye, RefreshCw, Mail, MessageSquare, Smartphone, Variable } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const TRIGGER_EVENTS = [
  'booking_confirmed', 'checkin_done', 'checkout_done',
  'night_audit_close', 'balance_due', 'cancellation', 'no_show'
]

const CHANNELS = ['email', 'whatsapp', 'sms']

const CATEGORIES = ['pre_arrival', 'checkin', 'balance', 'cancellation', 'no_show', 'post_stay', 'custom']

const emptyTemplate = { template_key: '', name: '', subject_template: '', body_template: '', channel: 'email', variables: [], category: 'custom' }
const emptyTrigger = { trigger_event: 'booking_confirmed', template_id: '', delay_minutes: 0, channel: 'email' }

function formatCurrency(amount, currency = 'BWP') {
  return `${currency} ${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2 })}`
}

export default function GuestMessaging() {
  const [templates, setTemplates] = useState([])
  const [triggers, setTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('templates')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [templateForm, setTemplateForm] = useState(emptyTemplate)

  const [showTriggerModal, setShowTriggerModal] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState(null)
  const [triggerForm, setTriggerForm] = useState(emptyTrigger)

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [showRenderModal, setShowRenderModal] = useState(false)
  const [renderTemplateId, setRenderTemplateId] = useState(null)
  const [renderVariables, setRenderVariables] = useState('{}')
  const [renderResult, setRenderResult] = useState(null)

  const [deliveryStatus, setDeliveryStatus] = useState([])
  const [deliveryFilter, setDeliveryFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tpls, trgs] = await Promise.all([
        window.api.guestMessaging.getTemplates(),
        window.api.guestMessaging.getTriggers()
      ])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setTriggers(Array.isArray(trgs) ? trgs : [])
    } catch (err) {
      setError(err?.message || 'Failed to load messaging data')
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

  const loadDeliveryStatus = async (status) => {
    try {
      const data = await window.api.guestMessaging.getDeliveryStatus(status || '')
      setDeliveryStatus(Array.isArray(data) ? data : [])
    } catch {
      setDeliveryStatus([])
    }
  }

  const openAddTemplate = () => { setEditingTemplate(null); setTemplateForm(emptyTemplate); setError(''); setShowTemplateModal(true) }
  const openEditTemplate = (t) => {
    setEditingTemplate(t.id)
    setTemplateForm({
      template_key: t.template_key || '',
      name: t.name || '',
      subject_template: t.subject_template || '',
      body_template: t.body_template || '',
      channel: t.channel || 'email',
      variables: Array.isArray(t.variables) ? t.variables : [],
      category: t.category || 'custom'
    })
    setError('')
    setShowTemplateModal(true)
  }

  const insertVariable = (key) => {
    setTemplateForm((f) => ({ ...f, body_template: f.body_template + '{{' + key + '}}' }))
  }

  const handleSaveTemplate = async (e) => {
    e.preventDefault()
    if (!templateForm.template_key.trim()) { setError('Template key is required'); return }
    if (!templateForm.body_template.trim()) { setError('Body template is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingTemplate) {
        await window.api.guestMessaging.updateTemplate(editingTemplate, templateForm)
      } else {
        await window.api.guestMessaging.createTemplate(templateForm)
      }
      setShowTemplateModal(false)
      load()
      setSuccess(editingTemplate ? 'Template updated.' : 'Template created.')
    } catch (err) {
      setError(err?.message || 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTemplate = (t) => {
    setConfirmDialog({
      title: `Delete "${t.name || t.template_key}"?`,
      message: 'This will also delete any triggers using this template.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await window.api.guestMessaging.deleteTemplate(t.id)
          load()
          setSuccess('Template deleted.')
        } catch (err) {
          setError(err?.message || 'Failed to delete template')
        }
        setConfirmDialog(null)
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  const openAddTrigger = () => { setEditingTrigger(null); setTriggerForm(emptyTrigger); setError(''); setShowTriggerModal(true) }
  const openEditTrigger = (t) => {
    setEditingTrigger(t.id)
    setTriggerForm({
      trigger_event: t.trigger_event || 'booking_confirmed',
      template_id: t.template_id || '',
      delay_minutes: t.delay_minutes || 0,
      channel: t.channel || 'email'
    })
    setError('')
    setShowTriggerModal(true)
  }

  const handleSaveTrigger = async (e) => {
    e.preventDefault()
    if (!triggerForm.template_id) { setError('Template is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingTrigger) {
        await window.api.guestMessaging.updateTrigger(editingTrigger, triggerForm)
      } else {
        await window.api.guestMessaging.createTrigger(triggerForm)
      }
      setShowTriggerModal(false)
      load()
      setSuccess(editingTrigger ? 'Trigger updated.' : 'Trigger created.')
    } catch (err) {
      setError(err?.message || 'Failed to save trigger')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTrigger = (t) => {
    setConfirmDialog({
      title: 'Delete trigger?',
      message: `This removes the ${t.trigger_event} trigger.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await window.api.guestMessaging.deleteTrigger(t.id)
          load()
          setSuccess('Trigger deleted.')
        } catch (err) {
          setError(err?.message || 'Failed to delete trigger')
        }
        setConfirmDialog(null)
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  const handleRender = async () => {
    if (!renderTemplateId) return
    try {
      let vars = {}
      try { vars = JSON.parse(renderVariables) } catch { vars = {} }
      const result = await window.api.guestMessaging.renderTemplate(renderTemplateId, vars)
      setRenderResult(result)
    } catch (err) {
      setRenderResult({ success: false, error: err.message })
    }
  }

  if (loading) {
    return (
      <div className="bb-page flex items-center justify-center">
        <div className="text-sm text-slate-500">Loading guest messaging...</div>
      </div>
    )
  }

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">ENTERPRISE</p>
          <h1 className="bb-page-header-title">Guest Messaging</h1>
          <p className="bb-page-header-subtitle">Message templates, automated triggers, and delivery status</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {['templates', 'triggers', 'delivery', 'render'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t}</button>
        ))}
      </div>

      {tab === 'templates' && (
        <section className="bb-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Message Templates</h2>
            <button onClick={openAddTemplate} className="btn-primary"><Plus size={15} /> Add Template</button>
          </div>
          <div className="mt-4 space-y-2">
            {templates.length === 0 && <p className="text-sm text-slate-500">No templates yet.</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{t.name || t.template_key}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t.active ? 'Active' : 'Inactive'}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.channel}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.category}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-1">{t.subject_template ? `Subject: ${t.subject_template}` : 'No subject'}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setRenderTemplateId(t.id); setRenderVariables('{}'); setRenderResult(null); setShowRenderModal(true) }} className="btn-ghost p-2" title="Test render"><Eye size={15} /></button>
                  <button onClick={() => openEditTemplate(t)} className="btn-ghost p-2" title="Edit"><Pencil size={15} /></button>
                  <button onClick={() => handleDeleteTemplate(t)} className="btn-ghost p-2 text-red-500" title="Delete"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'triggers' && (
        <section className="bb-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Message Triggers</h2>
            <button onClick={openAddTrigger} className="btn-primary"><Plus size={15} /> Add Trigger</button>
          </div>
          <div className="mt-4 space-y-2">
            {triggers.length === 0 && <p className="text-sm text-slate-500">No triggers configured.</p>}
            {triggers.map((t) => {
              const tmpl = templates.find((x) => x.id === t.template_id)
              return (
                <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{t.trigger_event}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t.active ? 'Active' : 'Inactive'}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.channel}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Template: {tmpl?.name || t.template_id} | Delay: {t.delay_minutes} min</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEditTrigger(t)} className="btn-ghost p-2"><Pencil size={15} /></button>
                    <button onClick={() => handleDeleteTrigger(t)} className="btn-ghost p-2 text-red-500"><Trash2 size={15} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'delivery' && (
        <section className="bb-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Delivery Status</h2>
            <div className="flex gap-2">
              <select value={deliveryFilter} onChange={(e) => { setDeliveryFilter(e.target.value); loadDeliveryStatus(e.target.value) }} className="input text-sm">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
              </select>
              <button onClick={() => loadDeliveryStatus(deliveryFilter)} className="btn-ghost p-2"><RefreshCw size={15} /></button>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {deliveryStatus.length === 0 && <p className="text-sm text-slate-500">No messages found.</p>}
            {deliveryStatus.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{m.template_key || 'Manual'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      m.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : m.status === 'sent' ? 'bg-blue-100 text-blue-700' : m.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
                    }`}>{m.status}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.channel}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(m.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'render' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-900">Test Template Render</h2>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Template</label>
              <select value={renderTemplateId || ''} onChange={(e) => setRenderTemplateId(e.target.value)} className="input w-full">
                <option value="">Select template...</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name || t.template_key}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Variables (JSON)</label>
              <textarea className="input w-full font-mono text-xs" rows={5} value={renderVariables} onChange={(e) => setRenderVariables(e.target.value)} placeholder='{"guest_name": "John", "check_in": "2026-07-10"}' />
            </div>
            <button onClick={handleRender} disabled={!renderTemplateId} className="btn-primary"><Eye size={15} /> Render</button>
            {renderResult && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                {renderResult.success === false ? (
                  <p className="text-sm text-red-600">{renderResult.error || 'Render failed'}</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p><span className="font-semibold">Subject:</span> {renderResult.subject || '(no subject)'}</p>
                    <p><span className="font-semibold">Body:</span></p>
                    <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-xs">{renderResult.body}</pre>
                    <p className="text-xs text-slate-500">Channel: {renderResult.channel} | Key: {renderResult.template_key}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {showTemplateModal && (
        <Modal title={editingTemplate ? 'Edit Template' : 'Add Template'} onClose={() => setShowTemplateModal(false)}>
          <form onSubmit={handleSaveTemplate} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Template Key *</label>
              <input className="input w-full" value={templateForm.template_key} onChange={(e) => setTemplateForm((f) => ({ ...f, template_key: e.target.value }))} placeholder="pre_arrival_reminder" disabled={!!editingTemplate} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Name</label>
              <input className="input w-full" value={templateForm.name} onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pre-arrival Reminder" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Channel</label>
              <select value={templateForm.channel} onChange={(e) => setTemplateForm((f) => ({ ...f, channel: e.target.value }))} className="input w-full">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Category</label>
              <select value={templateForm.category} onChange={(e) => setTemplateForm((f) => ({ ...f, category: e.target.value }))} className="input w-full">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Subject Template</label>
              <input className="input w-full" value={templateForm.subject_template} onChange={(e) => setTemplateForm((f) => ({ ...f, subject_template: e.target.value }))} placeholder="Your stay at {{property_name}} starts soon" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Body Template *</label>
              <textarea className="input w-full" rows={6} value={templateForm.body_template} onChange={(e) => setTemplateForm((f) => ({ ...f, body_template: e.target.value }))} placeholder="Dear {{guest_name}},..." />
              <div className="mt-2">
                <p className="text-xs font-semibold text-slate-500">Insert variable:</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {['guest_name', 'guest_email', 'check_in', 'check_out', 'room_number', 'room_type', 'property_name', 'total_amount', 'balance', 'booking_reference'].map((v) => (
                    <button key={v} type="button" onClick={() => insertVariable(v)} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-mono text-slate-600 hover:bg-slate-100">{'{{' + v + '}}'}</button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Allowed Variables (JSON array)</label>
              <input className="input w-full font-mono text-xs" value={JSON.stringify(templateForm.variables)} onChange={(e) => {
                try { setTemplateForm((f) => ({ ...f, variables: JSON.parse(e.target.value) })) } catch {}
              }} placeholder='["guest_name", "check_in"]' />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowTemplateModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : (editingTemplate ? 'Update' : 'Create')}</button>
            </div>
          </form>
        </Modal>
      )}

      {showTriggerModal && (
        <Modal title={editingTrigger ? 'Edit Trigger' : 'Add Trigger'} onClose={() => setShowTriggerModal(false)}>
          <form onSubmit={handleSaveTrigger} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Trigger Event *</label>
              <select value={triggerForm.trigger_event} onChange={(e) => setTriggerForm((f) => ({ ...f, trigger_event: e.target.value }))} className="input w-full">
                {TRIGGER_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Template *</label>
              <select value={triggerForm.template_id} onChange={(e) => setTriggerForm((f) => ({ ...f, template_id: e.target.value }))} className="input w-full">
                <option value="">Select template...</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name || t.template_key}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Channel</label>
              <select value={triggerForm.channel} onChange={(e) => setTriggerForm((f) => ({ ...f, channel: e.target.value }))} className="input w-full">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Delay (minutes)</label>
              <input className="input w-full" type="number" min="0" value={triggerForm.delay_minutes} onChange={(e) => setTriggerForm((f) => ({ ...f, delay_minutes: Number(e.target.value) || 0 }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowTriggerModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : (editingTrigger ? 'Update' : 'Create')}</button>
            </div>
          </form>
        </Modal>
      )}

      {showRenderModal && (
        <Modal title="Test Template Render" onClose={() => setShowRenderModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Variables (JSON)</label>
              <textarea className="input w-full font-mono text-xs" rows={5} value={renderVariables} onChange={(e) => setRenderVariables(e.target.value)} />
            </div>
            <button onClick={handleRender} className="btn-primary"><Eye size={15} /> Render</button>
            {renderResult && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                {renderResult.success === false ? (
                  <p className="text-sm text-red-600">{renderResult.error}</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p><span className="font-semibold">Subject:</span> {renderResult.subject}</p>
                    <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-xs">{renderResult.body}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  )
}
