import { useState, useRef } from 'react'
import { Building2, Phone, Mail, MapPin, Globe, Hash, CheckCircle, Upload, Image, X } from 'lucide-react'

const BUSINESS_TYPES = [
  {
    value: 'lodge',
    emoji: '🏕️',
    label: 'Lodge / Hotel',
    desc: 'Accommodation with room bookings, check-ins, housekeeping, conference rooms & POS'
  },
  {
    value: 'restaurant',
    emoji: '🍽️',
    label: 'Restaurant / Bar',
    desc: 'Food & drinks orders, POS, inventory tracking & expenses'
  }
]

const TYPE_LABELS = {
  lodge: { name: 'Lodge / Property Name', namePlaceholder: 'e.g. Sunset Lodge, Okavango Camp...', nameHint: 'The name of your lodge as it will appear on receipts' },
  restaurant: { name: 'Restaurant / Bar Name', namePlaceholder: 'e.g. The Grill House, Sunset Bar...', nameHint: 'The name of your restaurant as it will appear on receipts' }
}

export default function Setup({ onComplete }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const fileInputRef = useRef(null)
  const [form, setForm] = useState({
    business_type: '',
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
  const typeLabels = TYPE_LABELS[form.business_type] || TYPE_LABELS.lodge

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
    setSaving(true)
    try {
      const res = await window.api.settings.save(form)
      if (res.success) {
        onComplete(res.data)
      }
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const STEP_LABELS = ['Business Type', 'Business Info', 'Contact Details']

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-green-700 px-8 py-6 text-white">
          <div className="text-3xl mb-2">
            {form.business_type ? BUSINESS_TYPES.find((b) => b.value === form.business_type)?.emoji : '🏢'}
          </div>
          <h1 className="text-2xl font-bold">Welcome to Boroko Business</h1>
          <p className="text-green-200 text-sm mt-1">
            {step === 1
              ? 'What type of business are you setting up?'
              : 'Let\'s set up your details — these will appear on all receipts and invoices.'}
          </p>
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

          {/* ── Step 1: Business Type ── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700 mb-3">Select your business type:</p>
              {BUSINESS_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => set('business_type', type.value)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                    form.business_type === type.value
                      ? 'border-green-500 bg-green-50 shadow-sm'
                      : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-2xl flex-shrink-0">{type.emoji}</span>
                  <div>
                    <p className={`font-semibold text-sm ${form.business_type === type.value ? 'text-green-800' : 'text-gray-800'}`}>
                      {type.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{type.desc}</p>
                  </div>
                  {form.business_type === type.value && (
                    <CheckCircle size={18} className="text-green-600 ml-auto flex-shrink-0" />
                  )}
                </button>
              ))}
              <button
                onClick={() => setStep(2)}
                disabled={!form.business_type}
                className="btn-primary w-full mt-4"
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 2: Business Info ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 size={14} className="inline mr-1 text-green-600" />
                  {typeLabels.name} *
                </label>
                <input
                  className="input"
                  placeholder={typeLabels.namePlaceholder}
                  value={form.lodge_name}
                  onChange={(e) => set('lodge_name', e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">{typeLabels.nameHint}</p>
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
                  Business Logo (optional)
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

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1">← Back</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!form.lodge_name.trim()}
                  className="btn-primary flex-1"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Contact Details ── */}
          {step === 3 && (
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
                  placeholder="info@yourbusiness.com"
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
                  placeholder="www.yourbusiness.com"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1">← Back</button>
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="btn-primary flex-1"
                >
                  {saving ? 'Setting up...' : '✓ Finish Setup'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          You can change these details anytime in Settings
        </p>
      </div>
    </div>
  )
}
