import { useEffect, useState, useRef, useContext, useMemo, lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { Building2, Phone, Mail, MapPin, Globe, Hash, Save, Upload, X, Image, Moon, RefreshCw, CheckCircle2, AlertTriangle, Key, ShieldCheck, Clock, CreditCard, Copy, TrendingUp, ArrowUpCircle, Settings as SettingsIcon, MessageCircle, FileText, Info, Send, Sparkles, Download, RotateCcw, Sun, Monitor } from 'lucide-react'
import { useSettings, UnsavedChangesContext } from '../app-context'
import { Modal } from './shared/Modal'
import { extractReleaseHighlights, formatReleaseDate, normalizeReleaseNotes, toReleaseSections } from '../utils/updatePresentation'
import { applyThemeMode, getStoredThemeMode, resolveThemeMode, saveThemeMode } from '../utils/themeMode'
const SystemHealthPanel = lazy(() => import('./SystemHealthPanel'))
const SubscriptionAccessPanel = lazy(() => import('./SubscriptionAccessPanel'))

// Update this to your actual booking site URL after deployment
const BOOKING_SITE_BASE = 'https://luminous-flan-27fdac.netlify.app'
const EMAIL_PROVIDER_PRESETS = {
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Gmail address and a Gmail App Password.'
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Outlook or Microsoft 365 email and password or app password.'
  },
  zoho: {
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Zoho mailbox and password or app password.'
  },
  cpanel: {
    label: 'cPanel / Business Email',
    host: 'mail.yourdomain.com',
    port: 465,
    allow_insecure_tls: false,
    hint: 'Use the mailbox details from your hosting provider.'
  },
  custom: {
    label: 'Other SMTP',
    host: '',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use this if your provider gave you custom SMTP details.'
  }
}

function inferEmailProvider(host = '') {
  const normalized = String(host || '').trim().toLowerCase()
  if (normalized.includes('smtp.gmail.com')) return 'gmail'
  if (normalized.includes('office365.com') || normalized.includes('outlook.com')) return 'outlook'
  if (normalized.includes('zoho.com')) return 'zoho'
  if (normalized.startsWith('mail.') || normalized.includes('cpanel')) return 'cpanel'
  return 'custom'
}

function normalizePlanName(plan) {
  const raw = String(plan || '').trim().toLowerCase()
  if (raw === 'premium') return 'Pro'
  if (raw === 'basic') return 'Starter'
  if (raw === 'pro') return 'Pro'
  if (raw === 'standard') return 'Standard'
  if (raw === 'starter') return 'Starter'
  return plan || ''
}


