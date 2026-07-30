import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Building2, Phone, Mail, MapPin, Globe, Hash, CheckCircle, Upload, Image, X, User, Lock, Eye, EyeOff, Home, BedDouble, Tent, Car, Hotel, Palmtree, UtensilsCrossed, Wine } from 'lucide-react'
import { useProfiles } from '../app-context'
import { productLogoLight } from '../assets/productLogos'
import { HOSPITALITY_MODES, PROPERTY_TYPE_ORDER, PROPERTY_TYPE_LABELS, PROPERTY_TYPE_DESCRIPTIONS, propertyTypeToBusinessType } from '../../../shared/propertyTypes'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { HOTEL_CHROME } from './hotel/hotelChrome'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const ALLOWED_PROPERTY_TYPES = new Set(BUILD_PRODUCT.allowedPropertyTypes)
const PRODUCT_PROPERTY_TYPES = PROPERTY_TYPE_ORDER.filter((propertyType) => ALLOWED_PROPERTY_TYPES.has(propertyType))
const IS_HOSPITALITY_POS_PRODUCT = BUILD_PRODUCT.id === 'hospitality-pos'
const IS_HOTEL_PRODUCT = BUILD_PRODUCT.id === 'hotel'
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'
const BUSINESS_NOUN = BUILD_PRODUCT.businessNoun
const BUSINESS_NOUN_TITLE = BUILD_PRODUCT.businessNounTitle

/** Visual + copy tokens — Hotel and HPOS must not inherit lodge green chrome. */
const THEME = IS_HOTEL_PRODUCT ? {
  shell: `${HOTEL_CHROME.shell} flex items-center justify-center p-6`,
  card: HOTEL_CHROME.cardSetup,
  header: HOTEL_CHROME.header,
  subtitle: HOTEL_CHROME.subtitle,
  draftKicker: HOTEL_CHROME.draftKicker,
  draftMeta: HOTEL_CHROME.draftMeta,
  stepOn: HOTEL_CHROME.stepOn,
  stepOnRing: HOTEL_CHROME.stepOnRing,
  stepLabel: HOTEL_CHROME.stepLabel,
  stepBar: HOTEL_CHROME.stepBar,
  selectOn: HOTEL_CHROME.selectOn,
  selectOff: HOTEL_CHROME.selectOff,
  selectIconOn: HOTEL_CHROME.selectIconOn,
  selectTextOn: HOTEL_CHROME.selectTextOn,
  icon: HOTEL_CHROME.icon,
  yesOn: HOTEL_CHROME.yesOn,
  uploadHover: HOTEL_CHROME.uploadHover,
  radius: HOTEL_CHROME.radius
} : IS_HOSPITALITY_POS_PRODUCT ? {
  shell: 'min-h-screen bg-gradient-to-br from-[#6f8061] via-[#d08a64] to-[#f1dfc6] flex items-center justify-center p-6',
  card: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden',
  header: 'bg-gradient-to-r from-[#6f8061] via-[#c95635] to-[#a83c26] px-8 py-6 text-white',
  subtitle: 'text-orange-100 text-sm mt-1',
  draftKicker: 'text-orange-50',
  draftMeta: 'text-orange-50',
  stepOn: 'bg-[#c95635] text-white',
  stepOnRing: 'bg-[#c95635] text-white ring-4 ring-orange-100',
  stepLabel: 'text-[#a83c26]',
  stepBar: 'bg-[#c95635]',
  selectOn: 'border-[#c95635] bg-orange-50 ring-1 ring-orange-200',
  selectOff: 'border-gray-200 bg-gray-50/50 hover:border-orange-300 hover:bg-orange-50/30',
  selectIconOn: 'bg-orange-100 text-[#a83c26]',
  selectTextOn: 'text-[#7a2e1c]',
  icon: 'text-[#a83c26]',
  yesOn: 'bg-[#c95635] text-white shadow-sm',
  uploadHover: 'hover:border-[#c95635] hover:bg-orange-50',
  radius: 'rounded-xl'
} : {
  shell: 'min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center p-6',
  card: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden',
  header: 'bg-green-700 px-8 py-6 text-white',
  subtitle: 'text-green-200 text-sm mt-1',
  draftKicker: 'text-green-100',
  draftMeta: 'text-green-100',
  stepOn: 'bg-green-600 text-white',
  stepOnRing: 'bg-green-600 text-white ring-4 ring-green-100',
  stepLabel: 'text-green-700',
  stepBar: 'bg-green-500',
  selectOn: 'border-green-500 bg-green-50 ring-1 ring-green-200',
  selectOff: 'border-gray-200 bg-gray-50/50 hover:border-green-300 hover:bg-green-50/30',
  selectIconOn: 'bg-green-100 text-green-700',
  selectTextOn: 'text-green-800',
  icon: 'text-green-600',
  yesOn: 'bg-green-600 text-white shadow-sm',
  uploadHover: 'hover:border-green-400 hover:bg-green-50',
  radius: 'rounded-xl'
}

