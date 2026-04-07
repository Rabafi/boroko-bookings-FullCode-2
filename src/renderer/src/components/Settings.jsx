import { useEffect, useState, useRef } from 'react'
import { Building2, Phone, Mail, MapPin, Globe, Hash, Save, Upload, X, Image, Moon, Plus, Pencil, Trash2, Calendar, RefreshCw, CheckCircle2, AlertTriangle, Key, ShieldCheck, Clock, CreditCard, Copy, TrendingUp, ArrowUpCircle, Settings as SettingsIcon } from 'lucide-react'
import { useSettings } from '../App'
import SystemHealthPanel from './SystemHealthPanel'
import SubscriptionAccessPanel from './SubscriptionAccessPanel'

// Update this to your actual booking site URL after deployment
const BOOKING_SITE_BASE = 'https://book.boroko.app'


export default function Settings() {
  const { settings: globalSettings, setSettings: setGlobalSettings } = useSettings()
  const [activeTab, setActiveTab] = useState('general')
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
  const [downloadProgress, setDownloadProgress] = useState(null) // null | { percent, transferred, total }
  const [updateReady, setUpdateReady] = useState(false)
  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  useEffect(() => {
    window.api.updates.getVersion().then(setAppVersion).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.updates.onAvailable((info) => {
      setUpdateStatus('available')
      setUpdateMessage(`v${info.version} found. Downloading now...`)
      setDownloadProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
      setUpdateReady(false)
    })
    window.api.updates.onNotAvailable(() => {
      setUpdateStatus('uptodate')
      setUpdateMessage('You\'re running the latest version.')
      setDownloadProgress(null)
      setUpdateReady(false)
    })
    window.api.updates.onProgress((p) => {
      setUpdateStatus('available')
      setDownloadProgress(p)
      setUpdateMessage(p.bytesPerSecond > 0 ? `Downloading at ${formatBytes(p.bytesPerSecond)}/s` : 'Preparing download...')
    })
    window.api.updates.onReady(() => {
      setUpdateReady(true)
      setUpdateStatus('available')
      setUpdateMessage('Download complete. Restart to install.')
    })
    window.api.updates.onError((info) => {
      setUpdateStatus('error')
      setUpdateMessage(info?.message || 'Update failed.')
      setUpdateReady(false)
    })
  }, [])

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateMessage('')
    setDownloadProgress(null)
    setUpdateReady(false)
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
        setUpdateMessage(`v${res.latestVersion} is available — download started.`)
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

  // License & Billing
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState(null) // { type: 'success'|'error', text }
  const [lodgeIdCopied, setLodgeIdCopied] = useState(false)
  const [slugCopied, setSlugCopied] = useState(false)

  // Auto-generate slug from lodge name (only when slug is blank)
  const toSlug = (name) =>
    (name || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
      .replace(/-+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50)

  const onlinePlanOk = licenseStatus?.effective_features?.online_booking === true
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeSending, setUpgradeSending] = useState(false)
  const [upgradeSent, setUpgradeSent] = useState(false)
  const [invoices, setInvoices] = useState([])

  const refreshLicenseStatus = (lodgeId) => {
    if (lodgeId && window.api?.trial) {
      window.api.trial.getStatus(lodgeId).then(setLicenseStatus).catch(() => {})
    }
  }

  useEffect(() => {
    refreshLicenseStatus(globalSettings?.lodge_id)
  }, [globalSettings?.lodge_id])

  useEffect(() => {
    if (licenseStatus?.status === 'licensed' && globalSettings?.lodge_id && window.api?.trial?.getInvoices) {
      window.api.trial.getInvoices(globalSettings.lodge_id).then(setInvoices).catch(() => {})
    }
  }, [licenseStatus?.status, globalSettings?.lodge_id])

  const handleActivate = async () => {
    setActivateMsg(null)
    setActivating(true)
    try {
      const lodgeId = globalSettings?.lodge_id
      const res = await window.api.trial.activateKey(lodgeId, licenseKey)
      if (res?.success) {
        setActivateMsg({ type: 'success', text: `License activated! Plan: ${res.plan || 'Starter'}` })
        setLicenseKey('')
        refreshLicenseStatus(lodgeId)
      } else {
        setActivateMsg({ type: 'error', text: res?.error || 'Activation failed.' })
      }
    } catch (e) {
      setActivateMsg({ type: 'error', text: e.message || 'Activation failed.' })
    }
    setActivating(false)
  }

  const copyLodgeId = () => {
    navigator.clipboard.writeText(globalSettings?.lodge_id || '').then(() => {
      setLodgeIdCopied(true)
      setTimeout(() => setLodgeIdCopied(false), 2000)
    })
  }

  const handleUpgradeRequest = async () => {
    if (!upgradeMsg.trim()) return
    setUpgradeSending(true)
    try {
      await window.api.admin.createSupportTicket({
        lodge_id: globalSettings?.lodge_id || 'unknown',
        lodge_name: globalSettings?.lodge_name || form?.lodge_name || '',
        title: 'Upgrade Request',
        description: upgradeMsg.trim(),
        category: 'Upgrade Request',
        priority: 'High'
      })
      setUpgradeSent(true)
      setUpgradeMsg('')
      setTimeout(() => { setUpgradeSent(false); setUpgradeOpen(false) }, 3000)
    } catch {
      // silently fail — user can try again
    }
    setUpgradeSending(false)
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

  const handleFileChange = (e) => { processImageFile(e.target.files[0]) }

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

  // ── Helpers for License tab ────────────────────────────────────────────────

  const fmtDate = (d) => {
    if (!d) return '—'
    const date = new Date(d)
    if (isNaN(date.getTime())) return '—'
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const paymentBadge = (status) => {
    if (!status) return null
    const map = {
      active:    { bg: 'bg-green-100 text-green-700',  label: 'Active' },
      overdue:   { bg: 'bg-red-100 text-red-700',      label: 'Overdue' },
      free:      { bg: 'bg-gray-100 text-gray-600',    label: 'Free' },
      cancelled: { bg: 'bg-amber-100 text-amber-700',  label: 'Cancelled' },
    }
    const s = map[status] || { bg: 'bg-gray-100 text-gray-600', label: status }
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg}`}>{s.label}</span>
  }

  const tabs = [
    { id: 'general', label: 'General', icon: <SettingsIcon size={14} /> },
    { id: 'license', label: 'Subscription & Access', icon: <CreditCard size={14} /> },
    { id: 'system', label: 'System Health', icon: <ShieldCheck size={14} /> },
  ]

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          GENERAL TAB
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'general' && (
        <>
          {/* ── Dark Mode ───────────────────────────────────────────────── */}
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

          {/* ── App Updates ─────────────────────────────────────────────── */}
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

            {downloadProgress && (
              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
                <div className="flex items-center justify-between text-xs text-sky-800 mb-2">
                  <span className="font-semibold">Downloading update…</span>
                  <span className="tabular-nums">{downloadProgress.percent}%</span>
                </div>
                <div className="w-full bg-white rounded-full h-2.5 overflow-hidden shadow-inner">
                  <div
                    className="bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-sky-700">
                  <span>{formatBytes(downloadProgress.transferred)} of {downloadProgress.total ? formatBytes(downloadProgress.total) : 'calculating...'}</span>
                  <span>{downloadProgress.bytesPerSecond > 0 ? `${formatBytes(downloadProgress.bytesPerSecond)}/s` : 'starting...'}</span>
                </div>
              </div>
            )}

            {updateReady && (
              <button
                type="button"
                onClick={() => window.api.updates.install()}
                className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
              >
                Install &amp; Restart
              </button>
            )}
          </div>

          <form onSubmit={handleSave} className="space-y-6">

            {/* ── Logo Upload ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Image size={15} className="text-green-600" /> Lodge Logo
              </h2>

              <div className="flex items-start gap-6">
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
                    <p className="text-sm font-medium text-gray-600">Click or drag & drop your logo here</p>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG, SVG — max 5 MB. Will be resized to fit.</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  {logoPreview && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">✓ Logo uploaded — will appear on all receipts</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Business Identity ─────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Building2 size={15} className="text-green-600" /> Business Identity
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business / Property Name *</label>
                  <input className="input" value={form.lodge_name} onChange={(e) => set('lodge_name', e.target.value)} placeholder="e.g. Sunset Lodge" required />
                  <p className="text-xs text-gray-400 mt-1">Shown as the main heading on receipts</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Registered Company Name</label>
                  <input className="input" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="e.g. Sunset Lodge (Pty) Ltd" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
                    <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
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
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        <Hash size={13} className="inline mr-1" />VAT / Tax
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-gray-500">{form.vat_enabled ? 'Enabled' : 'Disabled'}</span>
                        <div
                          onClick={() => set('vat_enabled', !form.vat_enabled)}
                          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.vat_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.vat_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </label>
                    </div>
                    {form.vat_enabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">VAT Rate (%)</label>
                          <input
                            type="number" min="0" max="100" step="0.1" className="input"
                            value={form.vat_rate || ''}
                            onChange={(e) => set('vat_rate', parseFloat(e.target.value) || 0)}
                            placeholder="e.g. 14"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">VAT Number</label>
                          <input className="input" value={form.vat_number || ''} onChange={(e) => set('vat_number', e.target.value)} placeholder="Optional" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Location ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <MapPin size={15} className="text-green-600" /> Location
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Physical Address</label>
                  <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street / Plot number" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City / Town</label>
                    <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Maun" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Contact ──────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Phone size={15} className="text-green-600" /> Contact Details
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Phone size={13} className="inline mr-1" /> Phone Number</label>
                  <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+267 000 0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Mail size={13} className="inline mr-1" /> Email Address</label>
                  <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="info@yourlodge.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Globe size={13} className="inline mr-1" /> Website</label>
                  <input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="www.yourlodge.com" />
                </div>
              </div>
            </div>

            {/* ── Seasonal / Event Pricing ──────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                  <Calendar size={15} className="text-green-600" /> Seasonal & Event Pricing
                </h2>
                <button type="button" onClick={openRateCreate} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700">
                  <Plus size={14} /> Add Override
                </button>
              </div>

              {rateOverrides.length === 0 ? (
                <p className="text-sm text-gray-400">No rate overrides set. Add seasonal, holiday, or weekend rates here.</p>
              ) : (
                <div className="space-y-2">
                  {rateOverrides.map((r) => {
                    const room = rooms.find((rm) => rm.id === r.room_id)
                    return (
                      <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 text-sm">
                        <div>
                          <p className="font-medium text-gray-800">{r.name || 'Rate override'} — Room {room?.room_number || r.room_id}</p>
                          <p className="text-xs text-gray-400">{r.start_date} → {r.end_date}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-green-700">{form?.currency || 'P'} {Number(r.rate_per_night).toFixed(2)}/night</span>
                          <button type="button" onClick={() => openRateEdit(r)} className="p-1 text-blue-400 hover:text-blue-600"><Pencil size={14} /></button>
                          <button type="button" onClick={() => handleRateDelete(r.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {rateForm && (
                <form onSubmit={handleRateSave} className="mt-4 border-t pt-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {editingRate ? 'Edit Rate Override' : 'New Rate Override'}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Room *</label>
                      <select className="input" value={rateForm.room_id} onChange={(e) => setRateForm({ ...rateForm, room_id: e.target.value })} required>
                        {rooms.map((r) => (<option key={r.id} value={r.id}>Room {r.room_number} — {r.room_type}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Name / Label</label>
                      <input type="text" className="input" placeholder="e.g. Christmas, Weekend" value={rateForm.name} onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Start Date *</label>
                      <input type="date" className="input" value={rateForm.start_date} onChange={(e) => setRateForm({ ...rateForm, start_date: e.target.value })} required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Date *</label>
                      <input type="date" className="input" value={rateForm.end_date} min={rateForm.start_date} onChange={(e) => setRateForm({ ...rateForm, end_date: e.target.value })} required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Rate per Night ({form?.currency || 'P'}) *</label>
                      <input type="number" step="0.01" min="0" className="input" value={rateForm.rate_per_night} onChange={(e) => setRateForm({ ...rateForm, rate_per_night: e.target.value })} required placeholder="0.00" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setRateForm(null); setEditingRate(null) }} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" disabled={rateSaving} className="btn-primary flex-1">{rateSaving ? 'Saving...' : editingRate ? 'Update' : 'Add Override'}</button>
                  </div>
                </form>
              )}
            </div>

            {/* ── Online Booking Site ──────────────────────────────────────── */}
            <div className="border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-gray-500" />
                <h3 className="font-semibold text-gray-800 text-sm">Online Booking Site</h3>
                <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Pro</span>
              </div>

              {!onlinePlanOk ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-500">
                  Upgrade to <strong>Pro</strong> to get a public booking page guests can use to request rooms online.
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    Guests can browse and request rooms at your unique booking link.
                    Set a short, memorable URL slug below.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Your booking URL slug
                    </label>
                    <div className="flex gap-2">
                      <span className="flex items-center px-3 bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg text-xs text-gray-400 whitespace-nowrap">
                        {BOOKING_SITE_BASE.replace('https://', '')}/
                      </span>
                      <input
                        type="text"
                        value={form?.slug || ''}
                        onChange={e => {
                          const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50)
                          set('slug', raw)
                        }}
                        onFocus={() => {
                          // Auto-populate from lodge name if still empty
                          if (!form?.slug && form?.lodge_name) {
                            set('slug', toSlug(form.lodge_name))
                          }
                        }}
                        placeholder={form?.lodge_name ? toSlug(form.lodge_name) : 'your-lodge-name'}
                        className="input flex-1 rounded-l-none border-l-0"
                        spellCheck={false}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Lowercase letters, numbers, and hyphens only. Must be unique.
                    </p>
                  </div>

                  {form?.slug && (
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-500 flex-1 truncate font-mono">
                        {BOOKING_SITE_BASE.replace('https://', '')}/{form.slug}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(`${BOOKING_SITE_BASE}/${form.slug}`)
                          setSlugCopied(true)
                          setTimeout(() => setSlugCopied(false), 2000)
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 shrink-0"
                      >
                        <Copy size={12} />
                        {slugCopied ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Save your settings to activate the link. Online booking requests will appear as <strong>Pending</strong> in your Bookings screen for you to confirm or reject.
                  </p>
                </>
              )}
            </div>

            {/* ── Save ─────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 pb-6">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={15} />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              {saved && (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">✓ Settings saved successfully!</span>
              )}
            </div>
          </form>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          LICENSE & BILLING TAB
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'license' && (
        <SubscriptionAccessPanel />
      )}

      {activeTab === 'system' && (
        <SystemHealthPanel />
      )}
    </div>
  )
}