export default function Settings() {
  const UPDATE_SNOOZE_KEY = 'bb_update_snooze_until'
  const { settings: globalSettings, setSettings: setGlobalSettings } = useSettings()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(() => location.state?.activeTab || 'general')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [logoPreview, setLogoPreview] = useState(null)
  const [heroPreview, setHeroPreview] = useState(null)
  const [bookingFaqText, setBookingFaqText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const heroInputRef = useRef(null)
  const savedFormSnapshotRef = useRef(null)
  const savedEmailSnapshotRef = useRef(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)
  const pendingNavRef = useRef(null)
  const navGuard = useContext(UnsavedChangesContext)

  // Theme mode
  const [themeMode, setThemeMode] = useState(() => getStoredThemeMode())
  const [darkModeActive, setDarkModeActive] = useState(() => resolveThemeMode(getStoredThemeMode()))

  // App updates
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState('idle') // idle | checking | uptodate | available | error
  const [updateMessage, setUpdateMessage] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(null) // null | { percent, transferred, total }
  const [updateReady, setUpdateReady] = useState(false)
  const [updateMeta, setUpdateMeta] = useState(null)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [updateSnoozedUntil, setUpdateSnoozedUntil] = useState('')
  const updateListenersAdded = useRef(false)
  const [emailConfig, setEmailConfig] = useState({
    provider: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    user: '',
    pass: '',
    from: '',
    reply_to: '',
    to: '',
    allow_insecure_tls: false,
    auto_send_quotations: true,
    auto_send_booking_invoice: true,
    auto_send_booking_confirmation: true,
    auto_send_booking_cancellation: true
  })
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailTesting, setEmailTesting] = useState(false)
  const [emailStatus, setEmailStatus] = useState(null)
  const [emailTouched, setEmailTouched] = useState(false)

  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const isFormDirty = useMemo(() => {
    if (!form || !savedFormSnapshotRef.current) return false
    return JSON.stringify(form) !== JSON.stringify(savedFormSnapshotRef.current)
  }, [form])

  const isEmailDirty = useMemo(() => {
    if (!savedEmailSnapshotRef.current) return false
    return JSON.stringify(emailConfig) !== JSON.stringify(savedEmailSnapshotRef.current)
  }, [emailConfig])

  const isDirty = isFormDirty || (emailTouched && isEmailDirty)

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (!navGuard) return
    navGuard.current = isDirty
      ? {
          isDirty: true,
          confirmLeave: (onProceed) => {
            pendingNavRef.current = onProceed
            setShowUnsavedModal(true)
          }
        }
      : { isDirty: false, confirmLeave: null }
    return () => {
      navGuard.current = { isDirty: false, confirmLeave: null }
    }
  }, [isDirty, navGuard])

  useEffect(() => {
    if (activeTab !== 'general') return
    window.api.updates.getVersion().then(setAppVersion).catch(() => {})
    try {
      const raw = window.localStorage.getItem(UPDATE_SNOOZE_KEY)
      const until = Number(raw)
      if (Number.isFinite(until) && until > Date.now()) {
        setUpdateSnoozedUntil(new Date(until).toLocaleString())
      } else {
        setUpdateSnoozedUntil('')
      }
    } catch {
      setUpdateSnoozedUntil('')
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general') return
    window.api.updates.getState()
      .then((info) => {
        if (!info) return
        if (['available', 'downloading', 'ready', 'error'].includes(info.phase)) {
          setUpdateMeta(info)
        }
        if (info.phase === 'downloading') {
          setUpdateStatus('available')
          setUpdateMessage(info.progress?.bytesPerSecond > 0 ? `Downloading at ${formatBytes(info.progress.bytesPerSecond)}/s` : 'Downloading update…')
          setDownloadProgress(info.progress || null)
        } else if (info.phase === 'ready') {
          setUpdateReady(true)
          setUpdateStatus('available')
          setUpdateMessage('Download complete. Restart to install.')
        } else if (info.phase === 'error') {
          setUpdateStatus('error')
          setUpdateMessage(info.error || 'Update failed.')
        }
      })
      .catch(() => {})
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general') return
    let active = true
    window.api.email.getConfig()
      .then((config) => {
        if (!active || !config) return
        const provider = inferEmailProvider(config.host)
        const preset = EMAIL_PROVIDER_PRESETS[provider] || EMAIL_PROVIDER_PRESETS.custom
        const initialConfig = {
          provider,
          host: config.host || preset.host,
          port: Number(config.port) || preset.port,
          user: config.user || '',
          pass: config.pass || '',
          from: config.from || '',
          reply_to: config.reply_to || '',
          to: config.to || '',
          allow_insecure_tls: config.allow_insecure_tls === true,
          auto_send_quotations: config.auto_send_quotations === true,
          auto_send_booking_invoice: config.auto_send_booking_invoice === true,
          auto_send_booking_confirmation: config.auto_send_booking_confirmation === true,
          auto_send_booking_cancellation: config.auto_send_booking_cancellation === true
        }
        setEmailConfig(initialConfig)
        if (!savedEmailSnapshotRef.current) {
          savedEmailSnapshotRef.current = JSON.parse(JSON.stringify(initialConfig))
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general' || updateListenersAdded.current) return
    updateListenersAdded.current = true
    const cleanupAvailable = window.api.updates.onAvailable((info) => {
      setUpdateMeta(info)
      setUpdateStatus('available')
      setUpdateMessage(`v${info.version} is available to download.`)
      setDownloadProgress(null)
      setUpdateReady(false)
    })
    const cleanupNotAvailable = window.api.updates.onNotAvailable(() => {
      setUpdateMeta(null)
      setUpdateStatus('uptodate')
      setUpdateMessage('You\'re running the latest version.')
      setDownloadProgress(null)
      setUpdateReady(false)
    })
    const cleanupProgress = window.api.updates.onProgress((p) => {
      setUpdateStatus('available')
      setDownloadProgress(p)
      setUpdateMeta((current) => ({ ...(current || {}), progress: p }))
      setUpdateMessage(p.bytesPerSecond > 0 ? `Downloading at ${formatBytes(p.bytesPerSecond)}/s` : 'Preparing download...')
    })
    const cleanupReady = window.api.updates.onReady((info) => {
      setUpdateMeta(info)
      setUpdateReady(true)
      setUpdateStatus('available')
      setUpdateMessage('Download complete. Restart to install.')
    })
    const cleanupError = window.api.updates.onError((info) => {
      setUpdateStatus('error')
      setUpdateMessage(info?.message || 'Update failed.')
      setUpdateReady(false)
    })

    return () => {
      updateListenersAdded.current = false
      cleanupAvailable?.()
      cleanupNotAvailable?.()
      cleanupProgress?.()
      cleanupReady?.()
      cleanupError?.()
    }
  }, [activeTab])

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
        setUpdateMeta({
          version: res.latestVersion,
          releaseName: res.releaseName || '',
          releaseDate: res.releaseDate || '',
          releaseNotes: normalizeReleaseNotes(res.releaseNotes)
        })
        setUpdateStatus('available')
        setUpdateMessage(`v${res.latestVersion} is available to download.`)
      } else {
        setUpdateMeta(null)
        setUpdateStatus('uptodate')
        setUpdateMessage('You\'re running the latest version.')
      }
    } catch (e) {
      setUpdateStatus('error')
      setUpdateMessage(e.message || 'Update check failed.')
    }
  }

  const downloadUpdate = async () => {
    setUpdateStatus('available')
    setUpdateMessage('Preparing download...')
    setDownloadProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
    setUpdateReady(false)
    try {
      const res = await window.api.updates.download()
      if (!res?.success) {
        setUpdateStatus('error')
        setUpdateMessage(res?.error || 'Could not start the update download.')
        setDownloadProgress(null)
      }
    } catch (error) {
      setUpdateStatus('error')
      setUpdateMessage(error?.message || 'Could not start the update download.')
      setDownloadProgress(null)
    }
  }

  const snoozeUpdate = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000
    try {
      window.localStorage.setItem(UPDATE_SNOOZE_KEY, String(until))
    } catch {}
    setUpdateSnoozedUntil(new Date(until).toLocaleString())
  }

  useEffect(() => {
    setDarkModeActive(applyThemeMode(themeMode))
    if (themeMode !== 'system') return undefined
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handleSystemTheme = () => setDarkModeActive(applyThemeMode('system'))
    media.addEventListener?.('change', handleSystemTheme)
    return () => media.removeEventListener?.('change', handleSystemTheme)
  }, [themeMode])

  const setTheme = (mode) => {
    setThemeMode(mode)
    setDarkModeActive(saveThemeMode(mode))
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

  const faqToText = (items) => {
    if (!Array.isArray(items) || items.length === 0) return ''
    return items
      .map((item) => `${item?.question || ''} | ${item?.answer || ''}`.trim())
      .filter((line) => line !== '|' && line !== '')
      .join('\n')
  }

  const textToFaq = (value) => {
    return String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [question, ...rest] = line.split('|')
        return {
          question: (question || '').trim(),
          answer: rest.join('|').trim()
        }
      })
      .filter((item) => item.question && item.answer)
  }

  const normalizedPlan = normalizePlanName(licenseStatus?.plan || licenseStatus?.subscription_plan)
  const onlinePlanOk = licenseStatus?.effective_features?.online_booking === true || normalizedPlan === 'Pro'
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeSending, setUpgradeSending] = useState(false)
  const [upgradeSent, setUpgradeSent] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [generalDataLoaded, setGeneralDataLoaded] = useState(false)
  const [licenseDataLoaded, setLicenseDataLoaded] = useState(false)

  const refreshLicenseStatus = (lodgeId) => {
    if (lodgeId && window.api?.trial) {
      window.api.trial.getStatus(lodgeId).then(setLicenseStatus).catch(() => {})
    }
  }

  useEffect(() => {
    if (!globalSettings?.lodge_id || licenseDataLoaded) return
    refreshLicenseStatus(globalSettings?.lodge_id)
    setLicenseDataLoaded(true)
  }, [globalSettings?.lodge_id, licenseDataLoaded])

  useEffect(() => {
    if (activeTab !== 'license') return
    if (licenseStatus?.status === 'licensed' && globalSettings?.lodge_id && window.api?.trial?.getInvoices) {
      window.api.trial.getInvoices(globalSettings.lodge_id).then(setInvoices).catch(() => {})
    }
  }, [activeTab, licenseStatus?.status, globalSettings?.lodge_id])

  useEffect(() => {
    if (activeTab !== 'general' || generalDataLoaded) return
    setGeneralDataLoaded(true)
  }, [activeTab, generalDataLoaded])

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

  useEffect(() => {
    if (globalSettings) {
      let s = globalSettings
      if (s && !s.slug && s.lodge_name) {
        s = { ...s, slug: s.lodge_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
      }
      setForm(s)
      if (!savedFormSnapshotRef.current) {
        savedFormSnapshotRef.current = JSON.parse(JSON.stringify(s))
      }
      setLogoPreview(s?.logo || null)
      setHeroPreview(s?.hero_image || null)
      setBookingFaqText(faqToText(s?.booking_faq))
      return
    }

    window.api.settings.get().then((sn) => {
      let s = sn
      if (s && !s.slug && s.lodge_name) {
        s = { ...s, slug: s.lodge_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
      }
      setForm(s)
      if (!savedFormSnapshotRef.current) {
        savedFormSnapshotRef.current = JSON.parse(JSON.stringify(s))
      }
      setLogoPreview(s?.logo || null)
      setHeroPreview(s?.hero_image || null)
      setBookingFaqText(faqToText(s?.booking_faq))
    })
  }, [globalSettings])

  const normalizeSettingsForForm = (settings) => {
    if (!settings) return settings
    if (!settings.slug && settings.lodge_name) {
      return { ...settings, slug: settings.lodge_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
    }
    return settings
  }

  const applySavedSettings = (settings) => {
    const savedSettings = normalizeSettingsForForm(settings)
    setGlobalSettings(savedSettings)
    setForm(JSON.parse(JSON.stringify(savedSettings)))
    savedFormSnapshotRef.current = JSON.parse(JSON.stringify(savedSettings))
    setLogoPreview(savedSettings?.logo || null)
    setHeroPreview(savedSettings?.hero_image || null)
    setBookingFaqText(faqToText(savedSettings?.booking_faq))
  }

  const discardChanges = () => {
    const savedSettings = savedFormSnapshotRef.current
      ? JSON.parse(JSON.stringify(savedFormSnapshotRef.current))
      : null
    if (savedSettings) {
      setForm(savedSettings)
      setGlobalSettings(savedSettings)
      setLogoPreview(savedSettings?.logo || null)
      setHeroPreview(savedSettings?.hero_image || null)
      setBookingFaqText(faqToText(savedSettings?.booking_faq))
    }
    if (savedEmailSnapshotRef.current) {
      setEmailConfig(JSON.parse(JSON.stringify(savedEmailSnapshotRef.current)))
    }
    setEmailTouched(false)
    setSaved(false)
    setSaveError('')
  }

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const toggleAssistant = () => {
    const nextEnabled = form?.assistant_enabled !== true
    set('assistant_enabled', nextEnabled)
    setGlobalSettings((current) => current ? { ...current, assistant_enabled: nextEnabled } : current)
  }

  // ── Logo handling ──────────────────────────────────────────────────────────

  const processImageFile = (file, onDone, { max = 400, minWidth = 1, minHeight = 1, label = 'Image' } = {}) => {
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        if (img.width < minWidth || img.height < minHeight) {
          window.alert(`${label} is too small. Minimum size is ${minWidth}x${minHeight}px. Your image is ${img.width}x${img.height}px.`)
          return
        }
        const canvas = document.createElement('canvas')
        const ratio = Math.min(max / img.width, max / img.height, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/png')
        onDone(base64)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e) => {
    processImageFile(e.target.files[0], (base64) => {
      setLogoPreview(base64)
      setForm((f) => ({ ...f, logo: base64 }))
    }, { max: 400, minWidth: 128, minHeight: 128, label: 'Logo' })
  }

  const handleHeroFileChange = (e) => {
    processImageFile(e.target.files[0], (base64) => {
      setHeroPreview(base64)
      setForm((f) => ({ ...f, hero_image: base64 }))
    }, { max: 1400, minWidth: 800, minHeight: 400, label: 'Hero image' })
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    processImageFile(e.dataTransfer.files[0], (base64) => {
      setLogoPreview(base64)
      setForm((f) => ({ ...f, logo: base64 }))
    }, { max: 400, minWidth: 128, minHeight: 128, label: 'Logo' })
  }

  const removeLogo = () => {
    setLogoPreview(null)
    setForm((f) => ({ ...f, logo: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeHeroImage = () => {
    setHeroPreview(null)
    setForm((f) => ({ ...f, hero_image: '' }))
    if (heroInputRef.current) heroInputRef.current.value = ''
  }

  const handleSave = async (e) => {
    e?.preventDefault?.()
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const res = await window.api.settings.save(form)
      if (res.success) {
        applySavedSettings(res.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setSaveError(res.error || 'Settings could not be saved right now.')
      }
    } catch (err) {
      console.error(err)
      setSaveError(err?.message || 'Settings could not be saved right now.')
    }
    setSaving(false)
  }

  const setEmailField = (field, value) => {
    setEmailTouched(true)
    setEmailConfig((current) => ({ ...current, [field]: value }))
  }

  const applyEmailProvider = (provider) => {
    const preset = EMAIL_PROVIDER_PRESETS[provider] || EMAIL_PROVIDER_PRESETS.custom
    setEmailTouched(true)
    setEmailConfig((current) => ({
      ...current,
      provider,
      host: preset.host,
      port: preset.port,
      allow_insecure_tls: preset.allow_insecure_tls
    }))
    setEmailStatus(null)
  }

  const saveEmailSetup = async () => {
    setEmailSaving(true)
    setEmailStatus(null)
    try {
      const fromValue = emailConfig.from?.trim()
        || (form?.lodge_name?.trim() && emailConfig.user?.trim()
          ? `"${form.lodge_name.trim()}" <${emailConfig.user.trim()}>`
          : '')
      const result = await window.api.email.saveConfig({
        ...emailConfig,
        from: fromValue
      })
      if (result?.success) {
        setEmailStatus({ ok: true, msg: 'Email setup saved. Automatic guest emails can now use these details.' })
        const nextConfig = { ...emailConfig, from: fromValue || emailConfig.from }
        setEmailConfig(nextConfig)
        savedEmailSnapshotRef.current = JSON.parse(JSON.stringify(nextConfig))
        setEmailTouched(false)
      } else {
        setEmailStatus({ ok: false, msg: result?.error || 'Could not save email setup right now.' })
      }
    } catch (error) {
      setEmailStatus({ ok: false, msg: error?.message || 'Could not save email setup right now.' })
    }
    setEmailSaving(false)
  }

  const testEmailSetup = async () => {
    setEmailTesting(true)
    setEmailStatus(null)
    try {
      const fromValue = emailConfig.from?.trim()
        || (form?.lodge_name?.trim() && emailConfig.user?.trim()
          ? `"${form.lodge_name.trim()}" <${emailConfig.user.trim()}>`
          : '')
      const result = await window.api.email.test({
        ...emailConfig,
        from: fromValue
      })
      if (result?.success) {
        setEmailStatus({ ok: true, msg: `Test email sent to ${emailConfig.to || 'your test inbox'}.` })
      } else {
        setEmailStatus({ ok: false, msg: result?.error || 'Test email failed.' })
      }
    } catch (error) {
      setEmailStatus({ ok: false, msg: error?.message || 'Test email failed.' })
    }
    setEmailTesting(false)
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

  const tabLoader = (
    <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
      Loading panel...
    </div>
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        {activeTab === 'general' && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        )}
      </div>
      {activeTab === 'general' && (saved || saveError) && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
          saved ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {saved ? 'Settings saved successfully.' : saveError}
        </div>
      )}

{/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            data-testid={`settings-tab-${tab.id}`}
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
          {/* ── Assistant Visibility ────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Sparkles size={17} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Boroko Assistant</p>
                <p className="text-xs text-gray-400">Show Assistant in the sidebar, header, and floating guide button</p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAssistant}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                form?.assistant_enabled === true ? 'bg-green-600' : 'bg-gray-200'
              }`}
              aria-pressed={form?.assistant_enabled === true}
              aria-label="Toggle Boroko Assistant"
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                  form?.assistant_enabled === true ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* ── Theme ───────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
                <Moon size={17} className="text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Appearance</p>
                <p className="text-xs text-gray-400">
                  {themeMode === 'system'
                    ? `Following this computer: ${darkModeActive ? 'dark' : 'light'}`
                    : 'Saved on this computer'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 rounded-xl border border-gray-200 bg-gray-100 p-1 text-xs font-semibold text-gray-500">
              {[
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: Monitor }
              ].map((option) => {
                const Icon = option.icon
                const active = themeMode === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    className={`inline-flex min-w-[88px] items-center justify-center gap-2 rounded-lg px-3 py-2 transition ${
                      active ? 'bg-white text-gray-800 shadow-sm' : 'hover:text-gray-700'
                    }`}
                    aria-pressed={active}
                  >
                    <Icon size={14} />
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── App Updates ─────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                  <RefreshCw size={17} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">App Updates</p>
                  <p className="text-xs text-gray-400">
                    Current version: <span className="font-mono font-medium text-gray-600">v{appVersion || '…'}</span>
                  </p>
                  {updateMeta?.version && updateMeta.version !== appVersion && (
                    <p className="mt-1 text-xs text-blue-600">
                      Latest available: <span className="font-mono font-medium">v{updateMeta.version}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={checkForUpdates}
                  disabled={updateStatus === 'checking'}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  <RefreshCw size={13} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
                  {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
                </button>
                {updateMeta?.releaseNotes && (
                  <button
                    type="button"
                    onClick={() => setReleaseNotesOpen(true)}
                    className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-4 py-2 rounded-lg transition-colors hover:bg-slate-50"
                  >
                    <FileText size={13} />
                    View Details
                  </button>
                )}
              </div>
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

            {updateMeta?.version && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Boroko Bookings v{updateMeta.version}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[updateMeta.releaseName, formatReleaseDate(updateMeta.releaseDate)].filter(Boolean).join(' · ') || 'Latest desktop release'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!updateReady && updateMeta.version !== appVersion && (
                      <button
                        type="button"
                        onClick={downloadUpdate}
                        className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                      >
                        <Download size={13} />
                        Download Update
                      </button>
                    )}
                    {!updateReady && updateMeta.version !== appVersion && (
                      <button
                        type="button"
                        onClick={snoozeUpdate}
                        className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors hover:bg-slate-50"
                      >
                        Remind Tomorrow
                      </button>
                    )}
                    {updateReady && (
                      <button
                        type="button"
                        onClick={() => window.api.updates.install()}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                      >
                        <RotateCcw size={13} />
                        Restart to Install
                      </button>
                    )}
                  </div>
                </div>

                {extractReleaseHighlights(updateMeta.releaseNotes).length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">What this update is about</p>
                    <div className="grid gap-2">
                      {extractReleaseHighlights(updateMeta.releaseNotes).map((item) => (
                        <div key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {updateSnoozedUntil && !updateReady && updateMeta.version !== appVersion && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Update reminders are snoozed until {updateSnoozedUntil}.
                  </div>
                )}
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

          {releaseNotesOpen && (
            <Modal title={`Boroko Bookings v${updateMeta?.version || ''}`} onClose={() => setReleaseNotesOpen(false)} size="lg">
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">Release notes</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {[updateMeta?.releaseName, formatReleaseDate(updateMeta?.releaseDate)].filter(Boolean).join(' · ') || 'Latest desktop release'}
                  </p>
                </div>
                {toReleaseSections(updateMeta?.releaseNotes).length > 0 ? (
                  <div className="space-y-4">
                    {toReleaseSections(updateMeta?.releaseNotes).map((section) => (
                      <div key={section.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                        <div className="mt-3 space-y-2">
                          {section.items.map((item) => (
                            <p key={item} className="text-sm leading-6 text-slate-700">• {item}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                    {normalizeReleaseNotes(updateMeta?.releaseNotes) || 'No release notes were published for this update.'}
                  </pre>
                )}
              </div>
            </Modal>
          )}

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

            {/* ── Email Setup ─────────────────────────────────────────────── */ }
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                    <Mail size={15} className="text-green-600" /> Email Setup
                  </h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Connect your lodge email here so the system can send guest-facing emails automatically.
                  </p>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Guest email
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5">
                <p className="text-sm font-medium text-amber-900">Set this up on the main front desk computer.</p>
                <p className="text-xs text-amber-800 mt-1">
                  This computer will send quotations, booking confirmations, cancellations, and booking invoices when those actions happen here.
                </p>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email provider</label>
                    <select
                      className="input"
                      value={emailConfig.provider}
                      onChange={(e) => applyEmailProvider(e.target.value)}
                    >
                      {Object.entries(EMAIL_PROVIDER_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key}>{preset.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">{EMAIL_PROVIDER_PRESETS[emailConfig.provider]?.hint}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SMTP host</label>
                      <input className="input" value={emailConfig.host} onChange={(e) => setEmailField('host', e.target.value)} placeholder="smtp.yourprovider.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                      <input className="input" type="number" value={emailConfig.port} onChange={(e) => setEmailField('port', Number(e.target.value) || '')} placeholder="587" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email / username</label>
                      <input className="input" type="email" value={emailConfig.user} onChange={(e) => setEmailField('user', e.target.value)} placeholder="reservations@yourlodge.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password / app password</label>
                      <input className="input" type="password" value={emailConfig.pass} onChange={(e) => setEmailField('pass', e.target.value)} placeholder="Mailbox password or app password" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From line</label>
                      <input className="input" value={emailConfig.from} onChange={(e) => setEmailField('from', e.target.value)} placeholder={`"${form?.lodge_name || 'Your lodge'}" <${emailConfig.user || 'you@example.com'}>`} />
                      <p className="text-xs text-gray-400 mt-1">Leave blank to use your lodge name automatically.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reply-to address</label>
                      <input className="input" type="email" value={emailConfig.reply_to} onChange={(e) => setEmailField('reply_to', e.target.value)} placeholder="reservations@yourlodge.com" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Test inbox</label>
                    <input className="input" type="email" value={emailConfig.to} onChange={(e) => setEmailField('to', e.target.value)} placeholder="manager@yourlodge.com" />
                    <p className="text-xs text-gray-400 mt-1">We use this address for the test email and any local email checks from this computer.</p>
                  </div>

                  <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={emailConfig.allow_insecure_tls}
                      onChange={(e) => setEmailField('allow_insecure_tls', e.target.checked)}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Allow insecure TLS only if your provider asks for it</p>
                      <p className="text-xs text-gray-400">Most lodges should leave this off.</p>
                    </div>
                  </label>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles size={15} className="text-violet-600" />
                      <p className="text-sm font-semibold text-gray-800">Automatic guest emails</p>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-start gap-3">
                        <input type="checkbox" checked={emailConfig.auto_send_quotations} onChange={(e) => setEmailField('auto_send_quotations', e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Send quotation email when a quotation is marked as sent</p>
                          <p className="text-xs text-gray-400">Useful when front desk sends a quote after checking dates and rates.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3">
                        <input type="checkbox" checked={emailConfig.auto_send_booking_confirmation} onChange={(e) => setEmailField('auto_send_booking_confirmation', e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Send booking confirmation when front desk confirms a booking</p>
                          <p className="text-xs text-gray-400">Guests get a clear stay summary and balance information.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3">
                        <input type="checkbox" checked={emailConfig.auto_send_booking_invoice} onChange={(e) => setEmailField('auto_send_booking_invoice', e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Send booking invoice with the confirmation</p>
                          <p className="text-xs text-gray-400">This sends the guest-facing invoice as soon as the booking is confirmed.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3">
                        <input type="checkbox" checked={emailConfig.auto_send_booking_cancellation} onChange={(e) => setEmailField('auto_send_booking_cancellation', e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Send cancellation confirmation when front desk cancels a booking</p>
                          <p className="text-xs text-gray-400">Useful when a guest asks for written confirmation that the booking was cancelled.</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-semibold text-blue-900 mb-2">What guests will receive</p>
                    <ul className="space-y-2 text-xs text-blue-900/90">
                      <li>Quotation emails show the quoted room, dates, total, and validity date.</li>
                      <li>Booking confirmations show the stay summary, amount paid, and balance due.</li>
                      <li>Cancellation emails confirm the stay was cancelled and tell the guest to contact the lodge if needed.</li>
                      <li>Booking invoices are sent as a separate guest invoice email when enabled.</li>
                    </ul>
                  </div>

                  {emailStatus && (
                    <div className={`rounded-xl px-4 py-3 text-sm ${emailStatus.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {emailStatus.msg}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={saveEmailSetup} disabled={emailSaving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                      <Save size={15} />
                      {emailSaving ? 'Saving...' : 'Save Email Setup'}
                    </button>
                    <button type="button" onClick={testEmailSetup} disabled={emailTesting} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                      <Send size={15} />
                      {emailTesting ? 'Sending...' : 'Send Test Email'}
                    </button>
                  </div>
                </div>
              </div>
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
                  Upgrade to <strong>Pro</strong> to unlock a branded booking page for this lodge, a unique public URL, direct guest enquiries, WhatsApp contact, policies, room amenities, and a stronger direct-booking sales flow.
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    This Pro feature gives your lodge its own public booking page. Guests can browse rooms, view amenities and policies, contact you directly, and send booking requests from your unique link.
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
                    Save your settings to publish the page. Booking requests from this public lodge URL will appear as <strong>Pending</strong> in your Bookings screen for you to confirm or reject.
                  </p>

                  <div className="grid gap-4 border-t border-gray-200 pt-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Booking tagline</label>
                        <input
                          className="input"
                          value={form?.booking_tagline || ''}
                          onChange={(e) => set('booking_tagline', e.target.value)}
                          placeholder="e.g. Riverside calm, booked directly"
                        />
                        <p className="text-xs text-gray-400 mt-1">Short headline shown near the top of the booking page.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Property description</label>
                        <textarea
                          className="input resize-none"
                          rows={5}
                          value={form?.booking_description || ''}
                          onChange={(e) => set('booking_description', e.target.value)}
                          placeholder="Describe what makes your lodge special, who it suits best, and what guests can expect on arrival."
                        />
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <MessageCircle size={14} className="text-green-600" />
                          <label className="block text-xs font-medium text-gray-600">WhatsApp number</label>
                        </div>
                        <input
                          className="input"
                          value={form?.whatsapp_number || ''}
                          onChange={(e) => set('whatsapp_number', e.target.value)}
                          placeholder="e.g. 26771234567"
                        />
                        <p className="text-xs text-gray-400 mt-1">Use country code and digits only if possible, for example 26771234567.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-xs font-medium text-gray-600">Hero image</label>
                          {heroPreview && (
                            <button type="button" onClick={removeHeroImage} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                              <X size={12} /> Remove
                            </button>
                          )}
                        </div>
                        {heroPreview ? (
                          <img src={heroPreview} alt="Hero preview" className="h-36 w-full rounded-xl border border-gray-200 object-cover" />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400">
                            Upload a wide welcome image for your booking page
                          </div>
                        )}
                        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 hover:border-green-400 hover:bg-green-50/50">
                          <Image size={15} />
                          {heroPreview ? 'Replace hero image' : 'Upload hero image'}
                          <input
                            ref={heroInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleHeroFileChange}
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Check-in from</label>
                          <input
                            className="input"
                            value={form?.booking_check_in_from || ''}
                            onChange={(e) => set('booking_check_in_from', e.target.value)}
                            placeholder="e.g. 14:00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Check-out until</label>
                          <input
                            className="input"
                            value={form?.booking_check_out_until || ''}
                            onChange={(e) => set('booking_check_out_until', e.target.value)}
                            placeholder="e.g. 10:00"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 border-t border-gray-200 pt-4 lg:grid-cols-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <FileText size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">Cancellation policy</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_cancellation_policy || ''}
                        onChange={(e) => set('booking_cancellation_policy', e.target.value)}
                        placeholder="e.g. Free cancellation up to 48 hours before arrival."
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CreditCard size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">Payment terms</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_payment_terms || ''}
                        onChange={(e) => set('booking_payment_terms', e.target.value)}
                        placeholder="e.g. Deposit required to confirm. Balance due on arrival."
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Info size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">House rules / guest notes</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_house_rules || ''}
                        onChange={(e) => set('booking_house_rules', e.target.value)}
                        placeholder="e.g. No smoking indoors. Quiet hours from 22:00."
                      />
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Frequently asked questions</label>
                    <textarea
                      className="input resize-none"
                      rows={5}
                      value={bookingFaqText}
                      onChange={(e) => {
                        setBookingFaqText(e.target.value)
                        set('booking_faq', textToFaq(e.target.value))
                      }}
                      placeholder={'Use one line per FAQ.\nExample: Is breakfast included? | Yes, breakfast is served from 06:30 to 09:30.'}
                    />
                    <p className="text-xs text-gray-400 mt-1">Format each line as: question | answer</p>
                  </div>
                </>
              )}
            </div>

            {/* ── Save ─────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 pb-6">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={15} />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={discardChanges}
                  className="btn-secondary flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  Discard Changes
                </button>
              )}
              {saved && (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">✓ Settings saved successfully!</span>
              )}
              {saveError && (
                <span className="text-sm text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle size={15} /> {saveError}
                </span>
              )}
            </div>
          </form>
        </>
      )}

      {/* ── Unsaved Changes Modal ────────────────────────────────────────── */}
      {showUnsavedModal && (
        <Modal title="Unsaved Changes" onClose={() => setShowUnsavedModal(false)} size="sm">
          <p className="text-sm text-slate-600 mb-5">
            You have unsaved changes. Would you like to save them before leaving?
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowUnsavedModal(false)}
              disabled={modalSaving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                discardChanges()
                setShowUnsavedModal(false)
                pendingNavRef.current?.()
              }}
              disabled={modalSaving}
              className="btn-secondary"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                setModalSaving(true)
                setSaveError('')
                try {
                  const res = await window.api.settings.save(form)
                  if (res.success) {
                    applySavedSettings(res.data)
                    setModalSaving(false)
                    setShowUnsavedModal(false)
                    pendingNavRef.current?.()
                    return
                  }
                  setSaveError(res.error || 'Settings could not be saved right now.')
                } catch (err) {
                  console.error(err)
                  setSaveError(err?.message || 'Settings could not be saved right now.')
                }
                setModalSaving(false)
                setShowUnsavedModal(false)
              }}
              disabled={modalSaving}
              className="btn-primary flex items-center gap-2"
            >
              {modalSaving ? (
                <><RefreshCw size={14} className="animate-spin" /> Saving&hellip;</>
              ) : (
                <><Save size={14} /> Save &amp; Leave</>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          LICENSE & BILLING TAB
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'license' && (
        <Suspense fallback={tabLoader}>
          <SubscriptionAccessPanel />
        </Suspense>
      )}

      {activeTab === 'system' && (
        <Suspense fallback={tabLoader}>
          <SystemHealthPanel />
        </Suspense>
      )}
    </div>
  )
}
