import { useEffect, useState, useRef } from 'react'
import { Plus, Pencil, Trash2, BedDouble, Image, X } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { Modal } from './shared/Modal'

const ROOM_TYPES = ['Single', 'Double', 'Twin', 'Suite', 'Family', 'Deluxe']
const STATUSES = ['available', 'occupied', 'maintenance', 'reserved']

const emptyForm = {
  room_number: '',
  room_type: 'Double',
  rate_per_night: '',
  max_occupancy: 2,
  status: 'available',
  description: '',
  photo: ''
}

export default function Rooms() {
  const [rooms, setRooms] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const photoInputRef = useRef(null)

  const processRoomPhoto = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const MAX = 800
        const canvas = document.createElement('canvas')
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        setForm((f) => ({ ...f, photo: canvas.toDataURL('image/jpeg', 0.85) }))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!success) return undefined
    const timer = window.setTimeout(() => setSuccess(''), 3200)
    return () => window.clearTimeout(timer)
  }, [success])

  const load = async () => {
    const data = await window.api.rooms.getAll()
    setRooms(data)
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (room) => {
    setEditing(room.id)
    setForm({
      room_number: room.room_number,
      room_type: room.room_type,
      rate_per_night: room.rate_per_night,
      max_occupancy: room.max_occupancy,
      status: room.status,
      description: room.description || '',
      photo: room.photo || ''
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const data = { ...form, rate_per_night: parseFloat(form.rate_per_night), max_occupancy: parseInt(form.max_occupancy) }
    let res
    if (editing) {
      res = await window.api.rooms.update(editing, data)
    } else {
      res = await window.api.rooms.create(data)
    }
    setLoading(false)
    if (res.success === false) {
      setError(res.error || 'Failed to save room')
    } else {
      setShowModal(false)
      load()
      setSuccess(editing ? 'Room changes saved.' : 'Room added successfully.')
    }
  }

  const handleDelete = async (room) => {
    if (!window.confirm(`Delete Room ${room.room_number}?\n\nThis permanently removes the room from the desktop workspace and cannot be undone.`)) return
    await window.api.rooms.delete(room.id)
    load()
    setSuccess(`Room ${room.room_number} deleted.`)
  }

  const available = rooms.filter((r) => r.status === 'available').length
  const occupied = rooms.filter((r) => r.status === 'occupied').length
  const maintenance = rooms.filter((r) => r.status === 'maintenance').length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Property Operations</p>
          <h1 className="bb-page-header-title mt-2">Rooms</h1>
          <p className="bb-page-header-subtitle">
            {rooms.length} total · {available} available · {occupied} occupied · {maintenance} maintenance
          </p>
        </div>
        <div className="bb-card-muted flex flex-wrap items-center gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Snapshot</p>
            <p className="mt-1 text-sm text-slate-600">Monitor room readiness, housekeeping signals, and occupancy at a glance.</p>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="btn-primary"
        >
          <Plus size={16} /> Add Room
        </button>
      </div>

      {rooms.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryPill label="Available" value={available} tone="emerald" />
          <SummaryPill label="Occupied" value={occupied} tone="amber" />
          <SummaryPill label="Maintenance" value={maintenance} tone="red" />
          <SummaryPill label="Room Count" value={rooms.length} tone="slate" />
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          ✓ {success}
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="bb-empty-state min-h-[260px]">
          <BedDouble size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500">No rooms yet. Add your first room to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title={editing ? 'Edit Room' : 'Add Room'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <Field label="Room Number" required helper="Use the label staff will recognise quickly at the front desk, for example 101 or Chalet 3.">
                <input
                  className="input"
                  value={form.room_number}
                  onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                  placeholder="e.g. 101"
                  required
                />
              </Field>
              <Field label="Room Type" required helper="This helps bookings, reports, and staff quickly understand the room category.">
                <select
                  className="input"
                  value={form.room_type}
                  onChange={(e) => setForm({ ...form, room_type: e.target.value })}
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Rate Per Night (P)" required helper="Standard nightly selling price used when new bookings are estimated and created.">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={form.rate_per_night}
                  onChange={(e) => setForm({ ...form, rate_per_night: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </Field>
              <Field label="Max Occupancy" helper="Maximum number of guests this room should comfortably hold.">
                <input
                  type="number"
                  min="1"
                  max="20"
                  className="input"
                  value={form.max_occupancy}
                  onChange={(e) => setForm({ ...form, max_occupancy: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Status" helper="Available means ready to sell, Occupied means a guest is currently staying, Maintenance blocks the room from new bookings, and Reserved is useful for manual holding.">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className="input resize-none"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional notes about this room"
              />
            </Field>

            {/* ── Room Photo (shown on online booking site) ── */}
            <Field label="Room Photo" helper="Shown on the online booking site. Recommended: landscape photo, at least 800×500 px.">
              {form.photo ? (
                <div className="relative w-full rounded-xl overflow-hidden border border-slate-200">
                  <img src={form.photo} alt="Room preview" className="w-full h-40 object-cover" />
                  <button
                    type="button"
                    onClick={() => { setForm((f) => ({ ...f, photo: '' })); if (photoInputRef.current) photoInputRef.current.value = '' }}
                    className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 w-full h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors">
                  <Image size={22} className="text-slate-300" />
                  <span className="text-xs text-slate-400">Click to upload a photo</span>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => processRoomPhoto(e.target.files[0])}
                  />
                </label>
              )}
            </Field>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary flex-1">
                {loading ? 'Saving...' : editing ? 'Save Changes' : 'Add Room'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function RoomCard({ room, onEdit, onDelete }) {
  return (
    <div className="bb-card overflow-hidden transition-shadow hover:shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
      {room.photo && (
        <img src={room.photo} alt={`Room ${room.room_number}`} className="w-full h-32 object-cover" />
      )}
      <div className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold tracking-[-0.02em] text-slate-800">Room {room.room_number}</p>
          <p className="text-sm text-slate-500">{room.room_type}</p>
        </div>
        <StatusBadge status={room.status} />
      </div>
      <div className="bb-card-muted mb-4 space-y-2 px-4 py-4 text-sm text-slate-600">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Nightly Rate</span>
          <span className="font-semibold text-slate-800">P {Number(room.rate_per_night).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Capacity</span>
          <span className="font-semibold text-slate-800">{room.max_occupancy} guests</span>
        </div>
        {room.description && <p className="border-t border-slate-200 pt-2 text-xs italic text-slate-500">{room.description}</p>}
      </div>
      <div className="flex gap-2 border-t border-slate-100 pt-3">
        <button
          onClick={() => onEdit(room)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-green-50 hover:text-green-600"
        >
          <Pencil size={13} /> Edit
        </button>
        <button
          onClick={() => onDelete(room)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
      </div>
    </div>
  )
}

function Field({ label, required, helper, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {helper && <p className="mt-1.5 text-xs text-slate-500">{helper}</p>}
    </div>
  )
}

function SummaryPill({ label, value, tone }) {
  const styles = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700'
  }

  return (
    <div className={`rounded-2xl border px-4 py-4 shadow-sm ${styles[tone] || styles.slate}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-[-0.03em]">{value}</p>
    </div>
  )
}
