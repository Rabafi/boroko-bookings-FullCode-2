import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, UserX, Clock, ChevronDown, ChevronUp, Camera, X, Pencil, Plus, RefreshCw, CreditCard } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { useAccess, useSettings } from '../app-context'
import { canAccessCapability } from '../../../shared/accessControl'

const emptyGuestForm = {
  name: '',
  phone: '',
  email: '',
  id_number: '',
  nationality: ''
}

async function loadCreditSummaryRows() {
  const rows = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await window.api.customerCredit.getSummary(null, 100, offset).catch(() => [])
    if (!Array.isArray(page) || page.length === 0) break
    rows.push(...page)
    if (page.length < 100) break
  }
  return rows
}

export default function Guests() {
  const navigate = useNavigate()
  const access = useAccess()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const canManageGuests = canAccessCapability(access, 'guests.manage')

  const [customers, setCustomers] = useState([])
  const [creditSummary, setCreditSummary] = useState([])
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all') // all | active | blacklisted
  const [sortBy, setSortBy]       = useState('created_desc')

  // History panel
  const [historyCustomer, setHistoryCustomer] = useState(null)
  const [history, setHistory]                 = useState([])
  const [historyLoading, setHistoryLoading]   = useState(false)
  const [expandedId, setExpandedId]           = useState(null)

  // Blacklist modal
  const [blacklistTarget, setBlacklistTarget] = useState(null) // { customer, removing }
  const [blacklistReason, setBlacklistReason] = useState('')
  const [blacklistLoading, setBlacklistLoading] = useState(false)

  // ID Photo
  const [photoCustomer, setPhotoCustomer] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoSaving, setPhotoSaving] = useState(false)
  const photoInputRef = useRef(null)

  // Guest form
  const [guestModalOpen, setGuestModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [guestForm, setGuestForm] = useState(emptyGuestForm)
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestError, setGuestError] = useState('')

  const openPhotoModal = (customer) => {
    setPhotoCustomer(customer)
    setPhotoPreview(customer.id_photo || null)
  }

  const handlePhotoFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const MIN_W = 200
        const MIN_H = 200
        if (img.width < MIN_W || img.height < MIN_H) {
          window.alert(`ID photo is too small. Minimum size is ${MIN_W}x${MIN_H}px. Your image is ${img.width}x${img.height}px.`)
          return
        }
        const MAX = 600
        const canvas = document.createElement('canvas')
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        setPhotoPreview(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const savePhoto = async () => {
    setPhotoSaving(true)
    await window.api.customers.updateIdPhoto(photoCustomer.id, photoPreview).catch(console.error)
    setPhotoSaving(false)
    setPhotoCustomer(null)
    loadCustomers()
  }

  const [loading, setLoading] = useState(false)

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    const [data, creditRows] = await Promise.all([
      window.api.customers.getAll(),
      loadCreditSummaryRows()
    ])
    setCustomers(data || [])
    setCreditSummary(Array.isArray(creditRows) ? creditRows : [])
    setLoading(false)
  }, [])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  const closeGuestModal = () => {
    setGuestModalOpen(false)
    setEditingCustomer(null)
    setGuestForm(emptyGuestForm)
    setGuestError('')
    setGuestSaving(false)
  }

  const openCreateGuest = () => {
    setEditingCustomer(null)
    setGuestForm(emptyGuestForm)
    setGuestError('')
    setGuestModalOpen(true)
  }

  const openEditGuest = (customer) => {
    setEditingCustomer(customer)
    setGuestForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      id_number: customer.id_number || '',
      nationality: customer.nationality || ''
    })
    setGuestError('')
    setGuestModalOpen(true)
  }

  const openGuestPrepayments = (customer, openReceive = false) => {
    navigate('/prepayments', {
      state: {
        customerId: customer.id,
        openReceive
      }
    })
  }

  const handleGuestFormChange = (field, value) => {
    setGuestForm((current) => ({ ...current, [field]: value }))
  }

  const handleGuestSubmit = async (event) => {
    event.preventDefault()
    if (!guestForm.name.trim()) {
      setGuestError('Guest name is required.')
      return
    }

    setGuestSaving(true)
    setGuestError('')
    try {
      const payload = {
        name: guestForm.name.trim(),
        phone: guestForm.phone.trim(),
        email: guestForm.email.trim().toLowerCase(),
        id_number: guestForm.id_number.trim(),
        nationality: guestForm.nationality.trim()
      }

      const result = editingCustomer
        ? await window.api.customers.update(editingCustomer.id, payload)
        : await window.api.customers.create(payload)

      if (!result?.success) {
        throw new Error(result?.error || `Could not ${editingCustomer ? 'update' : 'create'} guest.`)
      }

      closeGuestModal()
      await loadCustomers()
    } catch (error) {
      setGuestError(error?.message || 'Could not save guest details.')
    } finally {
      setGuestSaving(false)
    }
  }

  const toggleHistory = async (customer) => {
    if (expandedId === customer.id) {
      setExpandedId(null)
      setHistory([])
      return
    }
    setExpandedId(customer.id)
    setHistoryLoading(true)
    try {
      const data = await window.api.customers.getBookings(customer.id)
      setHistory(data || [])
    } catch (e) {
      console.error('Failed to load history:', e)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const openBlacklist = (customer) => {
    setBlacklistTarget({ customer, removing: !!customer.is_blacklisted })
    setBlacklistReason(customer.blacklist_reason || '')
  }

  const handleBlacklist = async (e) => {
    e.preventDefault()
    setBlacklistLoading(true)
    const { customer, removing } = blacklistTarget
    await window.api.customers.updateBlacklist(
      customer.id,
      !removing,
      removing ? '' : blacklistReason
    )
    setBlacklistTarget(null)
    setBlacklistReason('')
    setBlacklistLoading(false)
    loadCustomers()
  }

  const filtered = useMemo(() => {
    const normalizedSearch = search.toLowerCase()
    const creditByCustomer = new Map(creditSummary.map((row) => [row.customer_id, Number(row.balance || 0)]))
    return [...customers.filter((c) => {
      const matchSearch =
        !search ||
        c.name?.toLowerCase().includes(normalizedSearch) ||
        c.phone?.includes(search) ||
        c.email?.toLowerCase().includes(normalizedSearch)
      const matchFilter =
        filter === 'all' ||
        (filter === 'blacklisted' && c.is_blacklisted) ||
        (filter === 'active' && !c.is_blacklisted)
      return matchSearch && matchFilter
    }).map((customer) => {
      return {
        ...customer,
        credit_balance: creditByCustomer.get(customer.id) || 0
      }
    })].sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return String(a.name || '').localeCompare(String(b.name || ''))
        case 'name_desc':
          return String(b.name || '').localeCompare(String(a.name || ''))
        case 'blacklisted_first':
          if (!!a.is_blacklisted !== !!b.is_blacklisted) return a.is_blacklisted ? -1 : 1
          return String(a.name || '').localeCompare(String(b.name || ''))
        case 'created_asc':
          return String(a.created_at || '').localeCompare(String(b.created_at || ''))
        case 'created_desc':
        default:
          return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      }
    })
  }, [creditSummary, customers, filter, search, sortBy])

  const blacklistedCount = useMemo(
    () => customers.filter((c) => c.is_blacklisted).length,
    [customers]
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Guest Records</p>
          <h1 className="bb-page-header-title mt-2">Guests</h1>
          <p className="bb-page-header-subtitle">
            {customers.length} total · {blacklistedCount} blacklisted
          </p>
        </div>
        {canManageGuests && (
          <button type="button" onClick={openCreateGuest} className="btn-primary inline-flex items-center gap-2 self-start">
            <Plus size={15} />
            New Guest
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bb-filter-bar">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-9"
            placeholder="Search by name, phone or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm">
          {[['all', 'All'], ['active', 'Active'], ['blacklisted', 'Blacklisted']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-2 transition-colors ${
                filter === v ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          className="input w-auto min-w-[170px]"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="created_desc">Newest added</option>
          <option value="created_asc">Oldest added</option>
          <option value="name_asc">Name A-Z</option>
          <option value="name_desc">Name Z-A</option>
          <option value="blacklisted_first">Blacklisted first</option>
        </select>
      </div>

      {/* Table */}
      <div className="bb-table-shell">
        <HorizontalScrollArea>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left">Guest</th>
              <th className="px-5 py-3 text-left">Phone</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">ID / Passport</th>
              <th className="px-5 py-3 text-left">Nationality</th>
              <th className="px-5 py-3 text-right">Credit</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">ID Photo</th>
              <th className="px-5 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <Fragment key={c.id}>
                <tr key={c.id} className={`hover:bg-slate-50 ${c.is_blacklisted ? 'bg-red-50/40' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{c.name}</p>
                    {c.is_blacklisted && c.blacklist_reason && (
                      <p className="text-xs text-red-500 mt-0.5">⚠ {c.blacklist_reason}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.phone || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.email || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.id_number || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.nationality || '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      Number(c.credit_balance || 0) > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {currency} {Number(c.credit_balance || 0).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {c.is_blacklisted ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        🚫 Blacklisted
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        ✅ Active
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {c.id_photo ? (
                      <button onClick={() => openPhotoModal(c)}>
                        <img
                          src={c.id_photo}
                          alt="ID"
                          className="h-10 w-10 rounded-xl border border-slate-200 object-cover transition-opacity hover:opacity-80"
                          data-no-invert
                        />
                      </button>
                    ) : (
                      <button
                        onClick={() => openPhotoModal(c)}
                        className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-blue-600"
                      >
                        <Camera size={14} /> Add
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditGuest(c)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canManageGuests}
                        title={!canManageGuests ? 'You do not have permission to edit guest records.' : 'Edit guest'}
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        onClick={() => toggleHistory(c)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
                      >
                        <Clock size={12} />
                        History
                        {expandedId === c.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <button
                        onClick={() => openGuestPrepayments(c, true)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-50"
                        title="Add prepayment for this guest"
                      >
                        <CreditCard size={12} />
                        Prepay
                      </button>
                      <button
                        onClick={() => openGuestPrepayments(c, false)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-50"
                        title="View this guest's credit ledger"
                      >
                        <CreditCard size={12} />
                        Ledger
                      </button>
                      <button
                        onClick={() => openBlacklist(c)}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
                          c.is_blacklisted
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-red-500 hover:bg-red-50'
                        }`}
                      >
                        <UserX size={12} />
                        {c.is_blacklisted ? 'Unblacklist' : 'Blacklist'}
                      </button>
                    </div>
                  </td>
                </tr>

                {/* History expansion row */}
                {expandedId === c.id && (
                  <tr key={`${c.id}-history`}>
                    <td colSpan={9} className="border-b border-blue-100 bg-blue-50/40 px-5 py-3">
                      <p className="mb-2 text-xs font-semibold text-blue-700">
                        Booking history for {c.name}
                      </p>
                      {historyLoading ? (
                        <p className="text-xs text-slate-400">Loading booking history for this guest…</p>
                      ) : history.length === 0 ? (
                        <div className="bb-empty-state min-h-[120px] py-6">
                          <p className="text-sm text-slate-500">No bookings found for this guest.</p>
                        </div>
                      ) : (
                        <div className="bb-card-muted overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left pr-4 py-1">Room</th>
                              <th className="text-left pr-4 py-1">Check In</th>
                              <th className="text-left pr-4 py-1">Check Out</th>
                              <th className="text-left pr-4 py-1">Status</th>
                              <th className="text-left pr-4 py-1">Payment</th>
                              <th className="text-right py-1">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((b) => (
                              <tr key={b.id} className="border-t border-blue-100">
                                <td className="py-1 pr-4 text-slate-700">Room {b.room_number}</td>
                                <td className="py-1 pr-4 text-slate-600">{b.check_in}</td>
                                <td className="py-1 pr-4 text-slate-600">{b.check_out}</td>
                                <td className="py-1 pr-4 capitalize text-slate-600">{b.status?.replace('_', ' ')}</td>
                                <td className="py-1 pr-4 capitalize text-slate-600">{b.payment_status || 'unpaid'}</td>
                                <td className="py-1 text-right font-medium text-slate-800">
                                  {currency} {Number(b.total_amount || 0).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {loading && customers.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-10">
                  <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
                    <RefreshCw size={16} className="animate-spin" />
                    Loading guests…
                  </div>
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-10">
                  <div className="bb-empty-state py-10">
                    <p className="text-base font-semibold text-slate-800">No guests found</p>
                    <p className="text-sm text-slate-500">Try adjusting the search or guest status filter.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </HorizontalScrollArea>
      </div>

      {guestModalOpen && (
        <Modal
          title={editingCustomer ? `Edit Guest — ${editingCustomer.name}` : 'Add Guest'}
          onClose={closeGuestModal}
          size="md"
        >
          <form onSubmit={handleGuestSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Guest Name *</label>
                <input
                  className="input"
                  value={guestForm.name}
                  onChange={(event) => handleGuestFormChange('name', event.target.value)}
                  placeholder="Guest full name"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
                <input
                  className="input"
                  value={guestForm.phone}
                  onChange={(event) => handleGuestFormChange('phone', event.target.value)}
                  placeholder="+267 ..."
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  className="input"
                  value={guestForm.email}
                  onChange={(event) => handleGuestFormChange('email', event.target.value)}
                  placeholder="guest@email.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">ID / Passport</label>
                <input
                  className="input"
                  value={guestForm.id_number}
                  onChange={(event) => handleGuestFormChange('id_number', event.target.value)}
                  placeholder="Passport or ID number"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nationality</label>
                <input
                  className="input"
                  value={guestForm.nationality}
                  onChange={(event) => handleGuestFormChange('nationality', event.target.value)}
                  placeholder="Nationality"
                />
              </div>
            </div>
            {guestError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {guestError}
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={closeGuestModal} className="btn-secondary flex-1" disabled={guestSaving}>
                Cancel
              </button>
              <button type="submit" className="btn-primary flex-1" disabled={guestSaving}>
                {guestSaving ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Create Guest'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ID Photo modal */}
      {photoCustomer && (
        <Modal
          title={`ID Photo — ${photoCustomer.name}`}
          onClose={() => setPhotoCustomer(null)}
          size="sm"
        >
          <div className="space-y-4">
            {photoPreview ? (
              <div className="relative group w-full">
                <img
                  src={photoPreview}
                  alt="ID Photo"
                  className="w-full max-h-64 rounded-xl border border-slate-200 object-contain"
                  data-no-invert
                />
                <button
                  onClick={() => setPhotoPreview(null)}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => photoInputRef.current?.click()}
                className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center transition-colors hover:border-green-400 hover:bg-green-50"
              >
                <Camera size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-500">Click to upload ID / Passport photo</p>
                <p className="mt-1 text-xs text-slate-400">JPG, PNG — will be resized automatically</p>
              </div>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePhotoFile(e.target.files[0])}
            />
            {!photoPreview && (
              <button onClick={() => photoInputRef.current?.click()} className="btn-secondary w-full flex items-center justify-center gap-2">
                <Camera size={15} /> Choose Photo
              </button>
            )}
            <div className="flex gap-3">
              <button onClick={() => setPhotoCustomer(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={savePhoto}
                disabled={photoSaving || photoPreview === photoCustomer.id_photo}
                className="btn-primary flex-1"
              >
                {photoSaving ? 'Saving...' : photoPreview ? 'Save Photo' : 'Remove Photo'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Blacklist modal */}
      {blacklistTarget && (
        <Modal
          title={blacklistTarget.removing ? 'Remove from Blacklist' : '🚫 Blacklist Guest'}
          onClose={() => setBlacklistTarget(null)}
          size="sm"
        >
          <form onSubmit={handleBlacklist} className="space-y-4">
            <div className={`rounded-xl p-3 text-sm ${blacklistTarget.removing ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {blacklistTarget.removing
                ? `Remove ${blacklistTarget.customer.name} from the blacklist? They will be allowed to book again.`
                : `You are blacklisting ${blacklistTarget.customer.name}. Front-desk staff will see a warning during future bookings.`}
            </div>
            {!blacklistTarget.removing && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={blacklistReason}
                  onChange={(e) => setBlacklistReason(e.target.value)}
                  placeholder="Why is this guest being blacklisted?"
                  required
                />
                <p className="mt-1 text-xs text-slate-500">Record a short, factual reason so staff understand the warning later.</p>
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setBlacklistTarget(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                type="submit"
                disabled={blacklistLoading}
                className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm text-white transition-colors ${
                  blacklistTarget.removing
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {blacklistLoading ? 'Saving...' : blacklistTarget.removing ? 'Remove Blacklist' : 'Confirm Blacklist'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
