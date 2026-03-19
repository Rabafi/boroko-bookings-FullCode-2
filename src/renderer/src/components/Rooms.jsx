import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, BedDouble } from 'lucide-react'
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
  description: ''
}

export default function Rooms() {
  const [rooms, setRooms] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    load()
  }, [])

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
      description: room.description || ''
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
    }
  }

  const handleDelete = async (room) => {
    if (!window.confirm(`Delete Room ${room.room_number}? This cannot be undone.`)) return
    await window.api.rooms.delete(room.id)
    load()
  }

  const available = rooms.filter((r) => r.status === 'available').length
  const occupied = rooms.filter((r) => r.status === 'occupied').length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Rooms</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rooms.length} total · {available} available · {occupied} reserved
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
        >
          <Plus size={16} /> Add Room
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-16 text-center">
          <BedDouble size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No rooms yet. Add your first room to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
              <Field label="Room Number" required>
                <input
                  className="input"
                  value={form.room_number}
                  onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                  placeholder="e.g. 101"
                  required
                />
              </Field>
              <Field label="Room Type" required>
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
              <Field label="Rate Per Night (P)" required>
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
              <Field label="Max Occupancy">
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
            <Field label="Status">
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

            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">{error}</div>
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
    <div className="bg-white rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-lg font-bold text-gray-800">Room {room.room_number}</p>
          <p className="text-sm text-gray-500">{room.room_type}</p>
        </div>
        <StatusBadge status={room.status} />
      </div>
      <div className="space-y-1 text-sm text-gray-600 mb-4">
        <p>
          <span className="font-medium">Rate:</span> P {Number(room.rate_per_night).toFixed(2)} /
          night
        </p>
        <p>
          <span className="font-medium">Capacity:</span> {room.max_occupancy} guests
        </p>
        {room.description && <p className="text-gray-400 italic text-xs mt-1">{room.description}</p>}
      </div>
      <div className="flex gap-2 border-t border-gray-100 pt-3">
        <button
          onClick={() => onEdit(room)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 px-2 py-1 rounded hover:bg-green-50 transition-colors"
        >
          <Pencil size={13} /> Edit
        </button>
        <button
          onClick={() => onDelete(room)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