const LODGE_OPERATING_QUESTIONS = [
  { key: 'food_beverage', label: 'Does your property serve food and/or drinks?' },
  { key: 'events_conferences', label: 'Do you host events or conferences?' },
  { key: 'day_visitors_pool', label: 'Do you allow day visitors or pool access?' },
  { key: 'public_booking_page', label: 'Do you want a public booking page?' },
  { key: 'pos_outlets', label: 'Do you have food & beverage POS outlets?' },
  { key: 'room_supplies', label: 'Do you track room supplies or minibar?' },
  { key: 'corporate_clients', label: 'Do you serve corporate or company clients?' },
  { key: 'hotel_rates', label: 'Do you need hotel-style rates (seasonal, corporate, packages)?' },
  { key: 'room_types_feature', label: 'Do you need room type management (view types, bed types)?' },
  { key: 'online_payments', label: 'Do you need online payment processing?' },
  { key: 'multi_property_interest', label: 'Do you manage multiple properties?' }
]

const HOTEL_OPERATING_QUESTIONS = [
  { key: 'food_beverage', label: 'Does the hotel operate F&B outlets (restaurant, bar, room service)?' },
  { key: 'events_conferences', label: 'Do you host conferences, banquets or events?' },
  { key: 'day_visitors_pool', label: 'Do you sell day-use / spa / pool access to non-staying guests?' },
  { key: 'public_booking_page', label: 'Do you want a public booking / reservation page?' },
  { key: 'pos_outlets', label: 'Do you need outlet POS for restaurant, bar or spa?' },
  { key: 'room_supplies', label: 'Do you track minibar / room supplies?' },
  { key: 'corporate_clients', label: 'Do you bill corporate / company accounts?' },
  { key: 'hotel_rates', label: 'Do you need rate plans (seasonal, corporate, packages)?' },
  { key: 'room_types_feature', label: 'Do you manage room types (view, bed type, category)?' },
  { key: 'online_payments', label: 'Do you need online payment processing?' },
  { key: 'multi_property_interest', label: 'Do you manage more than one hotel property?' }
]

const RESTAURANT_OPERATING_QUESTIONS = [
  { key: 'food_beverage', label: 'Do you serve food as well as drinks?' },
  { key: 'events_conferences', label: 'Do you host private events or functions?' },
  { key: 'public_booking_page', label: 'Do you want a public contact / enquiry page?' },
  { key: 'pos_outlets', label: 'Do you run multiple POS outlets / stations?' },
  { key: 'corporate_clients', label: 'Do you serve corporate / company accounts?' },
  { key: 'online_payments', label: 'Do you need online payment processing?' },
  { key: 'multi_property_interest', label: 'Do you manage multiple restaurant locations?' }
]

