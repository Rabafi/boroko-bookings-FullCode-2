import { useEffect, useState, useRef } from 'react'
import { Search, UserX, Clock, ChevronDown, ChevronUp, Camera, X } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../App'

export default function Guests() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [customers, setCustomers] = useState([])
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all') // all | active | blacklisted

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

  useEffect(() => { loadCustomers() }, [])

  const loadCustomers = async () => {
    const data = await window.api.customers.getAll()
    setCustomers(data || [])
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

  const filtered = customers.filter((c) => {
    const matchSearch =
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ||
      (filter === 'blacklisted' && c.is_blacklisted) ||
      (filter === 'active' && !c.is_blacklisted)
    return matchSearch && matchFilter
  })

  const blacklistedCount = customers.filter((c) => c.is_blacklisted).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Guests</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {customers.length} total · {blacklistedCount} blacklisted
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Search by name, phone or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['all', 'All'], ['active', 'Active'], ['blacklisted', 'Blacklisted']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-2 transition-colors ${
                filter === v ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-5 py-3 text-left">Guest</th>
              <th className="px-5 py-3 text-left">Phone</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">ID / Passport</th>
              <th className="px-5 py-3 text-left">Nationality</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">ID Photo</th>
              <th className="px-5 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <>
                <tr key={c.id} className={`hover:bg-gray-50 ${c.is_blacklisted ? 'bg-red-50/40' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-800">{c.name}</p>
                    {c.is_blacklisted && c.blacklist_reason && (
                      <p className="text-xs text-red-500 mt-0.5">⚠ {c.blacklist_reason}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{c.phone || '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{c.email || '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{c.id_number || '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{c.nationality || '—'}</td>
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
                          className="w-10 h-10 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition-opacity"
                          data-no-invert
                        />
                      </button>
                    ) : (
                      <button
                        onClick={() => openPhotoModal(c)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                      >
                        <Camera size={14} /> Add
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => toggleHistory(c)}
                        className="flex items-center gap-1 text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <Clock size={12} />
                        History
                        {expandedId === c.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <button
                        onClick={() => openBlacklist(c)}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
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
                    <td colSpan={8} className="px-5 py-3 bg-blue-50/40 border-b border-blue-100">
                      <p className="text-xs font-semibold text-blue-700 mb-2">
                        Booking history for {c.name}
                      </p>
                      {historyLoading ? (
                        <p className="text-xs text-gray-400">Loading...</p>
                      ) : history.length === 0 ? (
                        <p className="text-xs text-gray-400">No bookings found for this guest.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
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
                                <td className="pr-4 py-1 text-gray-700">Room {b.room_number}</td>
                                <td className="pr-4 py-1 text-gray-600">{b.check_in}</td>
                                <td className="pr-4 py-1 text-gray-600">{b.check_out}</td>
                                <td className="pr-4 py-1 capitalize text-gray-600">{b.status?.replace('_', ' ')}</td>
                                <td className="pr-4 py-1 capitalize text-gray-600">{b.payment_status || 'unpaid'}</td>
                                <td className="text-right py-1 font-medium text-gray-800">
                                  {currency} {Number(b.total_amount || 0).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-gray-400">
                  No guests found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
                  className="w-full max-h-64 object-contain rounded-lg border border-gray-200"
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
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors"
              >
                <Camera size={32} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">Click to upload ID / Passport photo</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG — will be resized automatically</p>
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
            <div className={`rounded-lg p-3 text-sm ${blacklistTarget.removing ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {blacklistTarget.removing
                ? `Remove ${blacklistTarget.customer.name} from the blacklist? They will be allowed to book again.`
                : `You are blacklisting ${blacklistTarget.customer.name}. They will show a warning in future bookings.`}
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
