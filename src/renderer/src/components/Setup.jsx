import { useNavigate } from 'react-router-dom'
import { useState, useRef } from 'react'
import { Building2, Phone, Mail, MapPin, Globe, Hash, CheckCircle, Upload, Image, X, User, Lock, Eye, EyeOff } from 'lucide-react'
import { useProfiles } from '../App'

export default function Setup({ onComplete }) {
  const navigate = useNavigate()
  const { activeProfile, profiles } = useProfiles()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [adminError, setAdminError] = useState('')
  const fileInputRef = useRef(null)
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', confirm: '' })
  const [form, setForm] = useState({
    business_type: 'lodge',
    lodge_name: '',
    company_name: '',
    address: '',
    city: '',
    country: 'Botswana',
    phone: '',
    email: '',
    website: '',
    vat_number: '',
    currency: 'P',
    logo: ''
  })

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const getSetupErrorMessage = (res) => {
    const code = res?.code || res?.data?.auth_health?.code
    const fallback = res?.error || res?.data?.auth_health?.error || 'Could not complete setup.'

    if (code === 'profile_already_ready') {
      return 'This lodge profile on this computer is already set up. Go back to the lodge chooser and sign in instead.'
    }
    if (code === 'remote_lodge_already_exists') {
      return 'This draft lodge ID already exists in Supabase. Go back to the lodge chooser and create a fresh lodge draft.'
    }
    if (code === 'draft_profile_blocked_by_unsynced_changes') {
      return 'This draft lodge has unsynced offline changes. Clear or sync them before retrying setup.'
    }
    if (code === 'no_draft_profile_selected') {
      return 'Choose or create a draft lodge on this computer before running setup.'
    }
    if (code === 'user_create_failed') {
      return res?.error || 'The admin account could not be created for this lodge. Please check the database error and try again.'
    }
    if (code === 'backend_auth_schema_outdated') {
      return res?.error || 'This database is missing the latest Boroko auth schema. Run the checked-in Supabase migrations, then try setup again.'
    }
    if (code === 'target_user_missing') {
      return 'The new admin account was not found for this lodge after setup.'
    }
    return fallback
  }

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
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/png')
        setLogoPreview(base64)
        setForm((f) => ({ ...f, logo: base64 }))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleFinish = async () => {
    console.log('\n[SETUP] ===== START =====')

    setAdminError('')

    if (!admin.name.trim() || !admin.email.trim() || !admin.password) {
      console.warn('[SETUP] Validation failed: missing fields')
      setAdminError('All fields are required.')
      return
    }

    if (admin.password.length < 6) {
      console.warn('[SETUP] Validation failed: password too short')
      setAdminError('Password must be at least 6 characters.')
      return
    }

    if (admin.password !== admin.confirm) {
      console.warn('[SETUP] Validation failed: passwords mismatch')
      setAdminError('Passwords do not match.')
      return
    }

    const status = await window.api.auth.getStatus('').catch(() => ({ online: false }))
    console.log('[SETUP] Online status:', status)

    if (!status?.online) {
      console.warn('[SETUP] Blocked: offline')
      setAdminError('An internet connection is required to complete setup.')
      return
    }

    setSaving(true)

    try {
      console.log('[SETUP] Before API')
      const res = await window.api.setup.initializeCompany({
        settings: form,
        admin: {
          name: admin.name.trim(),
          email: admin.email.trim().toLowerCase(),
          password: admin.password,
          role: 'admin'
        }
      })
      console.log('[SETUP] initializeCompany result:', res)

      if (!res?.success || !res.data?.auth_health?.ok) {
        console.error('[SETUP] Initialization failed:', res)
        setAdminError(getSetupErrorMessage(res))
        return
      }

      await onComplete(res.data.settings)
      navigate('/login')
    } catch (e) {
      console.error('[SETUP] CRASH:', e)
      setAdminError('Setup failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const STEP_LABELS = ['Property Info', 'Contact Details', 'Admin Account']

  const stepSubtitle = {
    1: 'Tell us about your property — this appears on all receipts and invoices.',
    2: 'Where can guests and staff reach you?',
    3: 'Create your administrator login. You can add more staff accounts after setup.'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-green-700 px-8 py-6 text-white">
          <div className="text-3xl mb-2">🏕️</div>
          <h1 className="text-2xl font-bold">Welcome to Boroko Bookings</h1>
          <p className="text-green-200 text-sm mt-1">{stepSubtitle[step]}</p>
          {activeProfile && (
            <div className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-green-100">Draft Lodge Profile</p>
              <p className="text-sm font-semibold text-white mt-1">{activeProfile.label || 'New Lodge'}</p>
              <p className="text-[11px] text-green-100 break-all mt-1">{activeProfile.lodge_id}</p>
            </div>
          )}
        </div>

        {/* Progress Steps */}
        <div className="flex px-8 pt-5 gap-1">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-1.5 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                  step > s
                    ? 'bg-green-600 text-white'
                    : step === s
                    ? 'bg-green-600 text-white ring-4 ring-green-100'
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {step > s ? <CheckCircle size={14} /> : s}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step === s ? 'text-green-700' : 'text-gray-400'}`}>
                {STEP_LABELS[s - 1]}
              </span>
              {s < 3 && <div className={`flex-1 h-0.5 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="px-8 py-6">

          {/* ── Step 1: Property Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 size={14} className="inline mr-1 text-green-600" />
                  Property / Lodge Name *
                </label>
                <input
                  className="input"
                  placeholder="e.g. Sunset Lodge, Okavango Camp..."
                  value={form.lodge_name}
                  onChange={(e) => set('lodge_name', e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">The name of your lodge as it will appear on receipts</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Registered Company Name
                </label>
                <input
                  className="input"
                  placeholder="e.g. Sunset Lodge (Pty) Ltd"
                  value={form.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-1">Your official business / company name (optional)</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Hash size={14} className="inline mr-1 text-green-600" />
                    VAT / Tax Number
                  </label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={form.vat_number}
                    onChange={(e) => set('vat_number', e.target.value)}
                  />
                </div>
              </div>

              {/* Logo Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Image size={14} className="inline mr-1 text-green-600" />
                  Logo (optional)
                </label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <div className="relative group flex-shrink-0">
                      <img src={logoPreview} alt="Logo" className="w-16 h-16 object-contain border-2 border-gray-200 rounded-lg bg-gray-50 p-1" />
                      <button type="button" onClick={() => { setLogoPreview(null); set('logo', '') }}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center hover:bg-red-600">
                        <X size={9} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 flex-shrink-0">
                      <Image size={20} />
                    </div>
                  )}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 border-2 border-dashed border-gray-200 rounded-lg p-3 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors"
                  >
                    <Upload size={14} className="mx-auto mb-1 text-gray-400" />
                    <p className="text-xs text-gray-500">Click to upload logo</p>
                    <p className="text-xs text-gray-400">PNG, JPG or SVG</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*"
                    onChange={(e) => processImageFile(e.target.files[0])} className="hidden" />
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!form.lodge_name.trim()}
                className="btn-primary w-full mt-2"
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 2: Contact Details ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <MapPin size={14} className="inline mr-1 text-green-600" />
                  Physical Address
                </label>
                <input
                  className="input"
                  placeholder="Street address, Plot number..."
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City / Town</label>
                  <input
                    className="input"
                    placeholder="e.g. Gaborone, Maun..."
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                  <input
                    className="input"
                    placeholder="Botswana"
                    value={form.country}
                    onChange={(e) => set('country', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone size={14} className="inline mr-1 text-green-600" />
                  Phone Number
                </label>
                <input
                  className="input"
                  placeholder="+267 000 0000"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail size={14} className="inline mr-1 text-green-600" />
                  Email Address
                </label>
                <input
                  type="email"
                  className="input"
                  placeholder="info@yourlodge.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Globe size={14} className="inline mr-1 text-green-600" />
                  Website (optional)
                </label>
                <input
                  className="input"
                  placeholder="www.yourlodge.com"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1">← Back</button>
                <button onClick={() => setStep(3)} className="btn-primary flex-1">Next →</button>
              </div>
            </div>
          )}

          {/* ── Step 3: Admin Account ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User size={14} className="inline mr-1 text-green-600" />
                  Full Name *
                </label>
                <input
                  className="input"
                  placeholder="e.g. John Doe"
                  value={admin.name}
                  onChange={(e) => setAdmin((a) => ({ ...a, name: e.target.value }))}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail size={14} className="inline mr-1 text-green-600" />
                  Email Address *
                </label>
                <input
                  type="email"
                  className="input"
                  placeholder="admin@yourlodge.com"
                  value={admin.email}
                  onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Lock size={14} className="inline mr-1 text-green-600" />
                  Password *
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Min. 6 characters"
                    value={admin.password}
                    onChange={(e) => setAdmin((a) => ({ ...a, password: e.target.value }))}
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Lock size={14} className="inline mr-1 text-green-600" />
                  Confirm Password *
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Re-enter password"
                    value={admin.confirm}
                    onChange={(e) => setAdmin((a) => ({ ...a, confirm: e.target.value }))}
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {adminError && <p className="text-red-500 text-sm">{adminError}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1">← Back</button>
                <button onClick={handleFinish} disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Creating account...' : '✓ Finish Setup'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          You can change these details anytime in Settings
        </p>
        <div className="text-center pb-4">
          <button
            onClick={() => navigate(profiles.length > 0 ? '/choose-lodge' : '/welcome')}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            ← Back to Lodge Chooser
          </button>
        </div>
      </div>
    </div>
  )
}
