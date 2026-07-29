import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BedDouble,
  CheckCircle,
  ChevronRight,
  ClipboardCheck,
  Image as ImageIcon,
  LogIn,
  LogOut,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  User
} from 'lucide-react'
import { useSettings } from '../app-context'
import { localToday } from '../utils/localDate'

function guestName(booking) {
  return booking?.customer_name || booking?.guest_name || booking?.customers?.name || 'Guest'
}

function roomLabel(booking) {
  const number = booking?.room_number || booking?.rooms?.room_number
  return number ? `Room ${number}` : 'Room pending'
}

function stayDates(booking) {
  const checkIn = booking?.check_in || '—'
  const checkOut = booking?.check_out || '—'
  return `${checkIn} → ${checkOut}`
}

function balanceDue(booking) {
  const total = Number(booking?.total_amount || 0) + Number(booking?.charges_total || 0)
  const paid = Number(booking?.amount_paid || 0)
  return Math.max(0, total - paid)
}

function statusLabel(status) {
  const value = String(status || '').replace(/_/g, ' ')
  if (!value) return 'booked'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isAlreadyIn(booking) {
  const status = String(booking?.status || '').toLowerCase()
  return status === 'checked_in' || status === 'checked-in'
}

function isAlreadyOut(booking) {
  const status = String(booking?.status || '').toLowerCase()
  return status === 'checked_out' || status === 'checked-out' || status === 'cancelled'
}

function isStepDone(step) {
  return step?.completed === true
}

function formatWhen(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

function resizeImageToDataUrl(file, maxSide = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('Choose an image file'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not load image'))
      img.onload = () => {
        const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * ratio))
        canvas.height = Math.max(1, Math.round(img.height * ratio))
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function StepItem({ step, booking, onComplete, onReset, loading }) {
  const done = isStepDone(step)
  const key = String(step?.step_key || '')
  const stored = step?.data && typeof step.data === 'object' ? step.data : {}
  const [idNumber, setIdNumber] = useState(stored.id_number || booking?.customers?.id_number || '')
  const [idType, setIdType] = useState(stored.id_type || 'national_id')
  const [notes, setNotes] = useState(stored.notes || '')
  const [photoPreview, setPhotoPreview] = useState(null)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    setIdNumber(stored.id_number || booking?.customers?.id_number || '')
    setIdType(stored.id_type || 'national_id')
    setNotes(stored.notes || '')
    setPhotoPreview(null)
    setLocalError('')
  }, [step?.id, stored.id_number, stored.id_type, stored.notes, booking?.customers?.id_number])

  const handlePhoto = async (file) => {
    setLocalError('')
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      setPhotoPreview(dataUrl)
    } catch (e) {
      setLocalError(e?.message || 'Could not prepare photo')
    }
  }

  const handleDone = async () => {
    setLocalError('')
    if (key === 'id_capture') {
      if (!String(idNumber || '').trim()) {
        setLocalError('Enter the guest ID / passport number before marking this step done.')
        return
      }
      await onComplete(step.id, {
        id_number: String(idNumber).trim(),
        id_type: idType,
        notes: String(notes || '').trim() || null,
        photo_attached: Boolean(photoPreview),
        captured_at: new Date().toISOString()
      }, { idPhoto: photoPreview })
      return
    }
    if (key === 'registration_card' || key === 'deposit_check' || key === 'room_assignment' || key === 'signature' || key === 'key_handoff') {
      await onComplete(step.id, {
        notes: String(notes || '').trim() || null,
        confirmed_at: new Date().toISOString()
      })
      return
    }
    await onComplete(step.id, {
      notes: String(notes || '').trim() || null,
      confirmed_at: new Date().toISOString()
    })
  }

  return (
    <div className={`rounded-lg border p-3 ${done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {done
            ? <CheckCircle size={18} className="mt-0.5 shrink-0 text-green-600" />
            : <ClipboardCheck size={18} className="mt-0.5 shrink-0 text-gray-400" />}
          <div className="min-w-0">
            <p className={`text-sm font-medium ${done ? 'text-green-700' : 'text-gray-700'}`}>
              {step.step_label || step.step_key || 'Step'}
              {step.required ? <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700">Required</span> : <span className="ml-1 text-[10px] uppercase text-gray-400">Optional</span>}
            </p>
            <p className="text-xs text-gray-400">{step.step_key}</p>
            {done && step.completed_at ? (
              <p className="mt-1 text-xs text-green-700/80">Marked done {formatWhen(step.completed_at)}</p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">
          {done ? (
            <button
              type="button"
              onClick={() => onReset(step.id)}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50"
            >
              <RotateCcw size={12} /> Reset
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDone}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
            >
              <CheckCircle size={12} /> Done
            </button>
          )}
        </div>
      </div>

      {/* ID capture — real fields wired to backend + guest record */}
      {key === 'id_capture' && !done ? (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">
            Saves the ID <strong>number</strong> on the guest profile and checklist. Optional photo is stored on the guest record (same as Guests → ID photo), not as a separate checklist file.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-500">ID / passport number</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                placeholder="e.g. 123456789"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Document type</label>
              <select
                value={idType}
                onChange={(e) => setIdType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="national_id">National ID</option>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver’s licence</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              placeholder="Verified against document"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">ID photo (optional)</label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                <ImageIcon size={12} />
                {photoPreview ? 'Change photo' : 'Attach photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhoto(e.target.files?.[0])}
                />
              </label>
              {photoPreview ? (
                <img src={photoPreview} alt="ID preview" className="h-14 rounded border border-gray-200 object-cover" />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {key === 'id_capture' && done ? (
        <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-gray-600">
          <div>ID number: <span className="font-medium text-gray-800">{stored.id_number || '—'}</span></div>
          <div>Type: <span className="font-medium text-gray-800">{stored.id_type || '—'}</span></div>
          {stored.photo_attached ? <div className="text-green-700">Photo was attached to the guest profile</div> : <div className="text-gray-400">No photo attached on this step</div>}
          {stored.notes ? <div>Notes: {stored.notes}</div> : null}
        </div>
      ) : null}

      {/* Simple notes for other incomplete steps */}
      {!done && key !== 'id_capture' ? (
        <div className="mt-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
            placeholder="Optional note for this step"
          />
        </div>
      ) : null}

      {done && key !== 'id_capture' && stored.notes ? (
        <p className="mt-2 text-xs text-gray-500">Note: {stored.notes}</p>
      ) : null}

      {localError ? <p className="mt-2 text-xs text-red-600">{localError}</p> : null}
    </div>
  )
}

function ConfigPanel({ config, onUpdate, loading, open, onToggle }) {
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
      required_steps: requiredSteps.split(',').map((s) => s.trim()).filter(Boolean),
      optional_steps: optionalSteps.split(',').map((s) => s.trim()).filter(Boolean)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Settings size={15} /> Desk rules
        </span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3">
          <p className="text-xs text-gray-500">These steps appear on every arrival and departure checklist.</p>
          <div>
            <label className="text-xs font-medium text-gray-500">Required steps</label>
            <input
              type="text"
              value={requiredSteps}
              onChange={(e) => setRequiredSteps(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="id_capture, registration_card, deposit_check"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">Optional steps</label>
            <input
              type="text"
              value={optionalSteps}
              onChange={(e) => setOptionalSteps(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="signature, key_handoff"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['require_id_capture', 'ID capture', true],
              ['require_registration_card', 'Registration card', true],
              ['require_deposit_check', 'Deposit check', true],
              ['require_room_assignment', 'Room assignment', true],
              ['require_signature', 'Signature', false],
              ['require_key_handoff', 'Key handoff', false]
            ].map(([cfgKey, label, defaultOn]) => (
              <label key={cfgKey} className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={defaultOn ? config?.[cfgKey] !== false : config?.[cfgKey] === true}
                  onChange={(e) => onUpdate({ ...config, [cfgKey]: e.target.checked })}
                  className="rounded"
                />
                {label}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save rules'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function BoardRow({ booking, active, tab, currency, onSelect }) {
  const balance = balanceDue(booking)
  return (
    <button
      type="button"
      onClick={() => onSelect(booking)}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
        active
          ? 'border-emerald-400 bg-emerald-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className={`rounded-lg p-2 ${tab === 'checkin' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
        {tab === 'checkin' ? <LogIn size={16} /> : <LogOut size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-gray-900">{guestName(booking)}</p>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {statusLabel(booking.status)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-500">
          {roomLabel(booking)} · {stayDates(booking)}
          {booking.customer_phone ? ` · ${booking.customer_phone}` : ''}
        </p>
        {balance > 0 ? (
          <p className="mt-0.5 text-xs font-medium text-amber-700">
            Balance {currency}{balance.toLocaleString()}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-gray-400">Balance settled</p>
        )}
      </div>
      <ChevronRight size={16} className="shrink-0 text-gray-400" />
    </button>
  )
}

export default function CheckinWorkflow() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('checkin')
  const [board, setBoard] = useState([])
  const [selected, setSelected] = useState(null)
  const [checklist, setChecklist] = useState(null)
  const [config, setConfig] = useState(null)
  const [query, setQuery] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [boardLoading, setBoardLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [boardWarnings, setBoardWarnings] = useState([])
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)

  const loadBoard = useCallback(async () => {
    setBoardLoading(true)
    setError('')
    setBoardWarnings([])
    try {
      if (tab === 'checkin') {
        if (!window.api?.hotel?.getArrivals) throw new Error('Arrivals API is not available')
        const arrivals = await window.api.hotel.getArrivals()
        setBoard(
          (Array.isArray(arrivals) ? arrivals : [])
            .filter((b) => !isAlreadyIn(b) && !isAlreadyOut(b))
            .sort((a, b) => guestName(a).localeCompare(guestName(b)))
        )
      } else {
        const warn = []
        const settle = async (label, promise) => {
          try {
            return await promise
          } catch (e) {
            warn.push(`${label}: ${e?.message || 'failed'}`)
            return null
          }
        }
        if (!window.api?.hotel?.getDepartures && !window.api?.hotel?.getInHouse) {
          throw new Error('Departures API is not available')
        }
        const [departures, inHouse] = await Promise.all([
          window.api?.hotel?.getDepartures
            ? settle('Departures', window.api.hotel.getDepartures())
            : Promise.resolve(null),
          window.api?.hotel?.getInHouse
            ? settle('In-house', window.api.hotel.getInHouse())
            : Promise.resolve(null)
        ])
        if (warn.length && departures == null && inHouse == null) {
          setError(warn.join(' · ') || 'Could not load the departure board.')
          setBoard([])
          return
        }
        setBoardWarnings(warn)
        const byId = new Map()
        for (const row of [...(Array.isArray(departures) ? departures : []), ...(Array.isArray(inHouse) ? inHouse : [])]) {
          if (!row?.id) continue
          if (!isAlreadyIn(row) || isAlreadyOut(row)) continue
          byId.set(row.id, row)
        }
        const todayKey = localToday()
        setBoard(
          Array.from(byId.values()).sort((a, b) => {
            const aDue = String(a.check_out || '') === todayKey ? 0 : 1
            const bDue = String(b.check_out || '') === todayKey ? 0 : 1
            if (aDue !== bDue) return aDue - bDue
            return guestName(a).localeCompare(guestName(b))
          })
        )
      }
    } catch (e) {
      setError(e?.message || 'Could not load the front desk board.')
      setBoard([])
    } finally {
      setBoardLoading(false)
    }
  }, [tab])

  const loadConfig = useCallback(async () => {
    try {
      const result = await window.api?.checkinWorkflow?.getConfig?.()
      setConfig(result?.config || result || null)
      if (result?.warning) {
        setBoardWarnings((prev) => [...prev, `Config: ${result.warning}`])
      }
    } catch (e) {
      setBoardWarnings((prev) => [...prev, `Config: ${e?.message || 'could not load desk rules'}`])
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    setSelected(null)
    setChecklist(null)
    setSuccess('')
    setQuery('')
    loadBoard()
  }, [loadBoard])

  const filteredBoard = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return board
    return board.filter((b) => {
      const haystack = [
        guestName(b),
        b.room_number,
        b.rooms?.room_number,
        b.customer_phone,
        b.customers?.phone,
        b.id,
        b.status
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [board, query])

  const loadChecklistFor = async (booking) => {
    if (!booking?.id) return
    setActionLoading(true)
    setError('')
    setSuccess('')
    setShowOverride(false)
    setOverrideReason('')
    setSelected(booking)
    setChecklist(null)
    try {
      const fn = tab === 'checkin'
        ? window.api?.checkinWorkflow?.getChecklist
        : window.api?.checkoutWorkflow?.getChecklist
      if (!fn) throw new Error('Checklist API is not available')
      const result = await fn(booking.id)
      const items = Array.isArray(result?.items)
        ? result.items.map((item) => ({
            ...item,
            completed: item?.completed === true,
            required: item?.required === true
          }))
        : []
      setChecklist({ ...result, items })
      if (result?.warning || result?.stale) {
        setError(result.warning || 'Showing cached checklist — live server data may differ.')
      }
    } catch (e) {
      setError(e?.message || 'Checklist could not load.')
      // Do not fake an empty successful checklist
      setChecklist(null)
    } finally {
      setActionLoading(false)
    }
  }

  const refreshChecklist = async () => {
    if (!selected?.id) return
    try {
      const fn = tab === 'checkin'
        ? window.api?.checkinWorkflow?.getChecklist
        : window.api?.checkoutWorkflow?.getChecklist
      const result = await fn?.(selected.id)
      const items = Array.isArray(result?.items)
        ? result.items.map((item) => ({ ...item, completed: item?.completed === true }))
        : []
      setChecklist({ ...result, items })
    } catch (e) {
      setError(e?.message || 'Checklist could not refresh.')
    }
  }

  const handleCompleteStep = async (stepId, data = null, extras = {}) => {
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      const fn = tab === 'checkin'
        ? window.api?.checkinWorkflow?.completeStep
        : window.api?.checkoutWorkflow?.completeStep
      await fn?.(stepId, null, data)

      // Persist guest ID number / photo when completing id capture
      const customerId = selected?.customer_id || selected?.customers?.id
      if (data?.id_number && customerId && window.api?.customers) {
        try {
          const existing = selected?.customers || {}
          await window.api.customers.update(customerId, {
            name: existing.name || guestName(selected),
            email: existing.email || selected?.customer_email || '',
            phone: existing.phone || selected?.customer_phone || '',
            id_number: data.id_number,
            nationality: existing.nationality || ''
          })
        } catch (customerErr) {
          // Step is already saved; surface guest-profile write issues without blocking checklist
          setError(`Checklist saved, but guest profile update failed: ${customerErr?.message || customerErr}`)
        }
        if (extras?.idPhoto) {
          try {
            await window.api.customers.updateIdPhoto(customerId, extras.idPhoto)
          } catch (photoErr) {
            setError(`Checklist saved, but ID photo failed: ${photoErr?.message || photoErr}`)
          }
        }
      }

      setSuccess('Step saved on the server')
      await refreshChecklist()
    } catch (e) {
      setError(e?.message || 'Could not complete step.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleResetStep = async (stepId) => {
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      const fn = tab === 'checkin'
        ? window.api?.checkinWorkflow?.resetStep
        : window.api?.checkoutWorkflow?.resetStep
      await fn?.(stepId)
      setSuccess('Step reset on the server')
      await refreshChecklist()
    } catch (e) {
      setError(e?.message || 'Could not reset step.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleResetAll = async () => {
    const items = checklist?.items || []
    const doneItems = items.filter(isStepDone)
    if (doneItems.length === 0) {
      setSuccess('No completed steps to reset')
      return
    }
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      const fn = tab === 'checkin'
        ? window.api?.checkinWorkflow?.resetStep
        : window.api?.checkoutWorkflow?.resetStep
      for (const step of doneItems) {
        await fn?.(step.id)
      }
      setSuccess(`Reset ${doneItems.length} step${doneItems.length === 1 ? '' : 's'}`)
      await refreshChecklist()
    } catch (e) {
      setError(e?.message || 'Could not reset all steps.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleFinalAction = async () => {
    if (!selected?.id) return
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      if (tab === 'checkin') {
        const result = await window.api?.checkinWorkflow?.completeHotelCheckin?.(selected.id)
        setSuccess(`Checked in. Guest folio ${result?.folio_id || 'created'}.`)
      } else {
        await window.api?.checkoutWorkflow?.completeHotelCheckout?.(selected.id)
        setSuccess('Checked out. Room sent to housekeeping and open folios closed.')
      }
      setSelected(null)
      setChecklist(null)
      setShowOverride(false)
      setOverrideReason('')
      await loadBoard()
    } catch (e) {
      setError(e?.message || `Could not complete ${tab === 'checkin' ? 'check-in' : 'check-out'}.`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleManagerOverrideCheckin = async () => {
    if (!selected?.id) return
    const reason = String(overrideReason || '').trim()
    if (!reason) {
      setError('Manager override requires a reason for the audit trail.')
      return
    }
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      const result = await window.api?.checkinWorkflow?.completeHotelCheckinWithOverride?.(
        selected.id,
        reason
      )
      setSuccess(
        `Checked in with manager override. Guest folio ${result?.folio_id || 'created'}. Reason recorded on checklist steps.`
      )
      setSelected(null)
      setChecklist(null)
      setShowOverride(false)
      setOverrideReason('')
      await loadBoard()
    } catch (e) {
      setError(e?.message || 'Manager override check-in failed.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUpdateConfig = async (newConfig) => {
    setActionLoading(true)
    setError('')
    setSuccess('')
    try {
      await window.api?.checkinWorkflow?.updateConfig?.(newConfig)
      setConfig(newConfig)
      setSuccess('Desk rules saved')
      await loadConfig()
    } catch (e) {
      setError(e?.message || 'Could not save desk rules.')
    } finally {
      setActionLoading(false)
    }
  }

  const ready =
    tab === 'checkin'
      ? checklist?.ready_to_check_in === true
      : checklist?.ready_to_check_out === true

  const completedCount = (checklist?.items || []).filter(isStepDone).length
  const totalCount = (checklist?.items || []).length
  const preArrival = checklist?.pre_arrival || checklist?.readiness || null
  const balanceEstimate = preArrival?.balance_due_estimate != null
    ? Number(preArrival.balance_due_estimate)
    : balanceDue(selected || {})

  const title = tab === 'checkin' ? 'Arrivals' : 'Departures'
  const emptyTitle = tab === 'checkin' ? 'No arrivals waiting' : 'No departures waiting'
  const emptyHint = tab === 'checkin'
    ? 'Guests due to arrive today will show here. Already checked-in stays are hidden.'
    : 'In-house guests and today’s departures show here. Already checked-out stays are hidden.'

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Check-in / Check-out</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Front desk board — pick a guest, complete the checklist, finish the stay action.
          </p>
        </div>
        <button
          type="button"
          onClick={loadBoard}
          disabled={boardLoading || actionLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={boardLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {boardWarnings.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Partial board load: {boardWarnings.join(' · ')}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ {success}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('checkin')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === 'checkin' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <LogIn size={15} /> Arrivals
          <span className={`rounded-full px-1.5 py-0.5 text-xs ${tab === 'checkin' ? 'bg-white/20' : 'bg-white text-gray-500'}`}>
            {tab === 'checkin' ? board.length : '·'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('checkout')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === 'checkout' ? 'bg-amber-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <LogOut size={15} /> Departures
          <span className={`rounded-full px-1.5 py-0.5 text-xs ${tab === 'checkout' ? 'bg-white/20' : 'bg-white text-gray-500'}`}>
            {tab === 'checkout' ? board.length : '·'}
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title.toLowerCase()} by guest, room, phone…`}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-2">
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
              <span className="text-xs text-gray-400">
                {boardLoading ? 'Loading…' : `${filteredBoard.length} guest${filteredBoard.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {boardLoading && board.length === 0 ? (
              <div className="rounded-lg bg-white px-4 py-10 text-center text-sm text-gray-400">Loading board…</div>
            ) : filteredBoard.length === 0 ? (
              <div className="rounded-lg bg-white px-4 py-10 text-center">
                <BedDouble size={22} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">{emptyTitle}</p>
                <p className="mt-1 text-xs text-gray-400">{emptyHint}</p>
              </div>
            ) : (
              <div className="max-h-[62vh] space-y-2 overflow-y-auto p-1">
                {filteredBoard.map((booking) => (
                  <BoardRow
                    key={booking.id}
                    booking={booking}
                    active={selected?.id === booking.id}
                    tab={tab}
                    currency={currency}
                    onSelect={loadChecklistFor}
                  />
                ))}
              </div>
            )}
          </div>

          <ConfigPanel
            config={config}
            onUpdate={handleUpdateConfig}
            loading={actionLoading}
            open={showConfig}
            onToggle={() => setShowConfig((v) => !v)}
          />
        </section>

        <section className="lg:col-span-3">
          {!selected ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <div className="mb-3 rounded-full bg-gray-100 p-3 text-gray-400">
                <User size={22} />
              </div>
              <p className="text-sm font-semibold text-gray-700">Select a guest from the board</p>
              <p className="mt-1 max-w-sm text-xs text-gray-400">
                Their checklist and {tab === 'checkin' ? 'check-in' : 'check-out'} button will open here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <button
                    type="button"
                    onClick={() => { setSelected(null); setChecklist(null); setSuccess('') }}
                    className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
                  >
                    <ArrowLeft size={12} /> Back to board
                  </button>
                  <h2 className="text-lg font-bold text-gray-900">{guestName(selected)}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {roomLabel(selected)} · {stayDates(selected)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
                      {statusLabel(selected.status)}
                    </span>
                    {selected.customer_phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={12} /> {selected.customer_phone}
                      </span>
                    ) : null}
                    {balanceDue(selected) > 0 ? (
                      <span className="font-medium text-amber-700">
                        Due {currency}{balanceDue(selected).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => loadChecklistFor(selected)}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={actionLoading ? 'animate-spin' : ''} />
                    Reload
                  </button>
                  {completedCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleResetAll}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> Reset all steps
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                Checklist progress is saved on the server for this booking ({completedCount}/{totalCount || 0} done).
                If steps show done from earlier testing, use <strong>Reset</strong> or <strong>Reset all steps</strong>.
              </div>

              {/* Pre-arrival / departure validation panel */}
              {preArrival ? (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-700">
                  <p className="text-sm font-semibold text-gray-800">
                    {tab === 'checkin' ? 'Pre-arrival validation' : 'Departure validation'}
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <p>
                      Room:{' '}
                      <span className="font-medium">
                        {preArrival.room_number ? `Room ${preArrival.room_number}` : 'Unassigned'}
                      </span>
                      {preArrival.housekeeping_status
                        ? ` · HK ${String(preArrival.housekeeping_status).replace(/_/g, ' ')}`
                        : ''}
                    </p>
                    <p>
                      Balance estimate:{' '}
                      <span className={`font-medium ${balanceEstimate > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {currency}{Number(balanceEstimate || 0).toLocaleString()}
                      </span>
                      <span className="ml-1 text-gray-400">
                        ({preArrival.balance_source || 'booking_ledger_estimate'})
                      </span>
                    </p>
                    {preArrival.deposit_amount > 0 ? (
                      <p>
                        Deposit on file (estimate):{' '}
                        <span className="font-medium">
                          {currency}{Number(preArrival.deposit_amount).toLocaleString()}
                        </span>
                      </p>
                    ) : null}
                    <p>
                      Room readiness:{' '}
                      <span className={`font-medium ${preArrival.room_ready ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {preArrival.room_ready ? 'Ready' : 'Not ready'}
                      </span>
                    </p>
                  </div>
                  {(preArrival.messaging || []).filter((m) => m.level === 'blocker' || m.level === 'warn').map((m) => (
                    <p key={`${m.code}-${m.message}`} className={m.level === 'blocker' ? 'font-medium text-red-700' : 'text-amber-800'}>
                      {m.level === 'blocker' ? 'Blocker: ' : 'Note: '}{m.message}
                    </p>
                  ))}
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">
                  {tab === 'checkin' ? 'Check-in checklist' : 'Check-out checklist'}
                </h3>
                {actionLoading && !checklist ? (
                  <p className="py-8 text-center text-sm text-gray-400">Loading checklist…</p>
                ) : !checklist ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center">
                    <p className="text-sm text-red-700">Checklist failed to load.</p>
                    <p className="mt-1 text-xs text-red-600/80">
                      Fix the error above and reload — this is not an empty success state.
                    </p>
                  </div>
                ) : (checklist.items || []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                    <p className="text-sm text-gray-600">No checklist steps for this booking yet.</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Set desk rules below the board, then reload the checklist.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {checklist.items.map((step) => (
                      <StepItem
                        key={step.id}
                        step={step}
                        booking={selected}
                        onComplete={handleCompleteStep}
                        onReset={handleResetStep}
                        loading={actionLoading}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
                {!ready ? (
                  <p className="mb-3 text-xs text-amber-700">
                    {tab === 'checkin'
                      ? 'Complete all required steps before final check-in, or use manager override with a reason.'
                      : 'Complete required steps and settle open folio balances before final check-out.'}
                  </p>
                ) : null}
                {preArrival && !preArrival.room_ready && tab === 'checkin' ? (
                  <p className="mb-3 text-xs text-red-700">
                    Room is not housekeeping-ready. Prefer resolving housekeeping before check-in; override only if policy allows.
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={actionLoading || !ready || !checklist}
                  onClick={handleFinalAction}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${
                    tab === 'checkin'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-amber-700 hover:bg-amber-800'
                  }`}
                >
                  {actionLoading
                    ? 'Working…'
                    : tab === 'checkin'
                      ? 'Complete check-in'
                      : 'Complete check-out'}
                </button>

                {tab === 'checkin' && checklist && !ready ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                    <button
                      type="button"
                      onClick={() => setShowOverride((v) => !v)}
                      className="text-xs font-semibold text-amber-900 underline"
                    >
                      {showOverride ? 'Hide manager override' : 'Manager override (requires reason)'}
                    </button>
                    {showOverride ? (
                      <>
                        <p className="text-[11px] text-amber-900/80">
                          Completes remaining required steps via the existing step RPC with an audit reason,
                          then runs server check-in. Does not invent payment status or skip folio creation.
                        </p>
                        <input
                          type="text"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                          placeholder="Override reason (required for audit)"
                        />
                        <button
                          type="button"
                          disabled={actionLoading || !String(overrideReason || '').trim()}
                          onClick={handleManagerOverrideCheckin}
                          className="w-full rounded-xl border border-amber-700 bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                        >
                          {actionLoading ? 'Working…' : 'Override & complete check-in'}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
