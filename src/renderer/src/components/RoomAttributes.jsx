import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Grid3X3 } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const emptyForm = { attribute_key: '', label: '', attribute_type: 'text', room_type_id: '', options: '', sort_order: 0 }

export default function RoomAttributes({ embedded = false }) {
  const [attributes, setAttributes] = useState([])
  const [roomTypes, setRoomTypes] = useState([])
  const [filterTypeId, setFilterTypeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [attrs, rtData] = await Promise.all([
        window.api.roomAttributes.getAll().catch(() => []),
        window.api.roomTypes.getAll().catch(() => [])
      ])
      setAttributes(Array.isArray(attrs) ? attrs : [])
      setRoomTypes(Array.isArray(rtData) ? rtData : [])
    } catch (err) {
      setError(err?.message || 'Failed to load room attributes')
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

  const getRoomTypeName = (id) => {
    const rt = roomTypes.find(r => String(r.id) === String(id))
    return rt ? rt.name : '—'
  }

  const filtered = filterTypeId
    ? attributes.filter(a => String(a.room_type_id) === String(filterTypeId))
    : attributes

  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (attr) => {
    setEditingId(attr.id)
    setForm({
      attribute_key: attr.attribute_key || '',
      label: attr.label || '',
      attribute_type: attr.attribute_type || 'text',
      room_type_id: attr.room_type_id ? String(attr.room_type_id) : '',
      options: Array.isArray(attr.options) ? attr.options.join('\n') : (attr.options || ''),
      sort_order: attr.sort_order ?? 0
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.attribute_key || !form.label) { setError('Attribute key and label are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        attribute_key: form.attribute_key,
        label: form.label,
        attribute_type: form.attribute_type,
        room_type_id: form.room_type_id || null,
        options: (form.attribute_type === 'select' || form.attribute_type === 'multiselect')
          ? form.options.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        sort_order: Number(form.sort_order) || 0
      }
      if (editingId) {
        await window.api.roomAttributes.update(editingId, payload)
        setSuccess('Attribute updated')
      } else {
        await window.api.roomAttributes.create(payload)
        setSuccess('Attribute created')
      }
      setShowModal(false)
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save attribute')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (attrId) => {
    setConfirmDelete({
      message: 'Delete this room attribute?',
      onConfirm: async () => {
        try {
          await window.api.roomAttributes.delete(attrId)
          setSuccess('Attribute deleted')
          load()
        } catch (err) {
          setError(err?.message || 'Failed to delete attribute')
        }
        setConfirmDelete(null)
      }
    })
  }

  const typeBadge = (type) => {
    const colors = {
      text: 'bg-blue-100 text-blue-800',
      boolean: 'bg-purple-100 text-purple-800',
      number: 'bg-amber-100 text-amber-800',
      select: 'bg-green-100 text-green-800',
      multiselect: 'bg-teal-100 text-teal-800'
    }
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type] || 'bg-gray-100 text-gray-600'}`}>{type}</span>
  }

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>

  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Room Attributes</h1>
          <button onClick={openAdd} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"><Plus className="w-4 h-4" />Add Attribute</button>
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><Grid3X3 className="w-4 h-4" />{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><Grid3X3 className="w-4 h-4" />{success}</div>}

      <div className="mb-4">
        <label className="bb-label block text-sm font-medium mb-1">Filter by Room Type</label>
        <select value={filterTypeId} onChange={e => setFilterTypeId(e.target.value)} className="bb-input w-full max-w-xs border rounded-lg px-3 py-2 text-sm">
          <option value="">All Room Types</option>
          {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
        </select>
      </div>

      <div className="bb-card overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">Attributes ({filtered.length})</h3>
          <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <div className="p-4">
          {filtered.length === 0 ? (
            <div className="text-gray-500 text-sm">No attributes found</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500"><th className="pb-2">Key</th><th className="pb-2">Label</th><th className="pb-2">Type</th><th className="pb-2">Room Type</th><th className="pb-2">Sort</th><th className="pb-2">Actions</th></tr></thead>
              <tbody>
                {filtered.map(attr => (
                  <tr key={attr.id} className="border-t">
                    <td className="py-2 font-mono text-xs">{attr.attribute_key}</td>
                    <td className="py-2">{attr.label}</td>
                    <td className="py-2">{typeBadge(attr.attribute_type)}</td>
                    <td className="py-2 text-gray-600">{getRoomTypeName(attr.room_type_id)}</td>
                    <td className="py-2 text-gray-500">{attr.sort_order ?? 0}</td>
                    <td className="py-2 flex gap-1">
                      <button onClick={() => openEdit(attr)} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(attr.id)} className="p-1 hover:bg-red-100 rounded text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <Modal title={editingId ? 'Edit Attribute' : 'Add Attribute'} onClose={() => setShowModal(false)} size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="bb-label block text-sm font-medium mb-1">Attribute Key</label>
                <input value={form.attribute_key} onChange={e => setForm({ ...form, attribute_key: e.target.value })} className="bb-input w-full border rounded-lg px-3 py-2 text-sm" placeholder="has_balcony" required />
              </div>
              <div>
                <label className="bb-label block text-sm font-medium mb-1">Label</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="bb-input w-full border rounded-lg px-3 py-2 text-sm" placeholder="Has Balcony" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="bb-label block text-sm font-medium mb-1">Attribute Type</label>
                <select value={form.attribute_type} onChange={e => setForm({ ...form, attribute_type: e.target.value })} className="bb-input w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="text">Text</option>
                  <option value="boolean">Boolean</option>
                  <option value="number">Number</option>
                  <option value="select">Select</option>
                  <option value="multiselect">Multi Select</option>
                </select>
              </div>
              <div>
                <label className="bb-label block text-sm font-medium mb-1">Room Type</label>
                <select value={form.room_type_id} onChange={e => setForm({ ...form, room_type_id: e.target.value })} className="bb-input w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">All Room Types</option>
                  {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="bb-label block text-sm font-medium mb-1">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} className="bb-input w-full max-w-xs border rounded-lg px-3 py-2 text-sm" />
            </div>
            {(form.attribute_type === 'select' || form.attribute_type === 'multiselect') && (
              <div>
                <label className="bb-label block text-sm font-medium mb-1">Options (one per line)</label>
                <textarea value={form.options} onChange={e => setForm({ ...form, options: e.target.value })} className="bb-input w-full border rounded-lg px-3 py-2 text-sm" rows={4} placeholder="Option 1&#10;Option 2&#10;Option 3" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && <ConfirmDialog {...confirmDelete} onCancel={() => setConfirmDelete(null)} />}
    </div>
  )
}
