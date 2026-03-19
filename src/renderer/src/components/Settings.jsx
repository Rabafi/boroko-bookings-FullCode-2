import { useEffect, useState, useRef } from 'react'
import { Building2, Phone, Mail, MapPin, Globe, Hash, Save, Upload, X, Image, Moon, Plus, Pencil, Trash2, Calendar, Briefcase, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSettings } from '../App'

const BUSINESS_TYPES = [
  { value: 'lodge',      emoji: '🏕️', label: 'Lodge / Hotel' },
  { value: 'restaurant', emoji: '🍽️', label: 'Restaurant / Bar' }
]

const BIZ_LABELS = {
  lodge: 'Lodge Settings',
  restaurant: 'Business Settings'
}

export default function Settings() {
  const { setSettings: setGlobalSettings } = useSettings()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  // Dark mode
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('bb_dark_mode') === 'true'
  )

  // App updates
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState('idle') // idle | checking | uptodate | available | error
  const [updateMessage, setUpdateMessage] = useState('')

  useEffect(() => {
    window.api.updates.getVersion().then(setAppVersion).catch(() => {})
  }, [])

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateMessage('')
    try {
      const res = await window.api.updates.check()
      if (res.dev) {
        setUpdateStatus('uptodate')
        setUpdateMessage('Running in development mode — update checks disabled.')
      } else if (!res.success) {
        setUpdateStatus('error')
        setUpdateMessage(res.error || 'Could not reach update server.')
      } else if (res.updateAvailable) {
        setUpdateStatus('available')
        setUpdateMessage(`v${res.latestVersion} is available — downloading now. You'll see a banner at the top when ready.`)
      } else {
        setUpdateStatus('uptodate')
        setUpdateMessage('You\'re running the latest version.')
      }
    } catch (e) {
      setUpdateStatus('error')
      setUpdateMessage(e.message || 'Update check failed.')
    }
  }

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('bb_dark_mode', String(next))
    document.documentElement.classList.toggle('dark-mode', next)
  }

  // Seasonal pricing
  const [rateOverrides, setRateOverrides] = useState([])
  const [rooms, setRooms] = useState([])
  const [rateForm, setRateForm] = useState(null) // null = closed, {} = open
  const [editingRate, setEditingRate] = useState(null)
  const [rateSaving, setRateSaving] = useState(false)

  useEffect(() => {
    window.api.rateOverrides.getAll().then(setRateOverrides).catch(() => {})
    window.api.rooms.getAll().then(setRooms).catch(() => {})
  }, [])

  const openRateCreate = () => {
    setEditingRate(null)
    setRateForm({ room_id: rooms[0]?.id || '', start_date: '', end_date: '', rate_per_night: '', name: '' })
  }

  const openRateEdit = (r) => {
    setEditingRate(r)
    setRateForm({ room_id: r.room_id, start_date: r.start_date, end_date: r.end_date, rate_per_night: String(r.rate_per_night), name: r.name || '' })
  }

  const handleRateSave = async (e) => {
    e.preventDefault()
    setRateSaving(true)
    const payload = { ...rateForm, room_id: Number(rateForm.room_id), rate_per_night: parseFloat(rateForm.rate_per_night) }
    if (editingRate) {
      await window.api.rateOverrides.update(editingRate.id, payload).catch(console.error)
    } else {
      await window.api.rateOverrides.create(payload).catch(console.error)
    }
    const data = await window.api.rateOverrides.getAll().catch(() => [])
    setRateOverrides(data || [])
    setRateSaving(false)
    setRateForm(null)
    setEditingRate(null)
  }

  const handleRateDelete = async (id) => {
    if (!confirm('Delete this rate override?')) return
    await window.api.rateOverrides.delete(id).catch(console.error)
    const data = await window.api.rateOverrides.getAll().catch(() => [])
    setRateOverrides(data || [])
  }

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setForm(s)
      if (s?.logo) setLogoPreview(s.logo)
    })
  }, [])

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  // ── Logo handling ──────────────────────────────────────────────────────────

  const processImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        // Resize to max 400x400 to keep base64 small
        const MAX = 400
        const canvas = document.createElement('canvas')
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/png')
        setLogoPreview(base64)
        setForm((f) => ({ ...f, logo: base64 }))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e) => {
    processImageFile(e.target.files[0])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    processImageFile(e.dataTransfer.files[0])
  }

  const removeLogo = () => {
    setLogoPreview(null)
    setForm((f) => ({ ...f, logo: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const res = await window.api.settings.save(form)
      if (res.success) {
        setGlobalSettings(res.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error(err)
    }
    setSaving(false)
  }

  if (!form) return (
    <div className="p-6 flex items-center justify-center h-64 text-gray-400">
      Loading settings...
    </div>
  )

  const bizType = form?.business_type || 'lodge'
  const isLodge = bizType === 'lodge'
  const pageTitle = BIZ_LABELS[bizType] || 'Business Settings'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{pageTitle}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          These details appear on all guest receipts and invoices
        </p>
      </div>

      {/* ── Dark Mode (outside form — no save needed) ───────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
            <Moon size={17} className="text-gray-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Dark Mode</p>
            <p className="text-xs text-gray-400">Inverts the display for low-light environments</p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleDarkMode}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            darkMode ? 'bg-green-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              darkMode ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* ── App Updates ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <RefreshCw size={17} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">App Updates</p>
              <p className="text-xs text-gray-400">
                Current version: <span className="font-mono font-medium text-gray-600">v{appVersion || '…'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={updateStatus === 'checking'}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
            {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>

        {updateMessage && (
          <div className={`flex items-start gap-2 mt-3 px-3 py-2 rounded-lg text-xs ${
            updateStatus === 'uptodate' ? 'bg-green-50 text-green-700' :
            updateStatus === 'available' ? 'bg-blue-50 text-blue-700' :
            'bg-red-50 text-red-700'
          }`}>
            {updateStatus === 'uptodate' && <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />}
            {updateStatus === 'available' && <RefreshCw size={13} className="flex-shrink-0 mt-0.5 animate-spin" />}
            {updateStatus === 'error'     && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
            <span>{updateMessage}</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        {/* ── Business Type ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Briefcase size={15} className="text-green-600" /> Business Type
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {BUSINESS_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => set('business_type', type.value)}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                  (form.business_type || 'lodge') === type.value
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-green-300'
                }`}
              >
                <span className="text-xl">{type.emoji}</span>
                <span className="text-xs font-medium text-gray-700">{type.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-amber-600 mt-3 bg-amber-50 rounded-lg px-3 py-2">
            ⚠️ Changing your business type will adjust which features appear in the navigation.
          </p>
        </div>

        {/* ── Logo Upload ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Image size={15} className="text-green-600" /> Lodge Logo
          </h2>

          <div className="flex items-start gap-6">
            {/* Preview */}
            <div className="flex-shrink-0">
              {logoPreview ? (
                <div className="relative group">
                  <img
                    src={logoPreview}
                    alt="Lodge logo"
                    className="w-28 h-28 object-contain border-2 border-gray-200 rounded-xl bg-gray-50 p-1"
                  />
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <div className="w-28 h-28 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300">
                  <Image size={32} />
                </div>
              )}
            </div>

            {/* Upload area */}
            <div className="flex-1">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                }`}
              >
                <Upload size={20} className="mx-auto mb-2 text-gray-400" />
                <p className="text-sm font-medium text-gray-600">
                  Click or drag & drop your logo here
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  PNG, JPG, SVG — max 5 MB. Will be resized to fit.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {logoPreview && (
                <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                  ✓ Logo uploaded — will appear on all receipts
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Business Identity ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Building2 size={15} className="text-green-600" /> Business Identity
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Business / Property Name *
              </label>
              <input
                className="input"
                value={form.lodge_name}
                onChange={(e) => set('lodge_name', e.target.value)}
                placeholder={isLodge ? 'e.g. Sunset Lodge' : 'e.g. Your Business Name'}
                required
              />
              <p className="text-xs text-gray-400 mt-1">Shown as the main heading on receipts</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Registered Company Name
              </label>
              <input
                className="input"
                value={form.company_name}
                onChange={(e) => set('company_name', e.target.value)}
                placeholder="e.g. Sunset Lodge (Pty) Ltd"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
                <select
                  className="input"
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                >
                  <option value="P">P — Botswana Pula</option>
                  <option value="R">R — South African Rand</option>
                  <option value="$">$ — US Dollar</option>
                  <option value="€">€ — Euro</option>
                  <option value="£">£ — British Pound</option>
                  <option value="N$">N$ — Namibian Dollar</option>
                  <option value="ZK">ZK — Zambian Kwacha</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Hash size={13} className="inline mr-1" />
                  VAT / Tax Number
                </label>
                <input
                  className="input"
                  value={form.vat_number}
                  onChange={(e) => set('vat_number', e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Location ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <MapPin size={15} className="text-green-600" /> Location
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Physical Address</label>
              <input
                className="input"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Street / Plot number"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City / Town</label>
                <input
                  className="input"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="e.g. Maun"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <input
                  className="input"
                  value={form.country}
                  onChange={(e) => set('country', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Contact ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Phone size={15} className="text-green-600" /> Contact Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Phone size={13} className="inline mr-1" /> Phone Number
              </label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+267 000 0000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail size={13} className="inline mr-1" /> Email Address
              </label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="info@yourlodge.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Globe size={13} className="inline mr-1" /> Website
              </label>
              <input
                className="input"
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder="www.yourlodge.com"
              />
            </div>
          </div>
        </div>

        {/* ── Seasonal / Event Pricing — Lodge only ────────────────────────── */}
        {isLodge && <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
              <Calendar size={15} className="text-green-600" /> Seasonal & Event Pricing
            </h2>
            <button
              type="button"
              onClick={openRateCreate}
              className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
            >
              <Plus size={14} /> Add Override
            </button>
          </div>

          {rateOverrides.length === 0 ? (
            <p className="text-sm text-gray-400">
              No rate overrides set. Add seasonal, holiday, or weekend rates here.
            </p>
          ) : (
            <div className="space-y-2">
              {rateOverrides.map((r) => {
                const room = rooms.find((rm) => rm.id === r.room_id)
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-800">
                        {r.name || 'Rate override'} — Room {room?.room_number || r.room_id}
                      </p>
                      <p className="text-xs text-gray-400">
                        {r.start_date} → {r.end_date}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-green-700">
                        {form?.currency || 'P'} {Number(r.rate_per_night).toFixed(2)}/night
                      </span>
                      <button
                        type="button"
                        onClick={() => openRateEdit(r)}
                        className="p-1 text-blue-400 hover:text-blue-600"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRateDelete(r.id)}
                        className="p-1 text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Rate Override Form (inline) */}
          {rateForm && (
            <form onSubmit={handleRateSave} className="mt-4 border-t pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {editingRate ? 'Edit Rate Override' : 'New Rate Override'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Room *</label>
                  <select
                    className="input"
                    value={rateForm.room_id}
                    onChange={(e) => setRateForm({ ...rateForm, room_id: e.target.value })}
                    required
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>Room {r.room_number} — {r.room_type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name / Label</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Christmas, Weekend"
                    value={rateForm.name}
                    onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date *</label>
                  <input
                    type="date"
                    className="input"
                    value={rateForm.start_date}
                    onChange={(e) => setRateForm({ ...rateForm, start_date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date *</label>
                  <input
                    type="date"
                    className="input"
                    value={rateForm.end_date}
                    min={rateForm.start_date}
                    onChange={(e) => setRateForm({ ...rateForm, end_date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Rate per Night ({form?.currency || 'P'}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={rateForm.rate_per_night}
                    onChange={(e) => setRateForm({ ...rateForm, rate_per_night: e.target.value })}
                    required
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setRateForm(null); setEditingRate(null) }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" disabled={rateSaving} className="btn-primary flex-1">
                  {rateSaving ? 'Saving...' : editingRate ? 'Update' : 'Add Override'}
                </button>
              </div>
            </form>
          )}
        </div>}

        {/* ── Save ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 pb-6">
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium flex items-center gap-1">
              ✓ Settings saved successfully!
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
