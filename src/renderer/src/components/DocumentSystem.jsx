import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Check, AlertTriangle, FileText, Eye, Send } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

/** Must match document_templates.check + documentSystem.HOTEL_DOCUMENT_TYPES */
const DOCUMENT_TYPES = [
  'folio',
  'invoice',
  'registration_card',
  'statement',
  'receipt',
  'contract',
  'cancellation_note'
]

const emptyTemplate = { template_key: '', name: '', document_type: 'folio', numbering_prefix: '' }

function assertRpcSuccess(result, fallbackMessage) {
  if (result == null) {
    throw new Error(fallbackMessage || 'Document operation returned no result')
  }
  if (result.success === false) {
    throw new Error(result.error || fallbackMessage || 'Document operation failed')
  }
  return result
}

export default function DocumentSystem({ templatesOnly = false } = {}) {
  const [templates, setTemplates] = useState([])
  const [dashboard, setDashboard] = useState({ recent_documents: [] })
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('templates')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyTemplate)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishingId, setPublishingId] = useState(null)
  const [renderSubjectType, setRenderSubjectType] = useState('booking')
  const [renderSubjectId, setRenderSubjectId] = useState('')
  const [renderTemplateKey, setRenderTemplateKey] = useState('')
  const [renderResult, setRenderResult] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tplData, dashData] = await Promise.all([
        window.api.documentSystem.getTemplates().catch(() => []),
        window.api.documentSystem.getDocumentDashboard().catch(() => ({ recent_documents: [] }))
      ])
      setTemplates(Array.isArray(tplData) ? tplData : [])
      setDashboard(dashData && typeof dashData === 'object' ? dashData : { recent_documents: [] })
    } catch (err) {
      setError(err?.message || 'Failed to load document system')
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

  const openAdd = () => { setEditing(null); setForm(emptyTemplate); setError(''); setShowModal(true) }
  const openEdit = (t) => {
    setEditing(t.id)
    setForm({
      template_key: t.template_key || '',
      name: t.name || '',
      document_type: t.document_type || 'folio',
      numbering_prefix: t.numbering_prefix || ''
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.template_key || !form.name) {
      setError('Template key and name are required')
      return
    }
    if (!DOCUMENT_TYPES.includes(form.document_type)) {
      setError(`Unsupported document type. Allowed: ${DOCUMENT_TYPES.join(', ')}`)
      return
    }
    setSaving(true)
    setError('')
    try {
      let result
      if (editing) {
        result = await window.api.documentSystem.updateTemplate(editing, form)
      } else {
        result = await window.api.documentSystem.createTemplate(
          form.template_key,
          form.name,
          form.document_type,
          {},
          [],
          {},
          form.numbering_prefix
        )
      }
      assertRpcSuccess(result, editing ? 'Failed to update template' : 'Failed to create template')
      setShowModal(false)
      setSuccess(editing ? 'Template updated' : 'Template created')
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (templateId) => {
    setConfirmDialog({
      message: 'Delete this template?',
      onConfirm: async () => {
        try {
          const result = await window.api.documentSystem.deleteTemplate(templateId)
          assertRpcSuccess(result, 'Failed to delete template')
          setSuccess('Template deleted')
          await load()
        } catch (err) {
          setError(err?.message || 'Failed to delete template')
        }
        setConfirmDialog(null)
      }
    })
  }

  const handleRender = async () => {
    if (!renderTemplateKey || !renderSubjectType || !renderSubjectId) {
      setError('All render fields are required')
      return
    }
    setError('')
    setRenderResult(null)
    try {
      const result = await window.api.documentSystem.renderDocument(
        renderTemplateKey,
        renderSubjectType,
        renderSubjectId
      )
      assertRpcSuccess(result, 'Failed to render document')
      if (!result.document_id) {
        throw new Error('Render did not return a document id from the server')
      }
      setRenderResult(result)
      setSuccess('Document draft rendered on server')
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to render document')
    }
  }

  const handlePublish = async (documentId) => {
    if (!documentId) return
    setError('')
    setPublishingId(documentId)
    try {
      const result = await window.api.documentSystem.publishDocument(documentId)
      assertRpcSuccess(result, 'Failed to publish document')
      setSuccess('Document published')
      await load()
      if (renderSubjectType && renderSubjectId) {
        try {
          const data = await window.api.documentSystem.getDocumentHistory(renderSubjectType, renderSubjectId)
          setHistory(Array.isArray(data) ? data : [])
        } catch {
          /* history refresh is best-effort */
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to publish document')
    } finally {
      setPublishingId(null)
    }
  }

  const handleLoadHistory = async () => {
    if (!renderSubjectType || !renderSubjectId) {
      setError('Subject type and ID required')
      return
    }
    try {
      const data = await window.api.documentSystem.getDocumentHistory(renderSubjectType, renderSubjectId)
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Failed to load history')
    }
  }

  const TabButton = ({ tab, label }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin w-6 h-6 text-gray-400" />
      </div>
    )
  }

  const effectiveTab = templatesOnly ? 'templates' : activeTab
  const recentDocuments = Array.isArray(dashboard?.recent_documents) ? dashboard.recent_documents : []

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{templatesOnly ? 'Document Templates' : 'Document System'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Templates, draft render, and publish use server RPCs. Publish requires an online connection.
          </p>
        </div>
        {!templatesOnly && (
          <div className="flex gap-2">
            <TabButton tab="templates" label="Templates" />
            <TabButton tab="render" label="Generate" />
            <TabButton tab="history" label="History" />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
          <Check className="w-4 h-4" />
          {success}
        </div>
      )}

      {effectiveTab === 'templates' && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Document Templates</h3>
            <button
              onClick={openAdd}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add Template
            </button>
          </div>
          <div className="p-4">
            {templates.length === 0 ? (
              <div className="text-gray-500 text-sm">No templates defined</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2">Key</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Numbering</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{t.template_key}</td>
                      <td>{t.name}</td>
                      <td>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                          {t.document_type}
                        </span>
                      </td>
                      <td>{t.numbering_prefix || '-'}</td>
                      <td className="flex gap-1">
                        <button onClick={() => openEdit(t)} className="p-1 hover:bg-gray-100 rounded">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {effectiveTab === 'render' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border p-4 space-y-4">
            <h3 className="font-semibold">Render Document Draft</h3>
            <p className="text-xs text-slate-500">
              Creates a draft via <code>render_document</code>. Publishing is online-only via{' '}
              <code>publish_document</code>.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Template</label>
              <select
                value={renderTemplateKey}
                onChange={(e) => setRenderTemplateKey(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.template_key}>
                    {t.name} ({t.document_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subject Type</label>
              <select
                value={renderSubjectType}
                onChange={(e) => setRenderSubjectType(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="booking">Booking</option>
                <option value="folio">Folio</option>
                <option value="customer">Customer</option>
                <option value="quotation">Quotation</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subject ID</label>
              <input
                value={renderSubjectId}
                onChange={(e) => setRenderSubjectId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="UUID..."
              />
            </div>
            <button
              onClick={handleRender}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"
            >
              <FileText className="w-4 h-4" />
              Generate Draft
            </button>
            {renderResult && (
              <div className="p-3 bg-green-50 border rounded-lg text-sm">
                <div className="font-medium text-green-800">Server draft created</div>
                <div className="text-xs text-green-700 mt-1">Number: {renderResult.document_number}</div>
                <div className="text-xs text-green-700">ID: {renderResult.document_id}</div>
                {renderResult.document_id && (
                  <button
                    onClick={() => handlePublish(renderResult.document_id)}
                    disabled={publishingId === renderResult.document_id}
                    className="mt-2 text-xs text-green-800 underline disabled:opacity-50"
                  >
                    Publish this draft
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border p-4 space-y-4">
            <h3 className="font-semibold">Recent Documents</h3>
            {recentDocuments.length === 0 ? (
              <div className="text-gray-500 text-sm">No documents yet</div>
            ) : (
              <div className="space-y-2">
                {recentDocuments.slice(0, 10).map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-2 border rounded text-sm">
                    <div>
                      <div className="font-medium">{d.document_number || d.document_type}</div>
                      <div className="text-xs text-gray-500">
                        {d.document_type} | {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          d.status === 'final'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {d.status}
                      </span>
                      {d.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(d.id)}
                          disabled={publishingId === d.id}
                          className="p-1 hover:bg-green-100 rounded text-green-600 disabled:opacity-50"
                          title="Publish (online only)"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {effectiveTab === 'history' && (
        <div className="bg-white rounded-xl border p-4 space-y-4">
          <h3 className="font-semibold">Document History</h3>
          <div className="flex gap-3">
            <select
              value={renderSubjectType}
              onChange={(e) => setRenderSubjectType(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="booking">Booking</option>
              <option value="folio">Folio</option>
              <option value="customer">Customer</option>
              <option value="quotation">Quotation</option>
            </select>
            <input
              value={renderSubjectId}
              onChange={(e) => setRenderSubjectId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm flex-1"
              placeholder="Subject UUID..."
            />
            <button
              onClick={handleLoadHistory}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"
            >
              <Eye className="w-4 h-4" />
              Load
            </button>
          </div>
          {history.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-2">Number</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="py-2">{d.document_number}</td>
                    <td>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                        {d.document_type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          d.status === 'final'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="text-gray-500 text-xs">
                      {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      {d.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(d.id)}
                          disabled={publishingId === d.id}
                          className="text-green-600 hover:text-green-800 text-xs disabled:opacity-50"
                        >
                          Publish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-gray-500 text-sm">Load history for a subject</div>
          )}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Template' : 'Add Template'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Template Key</label>
              <input
                value={form.template_key}
                onChange={(e) => setForm({ ...form, template_key: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="folio_standard"
                required
                disabled={!!editing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Standard Folio"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Document Type</label>
              <select
                value={form.document_type}
                onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                disabled={!!editing}
              >
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {dt.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Numbering Prefix</label>
              <input
                value={form.numbering_prefix}
                onChange={(e) => setForm({ ...form, numbering_prefix: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="FOLIO"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}
