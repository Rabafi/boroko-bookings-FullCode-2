import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Layers,
  Users,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  X
} from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useSettings } from '../app-context'

const emptyForm = {
  name: '',
  description: '',
  rate_per_night: '',
  base_rate: '',
  weekend_rate: '',
  peak_rate: '',
  max_occupancy: '2',
  amenities: []
}

const AMENITY_OPTIONS = [
  'WiFi', 'TV', 'Air Conditioning', 'Heating', 'Mini Bar',
  'Balcony', 'Sea View', 'Kitchen', 'Jacuzzi', 'Room Service'
]

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function RoomTypes({ embedded = false }) {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [roomTypes, setRoomTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await window.api.roomTypes.getAll()
      setRoomTypes(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load room types:', err)
      setLoadError(err?.message || 'Failed to load room types. The database table may not exist yet.')
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

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (rt) => {
    setEditing(rt.id)
    setForm({
      name: rt.name || '',
      description: rt.description || '',
      rate_per_night: rt.rate_per_night || '',
      base_rate: rt.base_rate || '',
      weekend_rate: rt.weekend_rate || '',
      peak_rate: rt.peak_rate || '',
      max_occupancy: rt.max_occupancy || '2',
      amenities: Array.isArray(rt.amenities) ? rt.amenities : []
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Room type name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        rate_per_night: Number(form.rate_per_night) || 0,
        base_rate: Number(form.base_rate) || Number(form.rate_per_night) || 0,
        weekend_rate: Number(form.weekend_rate) || 0,
        peak_rate: Number(form.peak_rate) || 0,
        max_occupancy: Number(form.max_occupancy) || 2
      }
      let res
      if (editing) {
        res = await window.api.roomTypes.update(editing, payload)
      } else {
        res = await window.api.roomTypes.create(payload)
      }
      if (res?.success === false) {
        setError(res.error || 'Failed to save room type')
      } else {
        setShowModal(false)
        load()
        setSuccess(editing ? 'Room type updated.' : 'Room type added.')
      }
    } catch (err) {
      setError(err?.message || 'Failed to save room type')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (rt) => {
    setConfirmDialog({
      title: `Delete "${rt.name}"?`,
      message: 'This permanently removes the room type. Existing rooms using this type will keep their current room_type value.',
      confirmLabel: 'Delete room type',
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await window.api.roomTypes.delete(rt.id)
          load()
          setSuccess('Room type deleted.')
        } catch (err) {
          console.error('Failed to delete room type:', err)
        }
      }
    })
  }

  const toggleAmenity = (amenity) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity]
    }))
  }

  if (loading) {
    return (
      <div className={embedded ? '' : 'bb-page'}>
        {!embedded && (
          <div className="bb-page-header">
            <p className="bb-section-kicker">HOTEL CONFIGURATION</p>
            <h1 className="bb-page-header-title">Room Types</h1>
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
            <h1 className="bb-page-header-title">Room Types</h1>
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
            <h1 className="bb-page-header-title">Room Types</h1>
            <p className="bb-page-header-subtitle">{roomTypes.length} room type{roomTypes.length !== 1 ? 's' : ''} configured</p>
          </div>
          <button onClick={openAdd} className="inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1e5c47]">
            <Plus size={16} /> Add Room Type
          </button>
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {success}
        </div>
      )}

      {roomTypes.length === 0 ? (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <Layers size={40} className="mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No room types yet</p>
          <p className="mt-1 text-xs text-slate-400">Add room types to categorize your rooms by category, rate, and capacity.</p>
          <button onClick={openAdd} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e5c47]">
            <Plus size={14} /> Add First Room Type
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roomTypes.map((rt) => (
            <div key={rt.id} className="bb-card group relative overflow-hidden p-5 transition-all hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-slate-800 truncate">{rt.name}</h3>
                  {rt.description && (
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{rt.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(rt)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(rt)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <DollarSign size={10} /> Rate / Night
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{formatCurrency(rt.rate_per_night || rt.base_rate, currency)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <Users size={10} /> Max Guests
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-slate-800">{rt.max_occupancy || 2}</p>
                </div>
              </div>

              {(Number(rt.weekend_rate) > 0 || Number(rt.peak_rate) > 0) && (
                <div className="mt-2 flex gap-2 text-[10px] text-slate-500">
                  {Number(rt.weekend_rate) > 0 && <span>Weekend: {formatCurrency(rt.weekend_rate, currency)}</span>}
                  {Number(rt.peak_rate) > 0 && <span>Peak: {formatCurrency(rt.peak_rate, currency)}</span>}
                </div>
              )}

              {Array.isArray(rt.amenities) && rt.amenities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {rt.amenities.slice(0, 4).map((a) => (
                    <span key={a} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-100">
                      {a}
                    </span>
                  ))}
                  {rt.amenities.length > 4 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      +{rt.amenities.length - 4} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Room Type' : 'Add Room Type'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                placeholder="e.g. Deluxe Suite"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                rows={2}
                placeholder="Brief description of this room type"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Base Rate ({currency})
                </label>
                <input
                  type="number"
                  value={form.rate_per_night}
                  onChange={(e) => setForm({ ...form, rate_per_night: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Max Occupancy
                </label>
                <input
                  type="number"
                  value={form.max_occupancy}
                  onChange={(e) => setForm({ ...form, max_occupancy: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                  min="1"
                  max="20"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Weekend Rate ({currency})
                </label>
                <input
                  type="number"
                  value={form.weekend_rate}
                  onChange={(e) => setForm({ ...form, weekend_rate: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Peak Rate ({currency})
                </label>
                <input
                  type="number"
                  value={form.peak_rate}
                  onChange={(e) => setForm({ ...form, peak_rate: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#174c3a] focus:ring-2 focus:ring-[#174c3a]/10"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Amenities
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AMENITY_OPTIONS.map((amenity) => (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => toggleAmenity(amenity)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      form.amenities.includes(amenity)
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {amenity}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-xl bg-[#174c3a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1e5c47] disabled:opacity-50"
              >
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Room Type'}
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