const BAR_OPERATING_QUESTIONS = [
  { key: 'pos_outlets', label: 'Do you run more than one bar counter / station?' },
  { key: 'events_conferences', label: 'Do you host private functions or parties?' },
  { key: 'public_booking_page', label: 'Do you want a public contact / enquiry page?' },
  { key: 'corporate_clients', label: 'Do you serve corporate / company accounts or tabs?' },
  { key: 'online_payments', label: 'Do you need online payment processing?' },
  { key: 'multi_property_interest', label: 'Do you manage multiple bar locations?' }
]

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
  const [hospitalityMode, setHospitalityMode] = useState(HOSPITALITY_MODES.RESTAURANT_BAR)
  const [form, setForm] = useState({
    property_type: PRODUCT_PROPERTY_TYPES.length === 1 ? PRODUCT_PROPERTY_TYPES[0] : '',
    business_type: PRODUCT_PROPERTY_TYPES.length === 1
      ? propertyTypeToBusinessType(PRODUCT_PROPERTY_TYPES[0])
      : (IS_HOTEL_PRODUCT ? 'hotel' : IS_HOSPITALITY_POS_PRODUCT ? 'restaurant' : 'lodge'),
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

  const [operatingAnswers, setOperatingAnswers] = useState({
    food_beverage: false,
    events_conferences: false,
    day_visitors_pool: false,
    public_booking_page: false,
    pos_outlets: false,
    room_supplies: false,
    corporate_clients: false,
    hotel_rates: IS_HOTEL_PRODUCT,
    room_types_feature: IS_HOTEL_PRODUCT,
    online_payments: false,
    multi_property_interest: false
  })

  useEffect(() => {
    const root = document.documentElement
    if (IS_HOTEL_PRODUCT) root.dataset.product = 'hotel'
    else if (IS_HOSPITALITY_POS_PRODUCT) root.dataset.product = 'hospitality-pos'
    document.title = `${BUILD_PRODUCT.name} · Setup`
  }, [])

  const setOA = (key, value) => setOperatingAnswers(prev => ({ ...prev, [key]: value }))

  const OPERATING_QUESTIONS = IS_HOTEL_PRODUCT
    ? HOTEL_OPERATING_QUESTIONS
    : IS_HOSPITALITY_POS_PRODUCT
      ? (hospitalityMode === HOSPITALITY_MODES.BAR_ONLY ? BAR_OPERATING_QUESTIONS : RESTAURANT_OPERATING_QUESTIONS)
      : LODGE_OPERATING_QUESTIONS

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const buildHospitalityOperatingProfile = () => {
    const recommended = Object.entries(operatingAnswers)
      .filter(([_, v]) => v)
      .map(([k]) => k === 'food_beverage' ? 'food_beverage' :
        k === 'events_conferences' ? 'events_conferences' :
        k === 'day_visitors_pool' ? 'day_visitors' :
        k === 'public_booking_page' ? 'public_booking_page' :
        k === 'pos_outlets' ? 'multi_outlet_pos' :
        k === 'room_supplies' ? 'room_supplies' :
        k === 'corporate_clients' ? 'corporate_clients' :
        k === 'hotel_rates' ? 'hotel_rates' :
        k === 'room_types_feature' ? 'room_types' :
        k === 'online_payments' ? 'online_payments' :
        k === 'multi_property_interest' ? 'multi_property' : k)
    return {
      ...operatingAnswers,
      hospitality_mode: IS_HOSPITALITY_POS_PRODUCT ? hospitalityMode : null,
      recommended_features: recommended
    }
  }

  const handleContinueOperating = async () => {
    try {
      await window.api.settings.updateOperatingProfile(buildHospitalityOperatingProfile())
    } catch (e) {
      console.warn('[SETUP] Failed to save operating profile:', e)
    }
    setStep(3)
  }

  const getSetupErrorMessage = (res) => {
    const code = res?.code || res?.data?.auth_health?.code
    const fallback = res?.error || res?.data?.auth_health?.error || 'Could not complete setup.'

    if (IS_LODGE_PRODUCT) {
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
        return res?.error || 'This database is missing the latest Tsa Bonno auth schema. Run the checked-in Supabase migrations, then try setup again.'
      }
      if (code === 'target_user_missing') {
        return 'The new admin account was not found for this lodge after setup.'
      }
      return fallback
    }

    if (code === 'profile_already_ready') {
      return `This ${BUSINESS_NOUN} profile on this computer is already set up. Go back to the chooser and sign in instead.`
    }
    if (code === 'remote_lodge_already_exists') {
      return `This draft ${BUSINESS_NOUN} ID already exists in Supabase. Go back to the chooser and create a fresh draft.`
    }
    if (code === 'draft_profile_blocked_by_unsynced_changes') {
      return `This draft ${BUSINESS_NOUN} has unsynced offline changes. Clear or sync them before retrying setup.`
    }
    if (code === 'no_draft_profile_selected') {
      return `Choose or create a draft ${BUSINESS_NOUN} on this computer before running setup.`
    }
    if (code === 'user_create_failed') {
      return res?.error || `The admin account could not be created for this ${BUSINESS_NOUN}. Please check the database error and try again.`
    }
    if (code === 'backend_auth_schema_outdated') {
      return res?.error || 'This database is missing the latest Tsa Bonno auth schema. Run the checked-in Supabase migrations, then try setup again.'
    }
    if (code === 'target_user_missing') {
      return `The new admin account was not found for this ${BUSINESS_NOUN} after setup.`
    }
    if (code === 'settings_rls_blocked' || /row-level security/i.test(fallback)) {
      return `Could not create the ${BUSINESS_NOUN} company on the server (security policy). Restart the app after updates, or contact support if this continues.`
    }
    return fallback
  }

  const processImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const MIN_W = 128
        const MIN_H = 128
        if (img.width < MIN_W || img.height < MIN_H) {
          window.alert(`Logo is too small. Minimum size is ${MIN_W}x${MIN_H}px. Your image is ${img.width}x${img.height}px.`)
          return
        }
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
    setAdminError('')

    if (!admin.name.trim() || !admin.email.trim() || !admin.password) {
      setAdminError('All fields are required.')
      return
    }
    if (admin.password.length < 6) {
      setAdminError('Password must be at least 6 characters.')
      return
    }
    if (admin.password !== admin.confirm) {
      setAdminError('Passwords do not match.')
      return
    }

    const status = await window.api.auth.getStatus('').catch(() => ({ online: false }))
    if (!status?.online) {
      setAdminError('An internet connection is required to complete setup.')
      return
    }

    setSaving(true)
    try {
      // Always stamp hospitality_mode on final company create so bar vs restaurant
      // is never lost if the step-2 profile write was skipped or failed.
      const operatingProfile = IS_HOSPITALITY_POS_PRODUCT
        ? buildHospitalityOperatingProfile()
        : operatingAnswers
      const res = await window.api.setup.initializeCompany({
        settings: {
          ...form,
          property_type: form.property_type || 'restaurant',
          business_type: form.business_type || 'restaurant',
          operating_profile: operatingProfile
        },
        admin: {
          name: admin.name.trim(),
          email: admin.email.trim().toLowerCase(),
          password: admin.password,
          role: 'admin'
        }
      })

      if (!res?.success || !res.data?.auth_health?.ok) {
        setAdminError(getSetupErrorMessage(res))
        return
      }

      await onComplete(res.data.settings)
      navigate('/login')
    } catch (e) {
      console.error('[SETUP] CRASH:', e)
      setAdminError(e?.message || 'Setup failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const STEP_LABELS = IS_HOTEL_PRODUCT
    ? ['Property type', 'Hotel operations', 'Hotel identity', 'Contact', 'Admin access']
    : IS_HOSPITALITY_POS_PRODUCT
      ? ['Product', 'Operations', 'Business info', 'Contact', 'Admin access']
      : ['Property Type', 'Operating Questions', 'Property Info', 'Contact Details', 'Admin Account']

  const stepSubtitle = IS_HOTEL_PRODUCT ? {
    1: 'Choose hotel or resort. This sets your default PMS modules.',
    2: 'Tell us how this hotel operates so we can shape rates, F&B and front desk.',
    3: 'Hotel identity — shown on guest folios, receipts and reports.',
    4: 'Front desk and guest contact details for this property.',
    5: 'Create the hotel admin login. You can add front-desk staff after setup.'
  } : IS_HOSPITALITY_POS_PRODUCT ? {
    1: 'Register a restaurant or a bar. These are different products with different pricing — choose once.',
    2: hospitalityMode === HOSPITALITY_MODES.BAR_ONLY
      ? 'Answer a few questions about how this bar operates.'
      : 'Answer a few questions to shape POS, kitchen, stock and service modules.',
    3: 'Business identity for receipts and reports.',
    4: 'Where customers and staff can reach you.',
    5: 'Create your administrator login. Add team members after setup.'
  } : {
    1: 'What do you operate? This shapes your default modules and navigation.',
    2: 'Answer a few questions about your operations to customise your experience.',
    3: 'Tell us about your property — this appears on all receipts and invoices.',
    4: 'Where can guests and staff reach you?',
    5: 'Create your administrator login. You can add more staff accounts after setup.'
  }

  const PROPERTY_TYPE_ICONS = {
    guest_house: Home,
    bnb: BedDouble,
    lodge: Tent,
    camp: Tent,
    motel: Car,
    hotel: Hotel,
    resort: Palmtree,
    restaurant: UtensilsCrossed
  }

  const draftLabel = IS_LODGE_PRODUCT ? 'Draft Lodge Profile' : `Draft ${BUSINESS_NOUN_TITLE} profile`
  const draftName = IS_LODGE_PRODUCT ? 'New Lodge' : `New ${BUSINESS_NOUN_TITLE}`
  const nameLabel = IS_LODGE_PRODUCT
    ? 'Property / Lodge Name *'
    : IS_HOTEL_PRODUCT
      ? 'Hotel name *'
      : hospitalityMode === HOSPITALITY_MODES.BAR_ONLY
        ? 'Bar / business name *'
        : 'Restaurant / business name *'
  const namePlaceholder = IS_LODGE_PRODUCT
    ? 'e.g. Sunset Lodge, Okavango Camp...'
    : IS_HOTEL_PRODUCT
      ? 'e.g. Cresta Hotel, Delta Resort...'
      : hospitalityMode === HOSPITALITY_MODES.BAR_ONLY
        ? 'e.g. Town Bar, Corner Pub, Shebeen...'
        : 'e.g. River Bistro, Delta Grill...'
  const nameHelp = IS_LODGE_PRODUCT
    ? 'The name of your lodge as it will appear on receipts'
    : IS_HOTEL_PRODUCT
      ? 'Shown on folios, receipts, night audit and guest documents'
      : `The name of your ${BUSINESS_NOUN} as it will appear on receipts`
  const companyPlaceholder = IS_HOTEL_PRODUCT
    ? 'e.g. Cresta Hospitality (Pty) Ltd'
    : IS_HOSPITALITY_POS_PRODUCT
      ? 'e.g. River Bistro (Pty) Ltd'
      : 'e.g. Sunset Lodge (Pty) Ltd'
  const emailPlaceholder = IS_HOTEL_PRODUCT
    ? 'reservations@yourhotel.com'
    : IS_HOSPITALITY_POS_PRODUCT
      ? 'info@yourrestaurant.com'
      : 'info@yourlodge.com'
  const websitePlaceholder = IS_HOTEL_PRODUCT
    ? 'www.yourhotel.com'
    : IS_HOSPITALITY_POS_PRODUCT
      ? 'www.yourrestaurant.com'
      : 'www.yourlodge.com'
  const adminEmailPlaceholder = IS_HOTEL_PRODUCT
    ? 'gm@yourhotel.com'
    : IS_HOSPITALITY_POS_PRODUCT
      ? 'owner@yourrestaurant.com'
      : 'admin@yourlodge.com'
  const backChooserLabel = IS_LODGE_PRODUCT
    ? '← Back to Lodge Chooser'
    : IS_HOTEL_PRODUCT
      ? '← Back to hotel chooser'
      : '← Back to restaurant chooser'

  return (
    <div className={THEME.shell}>
      <div className={THEME.card}>
        <div className={THEME.header}>
          <div className="mb-4 flex h-24 w-80 max-w-full items-center">
            <img src={productLogoLight} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <h1 className={`text-2xl font-bold ${IS_HOTEL_PRODUCT ? `${HOTEL_CHROME.ink} tracking-tight` : ''}`}>
            {IS_HOTEL_PRODUCT ? 'Set up your hotel' : `Welcome to ${BUILD_PRODUCT.name}`}
          </h1>
          <p className={THEME.subtitle}>{stepSubtitle[step]}</p>
          {activeProfile && (
            <div className={`mt-4 px-4 py-3 ${IS_HOTEL_PRODUCT ? `${HOTEL_CHROME.softPanel}` : 'rounded-xl border border-white/20 bg-white/10'}`}>
              <p className={`text-[11px] uppercase tracking-wide ${THEME.draftKicker}`}>{draftLabel}</p>
              <p className={`text-sm font-semibold mt-1 ${IS_HOTEL_PRODUCT ? HOTEL_CHROME.ink : 'text-white'}`}>{activeProfile.label || draftName}</p>
              <p className={`text-[11px] break-all mt-1 ${THEME.draftMeta}`}>{activeProfile.lodge_id}</p>
            </div>
          )}
        </div>

        <div className="flex px-8 pt-5 gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className="flex items-center gap-1.5 flex-1">
              <div
                className={`w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                  IS_HOTEL_PRODUCT ? THEME.radius : 'rounded-full'
                } ${
                  step > s
                    ? THEME.stepOn
                    : step === s
                    ? THEME.stepOnRing
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {step > s ? <CheckCircle size={14} /> : s}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step === s ? THEME.stepLabel : 'text-gray-400'}`}>
                {STEP_LABELS[s - 1]}
              </span>
              {s < 5 && <div className={`flex-1 h-0.5 ${step > s ? THEME.stepBar : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="px-8 py-6">
          {step === 1 && (
            <div className="space-y-4">
              {IS_HOSPITALITY_POS_PRODUCT ? (
                <>
                  <p className="text-sm text-gray-600">
                    Choose what you are registering. <strong>Restaurant</strong> and <strong>Bar</strong> are separate products with different pricing. This cannot be changed later in the app.
                  </p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {[
                      {
                        mode: HOSPITALITY_MODES.RESTAURANT_BAR,
                        label: 'Restaurant',
                        description: 'Tables, kitchen, food production, and bar sales for a restaurant or restaurant-bar.',
                        Icon: UtensilsCrossed
                      },
                      {
                        mode: HOSPITALITY_MODES.BAR_ONLY,
                        label: 'Bar',
                        description: 'Counter sales, open tabs, drinks stock, shifts and cash-up for a bar, pub or shebeen.',
                        Icon: Wine
                      }
                    ].map(({ mode, label, description, Icon }) => {
                      const isSelected = hospitalityMode === mode
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setHospitalityMode(mode)
                            setForm((f) => ({
                              ...f,
                              property_type: 'restaurant',
                              business_type: 'restaurant'
                            }))
                          }}
                          className={`flex items-start gap-3 border-2 p-4 text-left transition-all rounded-xl ${isSelected ? THEME.selectOn : THEME.selectOff}`}
                        >
                          <div className={`mt-0.5 flex-shrink-0 p-2 rounded-lg ${isSelected ? THEME.selectIconOn : 'bg-gray-100 text-gray-400'}`}>
                            <Icon size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${isSelected ? THEME.selectTextOn : 'text-gray-700'}`}>{label}</p>
                            <p className="text-[11px] text-gray-500 mt-1 leading-snug">{description}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide mt-2 text-gray-400">
                              {mode === HOSPITALITY_MODES.BAR_ONLY ? 'Bar product' : 'Restaurant product'}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        property_type: 'restaurant',
                        business_type: 'restaurant'
                      }))
                      setStep(2)
                    }}
                    disabled={!hospitalityMode}
                    className="btn-primary w-full mt-2"
                  >
                    Next →
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    {IS_HOTEL_PRODUCT
                      ? 'Select hotel or resort. Only hotel-compatible property types are shown in this app.'
                      : 'Select the type that best describes your operation. This product only shows compatible choices.'}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {PRODUCT_PROPERTY_TYPES.map((key) => {
                      const Icon = PROPERTY_TYPE_ICONS[key] || Building2
                      const isSelected = form.property_type === key
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            property_type: key,
                            business_type: propertyTypeToBusinessType(key)
                          }))}
                          className={`flex items-start gap-3 border-2 p-3 text-left transition-all rounded-xl ${isSelected ? THEME.selectOn : THEME.selectOff}`}
                        >
                          <div className={`mt-0.5 flex-shrink-0 p-1.5 rounded-lg ${isSelected ? THEME.selectIconOn : 'bg-gray-100 text-gray-400'}`}>
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${isSelected ? THEME.selectTextOn : 'text-gray-700'}`}>
                              {PROPERTY_TYPE_LABELS[key]}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">
                              {PROPERTY_TYPE_DESCRIPTIONS[key]}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <button onClick={() => setStep(2)} disabled={!form.property_type} className="btn-primary w-full mt-2">
                    Next →
                  </button>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {IS_HOSPITALITY_POS_PRODUCT && (
                <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-[#7a2e1c]">
                  Registering as <strong>{hospitalityMode === HOSPITALITY_MODES.BAR_ONLY ? 'Bar' : 'Restaurant'}</strong>
                  {' '}· permanent product choice
                </div>
              )}
              <div className="max-h-[360px] overflow-y-auto -mx-1 px-1 space-y-2">
                {OPERATING_QUESTIONS.map((q) => (
                  <div key={q.key} className={`flex items-center justify-between bg-gray-50 p-3 border border-gray-100 rounded-lg`}>
                    <p className="text-sm text-gray-700 pr-3">{q.label}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setOA(q.key, true)}
                        className={`px-3 py-1.5 text-xs font-medium transition-all rounded-lg ${
                          operatingAnswers[q.key] ? THEME.yesOn : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setOA(q.key, false)}
                        className={`px-3 py-1.5 text-xs font-medium transition-all rounded-lg ${
                          !operatingAnswers[q.key]
                            ? 'bg-gray-600 text-white shadow-sm'
                            : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">You can change these anytime in Settings</p>
              <button onClick={handleContinueOperating} className="btn-primary w-full mt-2">
                Continue →
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 size={14} className={`inline mr-1 ${THEME.icon}`} />
                  {nameLabel}
                </label>
                <input
                  className="input"
                  placeholder={namePlaceholder}
                  value={form.lodge_name}
                  onChange={(e) => set('lodge_name', e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">{nameHelp}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Registered company name
                </label>
                <input
                  className="input"
                  placeholder={companyPlaceholder}
                  value={form.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-1">Official legal / trading company name (optional)</p>
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
                    <Hash size={14} className={`inline mr-1 ${THEME.icon}`} />
                    VAT / Tax number
                  </label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={form.vat_number}
                    onChange={(e) => set('vat_number', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Image size={14} className={`inline mr-1 ${THEME.icon}`} />
                  {IS_HOTEL_PRODUCT ? 'Hotel logo (optional)' : 'Logo (optional)'}
                </label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <div className="relative group flex-shrink-0">
                      <img src={logoPreview} alt="Logo" className="w-16 h-16 object-contain border-2 border-gray-200 bg-gray-50 p-1 rounded-lg" />
                      <button type="button" onClick={() => { setLogoPreview(null); set('logo', '') }}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center hover:bg-red-600">
                        <X size={9} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300 flex-shrink-0 rounded-lg">
                      <Image size={20} />
                    </div>
                  )}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 border-2 border-dashed border-gray-200 p-3 text-center cursor-pointer transition-colors rounded-lg ${THEME.uploadHover}`}
                  >
                    <Upload size={14} className="mx-auto mb-1 text-gray-400" />
                    <p className="text-xs text-gray-500">Click to upload logo</p>
                    <p className="text-xs text-gray-400">PNG, JPG or SVG</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*"
                    onChange={(e) => processImageFile(e.target.files[0])} className="hidden" />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1">← Back</button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!form.lodge_name.trim()}
                  className="btn-primary flex-1"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <MapPin size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Physical address
                </label>
                <input
                  className="input"
                  placeholder="Street address, plot number..."
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City / town</label>
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
                  <Phone size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Phone number
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
                  <Mail size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Email address
                </label>
                <input
                  type="email"
                  className="input"
                  placeholder={emailPlaceholder}
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Globe size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Website (optional)
                </label>
                <input
                  className="input"
                  placeholder={websitePlaceholder}
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(3)} className="btn-secondary flex-1">← Back</button>
                <button onClick={() => setStep(5)} className="btn-primary flex-1">Next →</button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Full name *
                </label>
                <input
                  className="input"
                  placeholder={IS_HOTEL_PRODUCT ? 'e.g. General Manager name' : 'e.g. John Doe'}
                  value={admin.name}
                  onChange={(e) => setAdmin((a) => ({ ...a, name: e.target.value }))}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Email address *
                </label>
                <input
                  type="email"
                  className="input"
                  placeholder={adminEmailPlaceholder}
                  value={admin.email}
                  onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
                />
                {IS_HOTEL_PRODUCT && (
                  <p className="text-xs text-gray-400 mt-1">
                    You can reuse an email already used on Restaurant POS or Lodge — this creates a separate hotel company.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Lock size={14} className={`inline mr-1 ${THEME.icon}`} />
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
                  <Lock size={14} className={`inline mr-1 ${THEME.icon}`} />
                  Confirm password *
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
                <button onClick={() => setStep(4)} className="btn-secondary flex-1">← Back</button>
                <button onClick={handleFinish} disabled={saving} className="btn-primary flex-1">
                  {saving
                    ? (IS_HOTEL_PRODUCT ? 'Creating hotel…' : 'Creating account...')
                    : (IS_HOTEL_PRODUCT ? '✓ Open hotel workspace' : '✓ Finish Setup')}
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
            {backChooserLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
