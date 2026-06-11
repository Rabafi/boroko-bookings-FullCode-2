import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, BedDouble, Image, X, ChevronLeft, ChevronRight, Calendar, RefreshCw, Lock } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { ContextDrawer } from './shared/ContextDrawer'
import { DataViewToolbar } from './shared/DataViewToolbar'
import UsageLimitIndicator from './shared/UsageLimitIndicator'
import UsageUpgradePrompt from './shared/UpgradePromptModal'
import UpgradeNudgeBanner from './shared/UpgradeNudgeBanner'
import { useAccess, useSettings } from '../app-context'
import { MONTHLY_USAGE_RESET_COPY, canCreateRoom, getEarlyUpgradePromptState, getPlanUsageLimits, normalizeSubscriptionPlan } from '../../../shared/subscriptionPlans'
import { formatLocalDate } from '../utils/localDate'

const ROOM_TYPES = ['Single', 'Double', 'Twin', 'Suite', 'Family', 'Deluxe']
const STATUSES = ['available', 'occupied', 'maintenance', 'reserved']

const MAX_PHOTOS = 5

const emptyForm = {
  room_number: '',
  room_type: 'Double',
  rate_per_night: '',
  max_occupancy: 2,
  status: 'available',
  description: '',
  photos: [],
  amenities: []
}

