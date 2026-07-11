import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, Layers, MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'

const SECTION_TYPES = [
  { value: 'building', label: 'Building' },
  { value: 'wing', label: 'Wing' },
  { value: 'floor', label: 'Floor' },
  { value: 'section', label: 'Section' }
]

const emptyForm = {
  name: '',
  code: '',
  section_type: 'floor',
  parent_id: '',
  floor_number: '',
  description: '',
  sort_order: '0'
}

function sectionTypeLabel(value) {
  return SECTION_TYPES.find((type) => type.value === value)?.label || 'Section'
}

export default function FloorsSections({ embedded = false }) {
  const [sections, setSections] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [sectionData, roomData] = await Promise.all([
        window.api.floorSections.getAll(),
        window.api.rooms.getAll().catch(() => [])
      ])
      setSections(Array.isArray(sectionData) ? sectionData : [])
      setRooms(Array.isArray(roomData) ? roomData : [])
    } catch (err) {
      console.error('Failed to load floors and sections:', err)
      setLoadError(err?.message || 'Failed to load floors and sections.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return undefined
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const activeSections = useMemo(
    () => sections.filter((section) => section.active !== false),
    [sections]
  )

  const roomCounts = useMemo(() => {
    const counts = new Map()
    rooms.forEach((room) => {
      if (!room.floor_section_id) return
      counts.set(room.floor_section_id, (counts.get(room.floor_section_id) || 0) + 1)
    })
    return counts
  }, [rooms])

  const parentOptions = useMemo(
    () => activeSections.filter((section) => section.id !== editing),
    [activeSections, editing]
  )

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (section) => {
    setEditing(section.id)
    setForm({
      name: section.name || '',
      code: section.code || '',
      section_type: section.section_type || 'floor',
      parent_id: section.parent_id || '',
      floor_number: section.floor_number ?? '',
      description: section.description || '',
      sort_order: String(section.sort_order || 0)
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')
    const payload = {
      ...form,
      name: form.name.trim(),
      code: form.code.trim(),
      parent_id: form.parent_id || null,
      floor_number: form.floor_number === '' ? null : Number(form.floor_number),
      sort_order: Number(form.sort_order) || 0
    }

    try {
      const result = editing
        ? await window.api.floorSections.update(editing, payload)
        : await window.api.floorSections.create(payload)
      if (result?.success === false) {
        setError(result.error || 'Failed to save floor or section')
      } else {
        setShowModal(false)
        await load()
        setSuccess(editing ? 'Floor or section updated.' : 'Floor or section added.')
      }
    } catch (err) {
      setError(err?.message || 'Failed to save floor or section')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (section) => {
    setConfirmDialog({
      title: `Delete "${section.name}"?`,
      message: 'If rooms or child sections still use this item, it will be deactivated instead of permanently removed.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmDialog(null)
        const result = await window.api.floorSections.delete(section.id)
        if (result?.success === false) {
          setError(result.error || 'Failed to delete floor or section')
          return
        }
        await load()
        setSuccess(result?.soft_deleted ? 'Floor or section deactivated.' : 'Floor or section deleted.')
      }
    })
  }

  if (loading) {
    return (
      <div className={embedded ? '' : 'bb-page'}>
        {!embedded && (
          <div className="bb-page-header">
            <p className="bb-section-kicker">HOTEL CONFIGURATION</p>
            <h1 className="bb-page-header-title">Floors & Sections</h1>
          </div>
        )}
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className={embedded ? '' : 'bb-page'}>
        {!embedded && (
          <div className="bb-page-header">
            <p className="bb-section-kicker">HOTEL CONFIGURATION</p>
            <h1 className="bb-page-header-title">Floors & Sections</h1>
          </div>
        )}
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="mb-3 text-red-400" />
          <p className="text-sm font-semibold text-red-600">{loadError}</p>
          <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'bb-page'}>
      {!embedded && (
        <div className="bb-page-header">
          <div>
            <p className="bb-section-kicker">HOTEL CONFIGURATION</p>
            <h1 className="bb-page-header-title">Floors & Sections</h1>
            <p className="bb-page-header-subtitle">{activeSections.length} active location{activeSections.length !== 1 ? 's' : ''} for room organization</p>
          </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1e5c47]">
          <Plus size={16} /> Add Location
        </button>
      </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {success}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {activeSections.length === 0 ? (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <Building2 size={40} className="mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No floors or sections yet</p>
          <p className="mt-1 text-xs text-slate-400">Add buildings, wings, floors, or sections before assigning rooms.</p>
          <button onClick={openAdd} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e5c47]">
            <Plus size={14} /> Add First Location
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeSections.map((section) => (
            <div key={section.id} className="bb-card group p-5 transition-all hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-[#174c3a]" />
                    <h3 className="truncate text-base font-bold text-slate-800">{section.name}</h3>
                  </div>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {sectionTypeLabel(section.section_type)}{section.code ? ` · ${section.code}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => openEdit(section)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(section)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {section.description && (
                <p className="mt-3 line-clamp-2 text-xs text-slate-500">{section.description}</p>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
                    <Layers size={10} /> Rooms
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{roomCounts.get(section.id) || 0}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Sort</div>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{section.sort_order || 0}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Floor or Section' : 'Add Floor or Section'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. First Floor" required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Code</label>
                <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. F1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Type</label>
                <select className="input" value={form.section_type} onChange={(e) => setForm({ ...form, section_type: e.target.value })}>
                  {SECTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Parent</label>
                <select className="input" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                  <option value="">None</option>
                  {parentOptions.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Floor Number</label>
                <input className="input" type="number" value={form.floor_number} onChange={(e) => setForm({ ...form, floor_number: e.target.value })} placeholder="Optional" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Sort Order</label>
                <input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Description</label>
              <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional operational notes" />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e5c47] disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Location'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={confirmDialog?.onConfirm}
      />
    </div>
  )
}
