import { useEffect, useState, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, ShieldCheck, User,
  CalendarPlus, LogIn, LogOut, XCircle, CreditCard,
  Sparkles, ClipboardList, FolderOpen, RotateCcw,
  ChevronDown, ChevronUp, BedDouble, CheckCircle2
} from 'lucide-react'
import { Modal } from './shared/Modal'
import { useAuth } from '../App'

// ─── Staff Members ────────────────────────────────────────────────────────────

const emptyForm = { name: '', email: '', password: '', role: 'receptionist' }

function StaffMembers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isManager = currentUser?.role === 'manager'

  const load = useCallback(async () => {
    const data = await window.api.users.getAll()
    setUsers(data)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (u) => {
    setEditingId(u.id)
    setForm({ name: u.name, email: u.email, password: '', role: u.role })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    let res
    if (editingId) {
      res = await window.api.users.update(editingId, form)
    } else {
      if (!form.password) { setError('Password is required for new staff'); setLoading(false); return }
      res = await window.api.users.create(form)
    }
    setLoading(false)
    if (res.success === false) {
      setError(res.error || 'Failed to save')
    } else {
      setShowModal(false)
      load()
    }
  }

  const handleDelete = async (u) => {
    if (u.id === currentUser.id) { alert("You can't delete your own account."); return }
    if (!window.confirm(`Remove ${u.name} from staff?`)) return
    await window.api.users.delete(u.id)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{users.length} staff member{users.length !== 1 ? 's' : ''}</p>
        {isManager && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Plus size={15} /> Add Staff
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((u) => (
          <div key={u.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  {u.role === 'manager'
                    ? <ShieldCheck size={18} className="text-green-600" />
                    : <User size={18} className="text-green-500" />}
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{u.name}</p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                u.role === 'manager' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {u.role}
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Added {new Date(u.created_at).toLocaleDateString()}
            </p>
            {isManager && (
              <div className="flex gap-2 border-t border-gray-100 pt-3">
                <button
                  onClick={() => openEdit(u)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 px-2 py-1 rounded hover:bg-green-50 transition-colors"
                >
                  <Pencil size={13} /> Edit
                </button>
                {u.id !== currentUser.id ? (
                  <button
                    onClick={() => handleDelete(u)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 italic px-2 py-1">(you)</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <Modal
          title={editingId ? 'Edit Staff Member' : 'Add Staff Member'}
          onClose={() => setShowModal(false)}
          size="sm"
        >
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input className="input" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input type="email" className="input" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password {editingId && <span className="text-gray-400 font-normal">(leave blank to keep current)</span>}
              </label>
              <input type="password" className="input" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingId ? 'Leave blank to keep current' : 'Min 6 characters'} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select className="input" value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="receptionist">Receptionist</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={loading} className="btn-primary flex-1">
                {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Add Staff'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

const ACTION_CONFIG = {
  booking_created:   { icon: CalendarPlus,  color: 'text-green-600',  bg: 'bg-green-50',  label: 'New Booking' },
  check_in:          { icon: LogIn,          color: 'text-teal-600',   bg: 'bg-teal-50',   label: 'Check-in' },
  check_out:         { icon: LogOut,         color: 'text-blue-600',   bg: 'bg-blue-50',   label: 'Check-out' },
  booking_cancelled: { icon: XCircle,        color: 'text-red-500',    bg: 'bg-red-50',    label: 'Cancelled' },
  booking_confirmed: { icon: CheckCircle2,   color: 'text-green-600',  bg: 'bg-green-50',  label: 'Confirmed' },
  booking_updated:   { icon: ClipboardList,  color: 'text-gray-500',   bg: 'bg-gray-50',   label: 'Updated' },
  payment_updated:   { icon: CreditCard,     color: 'text-purple-600', bg: 'bg-purple-50', label: 'Payment' },
  housekeeping_updated: { icon: Sparkles,    color: 'text-amber-500',  bg: 'bg-amber-50',  label: 'Housekeeping' },
  room_created:         { icon: BedDouble,      color: 'text-green-600',  bg: 'bg-green-50',  label: 'Room Added' },
  event_booking_created:{ icon: CalendarPlus,  color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Event Booking' },
}

const FILTER_OPTIONS = [
  { value: 'all',          label: 'All' },
  { value: 'booking_created', label: 'New Bookings' },
  { value: 'check_in',     label: 'Check-ins' },
  { value: 'check_out',    label: 'Check-outs' },
  { value: 'payment_updated', label: 'Payments' },
  { value: 'housekeeping_updated', label: 'Housekeeping' },
  { value: 'booking_cancelled', label: 'Cancellations' },
]

function fmt(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ActivityLog() {
  const { user: currentUser } = useAuth()
  const isManager = currentUser?.role === 'manager'

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [backupInfo, setBackupInfo] = useState(null)
  const [showBackups, setShowBackups] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [log, info] = await Promise.all([
        window.api.activity.getAll(),
        window.api.backup.getInfo()
      ])
      setEntries(log || [])
      setBackupInfo(info)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleClear = async () => {
    if (!window.confirm('Clear all activity log entries? This cannot be undone.')) return
    await window.api.activity.clear()
    setEntries([])
  }

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.action === filter)

  // Group by calendar date
  const grouped = filtered.reduce((acc, entry) => {
    const day = new Date(entry.timestamp).toDateString()
    if (!acc[day]) acc[day] = []
    acc[day].push(entry)
    return acc
  }, {})

  const lastBackup = backupInfo?.backups?.[0]

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filter === opt.value
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-green-50 transition-colors"
          >
            <RotateCcw size={12} /> Refresh
          </button>
          {isManager && entries.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-3 py-1.5 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={12} /> Clear Log
            </button>
          )}
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading activity...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activity recorded yet</p>
          <p className="text-xs mt-1">Actions like check-ins, bookings and payments will appear here</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, dayEntries]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                {fmtDate(dayEntries[0].timestamp)}
                <span className="ml-2 text-gray-300 normal-case font-normal">
                  {dayEntries.length} event{dayEntries.length !== 1 ? 's' : ''}
                </span>
              </p>
              <div className="space-y-1">
                {dayEntries.map((entry) => {
                  const cfg = ACTION_CONFIG[entry.action] || {
                    icon: ClipboardList, color: 'text-gray-500', bg: 'bg-gray-50', label: entry.action
                  }
                  const Icon = cfg.icon
                  return (
                    <div key={entry.id} className="flex items-start gap-3 bg-white rounded-lg px-4 py-3 border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className={`w-7 h-7 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={13} className={cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 leading-snug">{entry.description}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmt(entry.timestamp)}
                          {entry.user_name && entry.user_name !== 'System' && (
                            <span className="ml-2 text-gray-400">· {entry.user_name}</span>
                          )}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.color} font-medium`}>
                        {cfg.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Backup panel */}
      <div className="mt-6 border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowBackups(!showBackups)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <FolderOpen size={15} className="text-green-600" />
            Automatic Backups
            {lastBackup && (
              <span className="text-xs text-gray-400 font-normal ml-1">
                · Last backup {new Date(lastBackup.created).toLocaleString()}
              </span>
            )}
            {!lastBackup && (
              <span className="text-xs text-gray-400 font-normal ml-1">· No backups yet</span>
            )}
          </div>
          {showBackups ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {showBackups && (
          <div className="px-4 py-3 bg-white">
            <p className="text-xs text-gray-500 mb-3">
              Backups run automatically on startup, every hour, and after each check-in / check-out.
              The 10 most recent backups are kept.
            </p>
            {backupInfo?.backups?.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {backupInfo.backups.map((b, i) => (
                  <div key={b.name} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      {i === 0 && (
                        <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-medium">Latest</span>
                      )}
                      <span className="font-mono text-gray-500">{b.name.replace('backup-', '').replace('.json', '').replace(/-/g, ' ').trim()}</span>
                    </div>
                    <span className="text-gray-400">{fmtSize(b.size)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3 italic">No backups found yet — one will be created on the next startup.</p>
            )}
            <button
              onClick={() => window.api.backup.openFolder()}
              className="flex items-center gap-2 text-xs text-green-600 hover:text-green-800 px-3 py-2 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            >
              <FolderOpen size={13} /> Open backups folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Staff page (tabbed) ─────────────────────────────────────────────────

export default function Staff() {
  const [tab, setTab] = useState('staff')

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your team and review activity</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'staff',    label: 'Staff Members', icon: User },
          { key: 'activity', label: 'Activity Log',  icon: ClipboardList }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'staff'    && <StaffMembers />}
      {tab === 'activity' && <ActivityLog />}
    </div>
  )
}