export default function Rooms() {
  const navigate = useNavigate()
  const access = useAccess()
  const { settings } = useSettings()
  const [rooms, setRooms] = useState([])
  const [usageSnapshot, setUsageSnapshot] = useState(null)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [activeRateByRoom, setActiveRateByRoom] = useState({})
  const [rateOverrides, setRateOverrides] = useState([])
  const [rateForm, setRateForm] = useState(null)
  const [editingRate, setEditingRate] = useState(null)
  const [rateSaving, setRateSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [density, setDensity] = useState('comfortable')
  const [activeView, setActiveView] = useState('all')
  const [meshStatus, setMeshStatus] = useState({ activeLocks: [], peerCount: 0 })
  const photoInputRef = useRef(null)

  const processRoomPhotos = (files) => {
    const fileArr = Array.from(files)
    let rejected = 0
    fileArr.forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new window.Image()
        img.onload = () => {
          const MIN_W = 400
          const MIN_H = 300
          if (img.width < MIN_W || img.height < MIN_H) {
            rejected += 1
            if (rejected === 1) {
              window.alert(`Photo is too small. Minimum size is ${MIN_W}x${MIN_H}px. Your image is ${img.width}x${img.height}px.`)
            }
            return
          }
          const MAX = 800
          const canvas = document.createElement('canvas')
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
          canvas.width = img.width * ratio
          canvas.height = img.height * ratio
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          setForm((f) => {
            const existing = f.photos || []
            if (existing.length >= MAX_PHOTOS) return f
            return { ...f, photos: [...existing, dataUrl] }
          })
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(file)
    })
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadMeshStatus = async () => {
      const status = await window.api?.sync?.getStatus?.().catch(() => null)
      if (!cancelled) setMeshStatus(status?.mesh || { activeLocks: [], peerCount: 0 })
    }
    loadMeshStatus()
    const unsubscribe = window.api?.sync?.onStatusChanged?.((status) => {
      setMeshStatus(status?.mesh || { activeLocks: [], peerCount: 0 })
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!success) return undefined
    const timer = window.setTimeout(() => setSuccess(''), 3200)
    return () => window.clearTimeout(timer)
  }, [success])

  const [listLoading, setListLoading] = useState(true)

  const load = async () => {
    setListLoading(true)
    const [data, overrides] = await Promise.all([
      window.api.rooms.getAll(),
      window.api.rateOverrides.getAll().catch(() => [])
    ])
    setRooms(data)
    setRateOverrides(Array.isArray(overrides) ? overrides : [])
    const today = new Date()
    const start = formatLocalDate(today)
    const endDate = new Date(today)
    endDate.setDate(endDate.getDate() + 1)
    const end = formatLocalDate(endDate)
    const entries = await Promise.all((data || []).map(async (room) => {
      try {
        const result = await window.api.rateOverrides.getApplicable(room.id, start, end)
        if (result && Number.isFinite(Number(result.rate))) {
          return [room.id, { rate_per_night: Number(result.rate), name: result.name || '' }]
        }
      } catch {
        // ignore missing override lookup
      }
      return [room.id, null]
    }))
    setActiveRateByRoom(Object.fromEntries(entries))
    setListLoading(false)
    window.api.usage.getSnapshot?.().then((snapshot) => {
      if (!snapshot?.error) setUsageSnapshot(snapshot)
    }).catch(() => {})
  }

  const openAdd = () => {
    if (roomLimitStatus.isBlocked) {
      setShowUpgradePrompt(true)
      return
    }
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openRateCreate = () => {
    setEditingRate(null)
    setRateForm({
      room_id: rooms[0]?.id || '',
      start_date: '',
      end_date: '',
      rate_per_night: '',
      name: '',
      apply_scope: 'single',
      pricing_mode: 'fixed',
      percentage_off: ''
    })
  }

  const openRateEdit = (rateOverride) => {
    setEditingRate(rateOverride)
    setRateForm({
      room_id: rateOverride.room_id,
      start_date: rateOverride.start_date,
      end_date: rateOverride.end_date,
      rate_per_night: String(rateOverride.rate_per_night),
      name: rateOverride.name || '',
      apply_scope: 'single',
      pricing_mode: 'fixed',
      percentage_off: ''
    })
  }

  const handleRateSave = async () => {
    setRateSaving(true)
    try {
      const applyScope = rateForm.apply_scope || 'single'
      const pricingMode = rateForm.pricing_mode || 'fixed'
      const selectedRoom = rooms.find((room) => room.id === String(rateForm.room_id || '').trim())
      const targetRooms = editingRate || applyScope === 'single'
        ? (selectedRoom ? [selectedRoom] : [])
        : rooms

      if (targetRooms.length === 0) {
        throw new Error('Choose at least one room for this special.')
      }

      const fixedRate = parseFloat(rateForm.rate_per_night)
      const percentageOff = parseFloat(rateForm.percentage_off)
      if (pricingMode === 'fixed' && !Number.isFinite(fixedRate)) {
        throw new Error('Enter a valid special rate.')
      }
      if (pricingMode === 'percent' && (!Number.isFinite(percentageOff) || percentageOff <= 0 || percentageOff >= 100)) {
        throw new Error('Enter a percentage discount between 0 and 100.')
      }

      const buildPayloadForRoom = (room) => {
        const computedRate = pricingMode === 'percent'
          ? Number((Number(room.rate_per_night || 0) * (1 - (percentageOff / 100))).toFixed(2))
          : fixedRate
        return {
          room_id: String(room.id || '').trim(),
          start_date: rateForm.start_date,
          end_date: rateForm.end_date,
          name: rateForm.name,
          rate_per_night: computedRate
        }
      }

      const results = editingRate
        ? [await window.api.rateOverrides.update(editingRate.id, buildPayloadForRoom(targetRooms[0]))]
        : await Promise.all(targetRooms.map((room) => window.api.rateOverrides.create(buildPayloadForRoom(room))))

      const failed = results.find((result) => !result?.success)
      if (failed) {
        throw new Error(failed?.error || `Could not ${editingRate ? 'update' : 'create'} rate override.`)
      }

      await load()
      setRateForm(null)
      setEditingRate(null)
      if (results.some((result) => result?.local_only)) {
        setSuccess('One or more rate overrides were saved locally because the server save is currently unavailable.')
      }
    } catch (error) {
      setError(error?.message || 'Could not save rate override.')
    } finally {
      setRateSaving(false)
    }
  }

  const handleRateDelete = async (id) => {
    setConfirmDialog({
      title: 'Delete rate override?',
      message: 'This removes the special price from the affected date range. Standard room rates will apply again.',
      confirmLabel: 'Delete override',
      onConfirm: async () => {
        setConfirmDialog(null)
        await window.api.rateOverrides.delete(id).catch(console.error)
        await load()
        setSuccess('Rate override deleted.')
      }
    })
  }

  const openEdit = (room) => {
    setEditing(room.id)
    // Normalise: prefer photos array, fall back to legacy single photo field
    const photos = Array.isArray(room.photos) && room.photos.length > 0
      ? room.photos
      : (room.photo ? [room.photo] : [])
    setForm({
      room_number: room.room_number,
      room_type: room.room_type,
      rate_per_night: room.rate_per_night,
      max_occupancy: room.max_occupancy,
      status: room.status,
      description: room.description || '',
      photos,
      amenities: Array.isArray(room.amenities) ? room.amenities : []
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const data = {
      ...form,
      rate_per_night: parseFloat(form.rate_per_night),
      max_occupancy: parseInt(form.max_occupancy),
      amenities: Array.isArray(form.amenities) ? form.amenities.filter(Boolean) : []
    }
    let res
    if (editing) {
      res = await window.api.rooms.update(editing, data)
    } else {
      const roomLimitStatus = canCreateRoom({ plan: access?.entitlement?.plan || 'Starter', used: rooms.length })
      if (roomLimitStatus.isBlocked) {
        const plan = access?.entitlement?.plan || 'Starter'
        const nextPlan = plan === 'Starter' ? 'Standard' : 'Pro'
        setLoading(false)
        setError(`Room limit reached: ${plan} allows up to ${usageLimits.rooms} rooms. Upgrade to ${nextPlan} for ${nextPlan === 'Standard' ? '20' : 'unlimited'} rooms.`)
        return
      }
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
    setConfirmDialog({
      title: `Delete Room ${room.room_number}?`,
      message: 'This permanently removes the room from the desktop workspace and cannot be undone.',
      confirmLabel: 'Delete room',
      onConfirm: async () => {
        setConfirmDialog(null)
        await window.api.rooms.delete(room.id)
        setSelectedRoom(null)
        load()
        setSuccess(`Room ${room.room_number} deleted.`)
      }
    })
  }

  const roomStatusCounts = useMemo(() => rooms.reduce((counts, room) => {
    counts[room.status] = (counts[room.status] || 0) + 1
    return counts
  }, { available: 0, occupied: 0, maintenance: 0 }), [rooms])

  const available = roomStatusCounts.available || 0
  const occupied = roomStatusCounts.occupied || 0
  const maintenance = roomStatusCounts.maintenance || 0
  const usageLimits = getPlanUsageLimits(access?.entitlement?.plan || 'Starter')
  const currentPlan = normalizeSubscriptionPlan(usageSnapshot?.plan || access?.entitlement?.plan || 'Starter')
  const isProPlan = currentPlan === 'Pro'
  const roomLimitStatus = usageSnapshot?.statuses?.rooms || canCreateRoom({ plan: access?.entitlement?.plan || 'Starter', used: rooms.length })
  const roomEarlyPrompt = getEarlyUpgradePromptState({
    plan: currentPlan,
    bookingsUsage: usageSnapshot?.usage?.monthlyBookings ?? 0,
    roomsUsage: usageSnapshot?.usage?.rooms ?? rooms.length,
    usersUsage: usageSnapshot?.usage?.users ?? 0,
    limits: usageLimits
  })
  const showRoomEarlyPrompt = !isProPlan && !roomLimitStatus.isBlocked && roomEarlyPrompt.shouldPrompt
  const roomLimitMessage = roomLimitStatus.isAbovePlan
    ? `This lodge is above the ${usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.`
    : roomLimitStatus.isBlocked
      ? `Room creation is restricted because this lodge has reached the ${usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'} room limit.`
      : ''
  const roomViews = [
    { value: 'all', label: 'All' },
    { value: 'available', label: 'Available' },
    { value: 'occupied', label: 'Occupied' },
    { value: 'maintenance', label: 'Maintenance' }
  ]
  const visibleRooms = useMemo(() => (
    activeView === 'all' ? rooms : rooms.filter((room) => room.status === activeView)
  ), [activeView, rooms])
  const meshLocksByRoom = useMemo(() => {
    const grouped = new Map()
    for (const lock of meshStatus?.activeLocks || []) {
      if (!lock?.roomId || lock.sourceNodeId === meshStatus?.nodeId) continue
      const key = String(lock.roomId)
      grouped.set(key, [...(grouped.get(key) || []), lock])
    }
    return grouped
  }, [meshStatus?.activeLocks, meshStatus?.nodeId])
  const heldRoomCount = meshLocksByRoom.size

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Property Operations</p>
          <h1 className="bb-page-header-title mt-2">Rooms</h1>
          <p className="bb-page-header-subtitle">
            {rooms.length} total · {available} available · {occupied} occupied · {maintenance} maintenance
          </p>
          <div className="mt-2">
            {isProPlan ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                Unlimited access
              </span>
            ) : (
              <>
                <UsageLimitIndicator label="Rooms" used={usageSnapshot?.usage?.rooms ?? rooms.length} limit={usageLimits.rooms} />
                <p className="mt-1 text-xs text-slate-500">{usageSnapshot?.monthlyResetCopy || MONTHLY_USAGE_RESET_COPY}</p>
                {roomLimitMessage && <p className="mt-2 text-xs text-rose-700">{roomLimitMessage}</p>}
              </>
            )}
            <div className="mt-2">
              <UpgradeNudgeBanner
                visible={showRoomEarlyPrompt}
                message="You’re approaching your plan limits. Consider upgrading to avoid interruptions."
                sessionKey="boroko:upgrade-nudge:rooms"
                lodgeId={usageSnapshot?.lodge_id || settings?.lodge_id || ''}
                lodgeName={usageSnapshot?.lodge_name || settings?.lodge_name || settings?.company_name || ''}
                plan={currentPlan}
                usage={usageSnapshot?.usage || { monthlyBookings: 0, rooms: rooms.length, users: 0 }}
                recommendation={roomEarlyPrompt}
                trigger="banner"
                onUpgrade={() => setShowUpgradePrompt(true)}
              />
            </div>
          </div>
        </div>
        <div className="bb-card-muted hidden max-w-xs flex-wrap items-center gap-2 px-3 py-2.5 xl:flex">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Snapshot</p>
            <p className="mt-0.5 text-xs text-slate-600">Room readiness and occupancy at a glance.</p>
          </div>
        </div>
        <button
          onClick={openAdd}
          disabled={roomLimitStatus.isBlocked}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={16} /> Add Room
        </button>
      </div>

      {rooms.length > 0 && (
        <div className="bb-compact-stat-grid">
          <SummaryPill label="Available" value={available} tone="emerald" />
          <SummaryPill label="Occupied" value={occupied} tone="amber" />
          <SummaryPill label="Maintenance" value={maintenance} tone="red" />
          <SummaryPill label="Mesh Holds" value={heldRoomCount} tone="amber" />
          <SummaryPill label="Room Count" value={rooms.length} tone="slate" />
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          ✓ {success}
        </div>
      )}
      {roomLimitMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm">
          {roomLimitMessage}
        </div>
      )}

      <section className="bb-card p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Calendar size={18} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Seasonal & Event Pricing</p>
              <p className="mt-0.5 text-xs text-slate-500">Temporary room prices by date range.</p>
            </div>
          </div>
          <button type="button" onClick={openRateCreate} className="btn-primary">
            <Plus size={16} /> Add Override
          </button>
        </div>

        {rateOverrides.length === 0 ? (
          <p className="text-sm text-slate-500">No rate overrides set. Add seasonal, holiday, or weekend rates here.</p>
        ) : (
          <div className="space-y-3">
            {rateOverrides.map((rateOverride) => {
              const room = rooms.find((roomEntry) => roomEntry.id === rateOverride.room_id)
              return (
                <div key={rateOverride.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{rateOverride.name || 'Rate override'} — {room ? `Room ${room.room_number}` : rateOverride.room_id ? rateOverride.room_id : 'All rooms'}</p>
                    <p className="mt-1 text-xs text-slate-500">{rateOverride.start_date} to {rateOverride.end_date}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-emerald-700">P {Number(rateOverride.rate_per_night).toFixed(2)}/night</span>
                    <button type="button" onClick={() => openRateEdit(rateOverride)} className="p-1 text-blue-400 hover:text-blue-600"><Pencil size={14} /></button>
                    <button type="button" onClick={() => handleRateDelete(rateOverride.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {rateForm && (
          <div className="mt-4 border-t border-slate-200 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {editingRate ? 'Edit Rate Override' : 'New Rate Override'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Apply To" required>
                <select
                  className="input"
                  value={rateForm.apply_scope || 'single'}
                  onChange={(e) => setRateForm({ ...rateForm, apply_scope: e.target.value })}
                  disabled={!!editingRate}
                >
                  <option value="single">One room</option>
                  <option value="all">All rooms</option>
                </select>
              </Field>
              <Field label="Room" required>
                <select className="input" value={rateForm.room_id} onChange={(e) => setRateForm({ ...rateForm, room_id: e.target.value })} required disabled={(rateForm.apply_scope || 'single') === 'all' || !!editingRate && (rateForm.pricing_mode || 'fixed') === 'percent'}>
                  {rooms.map((room) => (<option key={room.id} value={room.id}>Room {room.room_number} — {room.room_type}</option>))}
                </select>
              </Field>
              <Field label="Name / Label">
                <input type="text" className="input" placeholder="e.g. Christmas, Weekend" value={rateForm.name} onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })} />
              </Field>
              <Field label="Discount Type" required>
                <select className="input" value={rateForm.pricing_mode || 'fixed'} onChange={(e) => setRateForm({ ...rateForm, pricing_mode: e.target.value })}>
                  <option value="fixed">Set special price</option>
                  <option value="percent">Reduce by percentage</option>
                </select>
              </Field>
              <Field label="Start Date" required>
                <input type="date" className="input" value={rateForm.start_date} onChange={(e) => setRateForm({ ...rateForm, start_date: e.target.value })} required />
              </Field>
              <Field label="End Date" required>
                <input type="date" className="input" value={rateForm.end_date} min={rateForm.start_date} onChange={(e) => setRateForm({ ...rateForm, end_date: e.target.value })} required />
              </Field>
              <Field label={rateForm.pricing_mode === 'percent' ? 'Discount Percentage (%)' : 'Rate Per Night (P)'} required>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={rateForm.pricing_mode === 'percent' ? '99.99' : undefined}
                  className="input"
                  value={rateForm.pricing_mode === 'percent' ? (rateForm.percentage_off || '') : rateForm.rate_per_night}
                  onChange={(e) => setRateForm({
                    ...rateForm,
                    ...(rateForm.pricing_mode === 'percent'
                      ? { percentage_off: e.target.value }
                      : { rate_per_night: e.target.value })
                  })}
                  required
                  placeholder={rateForm.pricing_mode === 'percent' ? '10' : '0.00'}
                />
              </Field>
            </div>
            {rateForm.pricing_mode === 'percent' && (
              <p className="text-xs text-slate-500">
                {rateForm.apply_scope === 'all'
                  ? 'The same percentage discount will be applied to each room’s standard rate.'
                  : 'The percentage discount will be calculated from the selected room’s standard rate.'}
              </p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setRateForm(null); setEditingRate(null) }} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={handleRateSave} disabled={rateSaving} className="btn-primary flex-1">{rateSaving ? 'Saving...' : editingRate ? 'Update' : 'Add Override'}</button>
            </div>
          </div>
        )}
      </section>

      {listLoading && rooms.length === 0 ? (
        <div className="flex items-center justify-center gap-3 min-h-[260px] text-sm text-gray-500">
          <RefreshCw size={16} className="animate-spin" />
          Loading rooms…
        </div>
      ) : rooms.length === 0 ? (
        <div className="bb-empty-state min-h-[260px]">
          <BedDouble size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500">No rooms yet. Add your first room to get started.</p>
        </div>
      ) : (
        <>
          <DataViewToolbar
            title="Room Board"
            subtitle="Saved views, density controls, and room context live here so property ops stays compact."
            views={roomViews}
            activeView={activeView}
            onViewChange={setActiveView}
            density={density}
            onDensityChange={setDensity}
          />
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${density === 'compact' ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
            {visibleRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                activeRate={activeRateByRoom[room.id] || null}
                meshLocks={meshLocksByRoom.get(String(room.id)) || []}
                compact={density === 'compact'}
                onSelect={() => setSelectedRoom(room)}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
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
            <Field
              label="Room Amenities"
              helper="Add short guest-facing items like Wi-Fi, breakfast, air conditioning, balcony, or work desk. Press Enter after each item."
            >
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap gap-2">
                  {(form.amenities || []).map((amenity, idx) => (
                    <span key={`${amenity}-${idx}`} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      {amenity}
                      <button
                        type="button"
                        onClick={() => setForm((current) => ({
                          ...current,
                          amenities: current.amenities.filter((_, amenityIndex) => amenityIndex !== idx)
                        }))}
                        className="text-emerald-700/70 hover:text-emerald-900"
                        aria-label={`Remove ${amenity}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  className="mt-3 input border-0 bg-slate-50"
                  placeholder="Type an amenity and press Enter"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    const value = event.currentTarget.value.trim()
                    if (!value) return
                    setForm((current) => ({
                      ...current,
                      amenities: [...new Set([...(current.amenities || []), value])]
                    }))
                    event.currentTarget.value = ''
                  }}
                />
              </div>
            </Field>

            {/* ── Room Photos (shown on online booking site) ── */}
            <Field
              label={`Room Photos (${(form.photos || []).length}/${MAX_PHOTOS})`}
              helper="Guests will scroll through these on the booking site. Add up to 5 photos. Drag to reorder."
            >
              <div className="space-y-3">
                {/* Existing photos */}
                {(form.photos || []).length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {(form.photos || []).map((src, idx) => (
                      <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 group">
                        <img src={src} alt={`Photo ${idx + 1}`} className="w-full h-24 object-cover" />
                        {/* Move left */}
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => setForm((f) => {
                              const p = [...f.photos]
                              ;[p[idx - 1], p[idx]] = [p[idx], p[idx - 1]]
                              return { ...f, photos: p }
                            })}
                            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <ChevronLeft size={12} />
                          </button>
                        )}
                        {/* Move right */}
                        {idx < (form.photos || []).length - 1 && (
                          <button
                            type="button"
                            onClick={() => setForm((f) => {
                              const p = [...f.photos]
                              ;[p[idx], p[idx + 1]] = [p[idx + 1], p[idx]]
                              return { ...f, photos: p }
                            })}
                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <ChevronRight size={12} />
                          </button>
                        )}
                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))}
                          className="absolute top-1 right-1 bg-black/50 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors"
                        >
                          <X size={12} />
                        </button>
                        {idx === 0 && (
                          <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">Cover</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Upload more */}
                {(form.photos || []).length < MAX_PHOTOS && (
                  <label className="flex flex-col items-center justify-center gap-2 w-full h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors">
                    <Image size={20} className="text-slate-300" />
                    <span className="text-xs text-slate-400">
                      {(form.photos || []).length === 0 ? 'Click to upload photos' : `Add more (${MAX_PHOTOS - (form.photos || []).length} remaining)`}
                    </span>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => processRoomPhotos(e.target.files)}
                    />
                  </label>
                )}
              </div>
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

      <UsageUpgradePrompt
        open={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
        onUpgrade={() => {
          setShowUpgradePrompt(false)
          navigate('/settings', { state: { activeTab: 'license' } })
        }}
        resourceLabel="Rooms"
        currentPlan={usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'}
        used={usageSnapshot?.usage?.rooms ?? rooms.length}
        limit={usageLimits.rooms}
        grace={0}
        status={roomLimitStatus}
        message={roomLimitMessage || `Upgrade to add more rooms for this lodge.`}
        usage={usageSnapshot?.usage}
        recommendation={usageSnapshot?.recommendation}
        lodgeName={usageSnapshot?.lodge_name || settings?.lodge_name || settings?.company_name || ''}
        lodgeId={usageSnapshot?.lodge_id || settings?.lodge_id || ''}
      />
      <ContextDrawer
        open={!!selectedRoom}
        title={selectedRoom ? `Room ${selectedRoom.room_number}` : ''}
        subtitle={selectedRoom ? `${selectedRoom.room_type} · ${selectedRoom.status}${meshLocksByRoom.has(String(selectedRoom.id)) ? ' · held by another desk' : ''}` : ''}
        onClose={() => setSelectedRoom(null)}
        actions={selectedRoom ? [
          { label: 'Edit room', primary: true, onClick: () => { openEdit(selectedRoom); setSelectedRoom(null) } },
          { label: 'Open planning calendar', onClick: () => navigate('/calendar') },
          { label: 'Delete room', onClick: () => handleDelete(selectedRoom) }
        ] : []}
      >
        {selectedRoom && (
          <div className="space-y-3">
            <div className="bb-context-card">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Nightly rate</p>
              <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-900">
                P {Number((activeRateByRoom[selectedRoom.id]?.rate_per_night ?? selectedRoom.rate_per_night) || 0).toFixed(2)}
              </p>
              {activeRateByRoom[selectedRoom.id]?.name && (
                <p className="mt-1 text-xs font-semibold text-emerald-700">{activeRateByRoom[selectedRoom.id].name}</p>
              )}
            </div>
            {meshLocksByRoom.has(String(selectedRoom.id)) && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-center gap-2 font-bold">
                  <Lock size={15} />
                  Held by another front desk
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  This is an advisory hold while another staff member is working on a booking for this room.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="bb-context-card">
                <p className="text-xs text-slate-500">Occupancy</p>
                <p className="mt-1 text-sm font-bold text-slate-900">Up to {selectedRoom.max_occupancy} guests</p>
              </div>
              <div className="bb-context-card">
                <p className="text-xs text-slate-500">Photos</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{selectedRoom.photos?.length || 0} saved</p>
              </div>
            </div>
            {selectedRoom.description && (
              <div className="bb-context-card">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Notes</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{selectedRoom.description}</p>
              </div>
            )}
          </div>
        )}
      </ContextDrawer>
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

function RoomCard({ room, activeRate, meshLocks = [], compact = false, onSelect, onEdit, onDelete }) {
  const coverPhoto = (Array.isArray(room.photos) && room.photos[0]) || room.photo || null
  const showingOverride = activeRate && Number(activeRate.rate_per_night) !== Number(room.rate_per_night)
  const isHeld = meshLocks.length > 0
  return (
    <div className="bb-card overflow-hidden transition-shadow hover:shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
      {coverPhoto && (
        <img src={coverPhoto} alt={`Room ${room.room_number}`} className="w-full h-32 object-cover" />
      )}
      <div className={compact ? 'p-4' : 'p-5'}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold tracking-[-0.02em] text-slate-800">Room {room.room_number}</p>
          <p className="text-sm text-slate-500">{room.room_type}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={room.status} />
          {isHeld && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              <Lock size={11} />
              Held
            </span>
          )}
        </div>
      </div>
        {isHeld && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            Held by another front desk
          </div>
        )}
        <div className="bb-card-muted mb-4 space-y-2 px-4 py-4 text-sm text-slate-600">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Nightly Rate</span>
          <div className="text-right">
            <span className="font-semibold text-slate-800">P {Number(showingOverride ? activeRate.rate_per_night : room.rate_per_night).toFixed(2)}</span>
            {showingOverride && (
              <p className="mt-1 text-[11px] font-medium text-emerald-700">
                Today: {activeRate.name || 'Seasonal rate'} instead of P {Number(room.rate_per_night).toFixed(2)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Capacity</span>
          <span className="font-semibold text-slate-800">{room.max_occupancy} guests</span>
        </div>
          {!compact && room.description && <p className="border-t border-slate-200 pt-2 text-xs italic text-slate-500">{room.description}</p>}
        </div>
      {!compact && Array.isArray(room.amenities) && room.amenities.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {room.amenities.slice(0, 4).map((amenity) => (
            <span key={amenity} className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              {amenity}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button
          onClick={onSelect}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
        >
          Details
        </button>
        <div className="flex gap-2">
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
    <div className={`bb-compact-stat ${styles[tone] || styles.slate}`}>
      <p className="bb-compact-stat__label">{label}</p>
      <p className="bb-compact-stat__value">{value}</p>
    </div>
  )
}
