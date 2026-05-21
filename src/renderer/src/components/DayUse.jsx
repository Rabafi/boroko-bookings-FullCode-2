import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  Flame,
  Mail,
  MessageCircle,
  Package,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { PAYMENT_METHOD_PLAIN_OPTIONS } from '../constants/paymentMethods'
import { useSettings } from '../app-context'
import { localToday } from '../utils/localDate'
import {
  computeDayUseBaseTotal,
  computeDayUseEndTime,
  DAY_USE_PRICING_MODES,
  DAY_USE_STATUS_OPTIONS,
  findDayUseResourceConflict,
  normalizeDayUseExtraPreset,
  normalizeDayUsePricingMode,
  normalizeDayUseResource,
  normalizeDayUseStatus,
  normalizeDayUseTemplate,
  resolveDayUseResources,
  resolveDayUseTemplates
} from '../../../shared/dayUseConfig'
import {
  formatDayUseStatus,
  getDayUseAccessSummary,
  getDayUseActivityLabel,
  normalizeDayUseReportRow,
  summarizeDayUseExtras
} from '../../../shared/dayUseReporting'

const PAYMENT_METHODS = PAYMENT_METHOD_PLAIN_OPTIONS
const ACTIVITY_OPTIONS = [
  { value: 'pool', label: 'Pool access' },
  { value: 'facility', label: 'Facility chill' },
  { value: 'braai', label: 'Braai / barbecue' },
  { value: 'mixed', label: 'Mixed day use' }
]
const PRICING_MODE_LABELS = {
  per_person: 'Per person',
  flat: 'Flat fee',
  hourly: 'Hourly',
  package: 'Package'
}
const STATUS_LABELS = {
  reserved: 'Reserved',
  checked_in: 'Checked in',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

const today = () => localToday()

const createExtraDraft = (seed = {}) => ({
  id: `${Date.now()}-${Math.random()}`,
  inventory_item_id: seed.inventory_item_id || '',
  name: seed.name || '',
  quantity: String(seed.quantity ?? '1'),
  unit_price: String(seed.unit_price ?? ''),
  unit: seed.unit || ''
})

const emptyTemplateDraft = () => ({
  key: '',
  name: '',
  description: '',
  activity_type: 'facility',
  includes_pool: false,
  includes_facility_access: true,
  includes_braai: false,
  pricing_mode: 'per_person',
  fee_per_adult: '0',
  fee_per_child: '0',
  flat_fee: '0',
  hourly_rate: '0',
  package_name: '',
  package_fee: '0',
  default_duration_hours: '0',
  bundled_extras: []
})

const emptyResourceDraft = () => ({
  key: '',
  name: '',
  type: 'general',
  notes: ''
})

function buildFormFromTemplate(settings, template = {}) {
  const normalized = normalizeDayUseTemplate(template)
  return {
    date: today(),
    guest_name: '',
    phone: '',
    adults: '1',
    children: '0',
    fee_per_adult: String((normalized.fee_per_adult ?? settings?.pool_fee_adult) || 0),
    fee_per_child: String((normalized.fee_per_child ?? settings?.pool_fee_child) || 0),
    flat_fee: String(normalized.flat_fee || 0),
    hourly_rate: String(normalized.hourly_rate || 0),
    duration_hours: String(normalized.default_duration_hours || 0),
    package_name: normalized.package_name || '',
    package_fee: String(normalized.package_fee || 0),
    payment_method: 'Cash',
    deposit_amount: '0',
    notes: '',
    service_notes: '',
    activity_type: normalized.activity_type,
    includes_pool: normalized.includes_pool === true,
    includes_facility_access: normalized.includes_facility_access !== false,
    includes_braai: normalized.includes_braai === true,
    extras: (normalized.bundled_extras || []).map((extra) => createExtraDraft(extra)),
    template_key: normalized.key,
    template_name: normalized.name,
    pricing_mode: normalized.pricing_mode,
    start_time: '',
    status: 'checked_in',
    resource_key: '',
    resource_name: '',
    resource_type: ''
  }
}

function getStatusClasses(value = '') {
  const normalized = normalizeDayUseStatus(value)
  if (normalized === 'completed') return 'bg-emerald-50 text-emerald-700'
  if (normalized === 'active') return 'bg-cyan-50 text-cyan-700'
  if (normalized === 'reserved') return 'bg-amber-50 text-amber-700'
  if (normalized === 'cancelled') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function getSyncBadge(entry = {}) {
  if (entry?._sync_state === 'failed') {
    return { tone: 'bg-rose-50 text-rose-700', label: 'Sync failed' }
  }
  if (entry?._pending_sync) {
    return { tone: 'bg-amber-50 text-amber-700', label: 'Pending sync' }
  }
  return null
}

function slugifyTemplateFallback(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildSlipReference(entry = {}) {
  return entry?.invoice_number || `DAY-${String(entry?.id || '').slice(0, 8).toUpperCase()}`
}

export default function DayUse() {
  const { settings, setSettings } = useSettings()
  const currency = settings?.currency || 'P'

  const [entries, setEntries] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(today())
  const [showForm, setShowForm] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activityFilter, setActivityFilter] = useState('all')
  const [resourceFilter, setResourceFilter] = useState('all')
  const [balanceFilter, setBalanceFilter] = useState('all')
  const templates = useMemo(() => resolveDayUseTemplates(settings || {}), [settings])
  const resources = useMemo(() => resolveDayUseResources(settings || {}), [settings])
  const defaultTemplate = templates[0] || normalizeDayUseTemplate({})
  const [form, setForm] = useState(buildFormFromTemplate(settings, defaultTemplate))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [statusUpdating, setStatusUpdating] = useState(null)
  const [settleModal, setSettleModal] = useState(null)
  const [settleMethod, setSettleMethod] = useState('Cash')
  const [settleMarkCompleted, setSettleMarkCompleted] = useState(true)
  const [settling, setSettling] = useState(false)
  const [slipEntry, setSlipEntry] = useState(null)
  const [slipSaving, setSlipSaving] = useState(false)
  const [configTemplates, setConfigTemplates] = useState(templates)
  const [configResources, setConfigResources] = useState(resources)
  const [templateDraft, setTemplateDraft] = useState(emptyTemplateDraft())
  const [resourceDraft, setResourceDraft] = useState(emptyResourceDraft())
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [configSuccess, setConfigSuccess] = useState('')

  useEffect(() => {
    setConfigTemplates(templates)
  }, [templates])

  useEffect(() => {
    setConfigResources(resources)
  }, [resources])

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryItems || []).map((item) => [item.id, item])),
    [inventoryItems]
  )
  const resourceByKey = useMemo(
    () => Object.fromEntries((resources || []).map((resource) => [resource.key, resource])),
    [resources]
  )

  const loadInventoryItems = () => {
    window.api.dayuse.getInventoryItems().then((data) => setInventoryItems(data || [])).catch(() => setInventoryItems([]))
  }

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await window.api.dayuse.getAll(selectedDate, selectedDate).catch(() => [])
      setEntries(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [selectedDate])
  useEffect(() => { loadInventoryItems() }, [])
  useEffect(() => {
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      load(true)
      loadInventoryItems()
    })
    return () => unsubscribe?.()
  }, [selectedDate])

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const adults = Math.max(0, Number(form.adults) || 0)
  const children = Math.max(0, Number(form.children) || 0)
  const normalizedPricingMode = normalizeDayUsePricingMode(form.pricing_mode)
  const durationHours = Math.max(0, Number(form.duration_hours) || 0)
  const normalizedExtras = (form.extras || []).map((entry) => ({
    ...entry,
    quantity: Number(entry.quantity) || 0,
    unit_price: Number(entry.unit_price) || 0
  }))
  const baseTotal = computeDayUseBaseTotal({
    adults,
    children,
    fee_per_adult: form.fee_per_adult,
    fee_per_child: form.fee_per_child,
    flat_fee: form.flat_fee,
    hourly_rate: form.hourly_rate,
    duration_hours: durationHours,
    package_fee: form.package_fee,
    pricing_mode: normalizedPricingMode
  })
  const extrasTotal = normalizedExtras.reduce((sum, entry) => sum + (entry.quantity * entry.unit_price), 0)
  const previewTotal = baseTotal + extrasTotal
  const depositAmount = Math.min(Math.max(0, Number(form.deposit_amount) || 0), previewTotal)
  const previewBalance = Math.max(0, previewTotal - depositAmount)
  const endTime = computeDayUseEndTime(form.start_time, durationHours)

  const resourceConflict = useMemo(() => {
    const targetResource = form.resource_key || form.resource_name
    if (!targetResource || !form.date) return null
    return findDayUseResourceConflict(
      entries.filter((entry) => entry?.date === form.date),
      {
        date: form.date,
        resource_key: form.resource_key,
        resource_name: form.resource_name,
        start_time: form.start_time,
        duration_hours: durationHours
      }
    )
  }, [durationHours, entries, form.date, form.resource_key, form.resource_name, form.start_time])

  const totalAdults = entries.reduce((sum, entry) => sum + Number(entry.adults || 0), 0)
  const totalChildren = entries.reduce((sum, entry) => sum + Number(entry.children || 0), 0)
  const totalRevenue = entries.reduce((sum, entry) => sum + Number(entry.total || 0), 0)
  const totalExtrasSold = entries.reduce((sum, entry) => sum + ((entry.extras || []).length), 0)
  const totalOutstanding = entries.reduce((sum, entry) => sum + Number(entry.balance_due || 0), 0)
  const activityStats = useMemo(() => {
    const groups = new Map()
    for (const entry of entries) {
      const key = entry.template_name || getDayUseActivityLabel(entry)
      const current = groups.get(key) || { label: key, count: 0, revenue: 0 }
      current.count += 1
      current.revenue += Number(entry.total || 0)
      groups.set(key, current)
    }
    return Array.from(groups.values()).sort((a, b) => b.revenue - a.revenue)
  }, [entries])

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase()
    return entries.filter((entry) => {
      const matchesQuery = !query || [
        entry.guest_name,
        entry.phone,
        entry.template_name,
        entry.activity_type,
        entry.resource_name,
        summarizeDayUseExtras(entry.extras)
      ].filter(Boolean).join(' ').toLowerCase().includes(query)
      const matchesStatus = statusFilter === 'all' || normalizeDayUseStatus(entry.status) === statusFilter
      const matchesActivity = activityFilter === 'all' || String(entry.activity_type || '').trim().toLowerCase() === activityFilter
      const matchesResource = resourceFilter === 'all' || (resourceFilter === 'none'
        ? !String(entry.resource_name || '').trim()
        : [entry.resource_key, entry.resource_name].map((value) => String(value || '').trim()).includes(resourceFilter))
      const matchesBalance = balanceFilter === 'all' || (balanceFilter === 'open'
        ? Number(entry.balance_due || 0) > 0
        : Number(entry.balance_due || 0) <= 0)
      return matchesQuery && matchesStatus && matchesActivity && matchesResource && matchesBalance
    })
  }, [activityFilter, balanceFilter, entries, resourceFilter, search, statusFilter])

  const openCreate = () => {
    const nextForm = buildFormFromTemplate(settings, defaultTemplate)
    nextForm.date = selectedDate || nextForm.date
    setForm(nextForm)
    setError('')
    setShowForm(true)
  }

  const handleTemplateChange = (templateKey) => {
    const template = templates.find((entry) => entry.key === templateKey) || defaultTemplate
    const nextTemplateForm = buildFormFromTemplate(settings, template)
    setForm((prev) => ({
      ...nextTemplateForm,
      date: prev.date || selectedDate || today(),
      guest_name: prev.guest_name,
      phone: prev.phone,
      notes: prev.notes,
      service_notes: prev.service_notes,
      payment_method: prev.payment_method || 'Cash',
      adults: prev.adults,
      children: prev.children,
      deposit_amount: prev.deposit_amount || '0',
      start_time: prev.start_time,
      resource_key: prev.resource_key,
      resource_name: prev.resource_name,
      resource_type: prev.resource_type
    }))
  }

  const handleActivityChange = (value) => {
    const preset = ACTIVITY_OPTIONS.find((option) => option.value === value) || ACTIVITY_OPTIONS[0]
    setForm((prev) => ({
      ...prev,
      activity_type: preset.value,
      includes_pool: preset.value === 'pool' || preset.value === 'mixed',
      includes_facility_access: ['facility', 'braai', 'mixed'].includes(preset.value),
      includes_braai: ['braai', 'mixed'].includes(preset.value)
    }))
  }

  const handleResourceChange = (resourceKey) => {
    const resource = resourceByKey[resourceKey] || null
    setForm((prev) => ({
      ...prev,
      resource_key: resourceKey,
      resource_name: resource?.name || '',
      resource_type: resource?.type || ''
    }))
  }

  const addExtra = () => setForm((prev) => ({ ...prev, extras: [...prev.extras, createExtraDraft()] }))

  const updateExtra = (extraId, patch) => {
    setForm((prev) => ({
      ...prev,
      extras: prev.extras.map((entry) => {
        if (entry.id !== extraId) return entry
        const next = { ...entry, ...patch }
        if (Object.prototype.hasOwnProperty.call(patch, 'inventory_item_id')) {
          const inventory = inventoryById[patch.inventory_item_id] || null
          next.name = inventory?.name || entry.name
          next.unit_price = inventory?.selling_price != null && inventory?.selling_price !== ''
            ? String(inventory.selling_price)
            : entry.unit_price
          next.unit = inventory?.unit || ''
        }
        return next
      })
    }))
  }

  const removeExtra = (extraId) => {
    setForm((prev) => ({ ...prev, extras: prev.extras.filter((entry) => entry.id !== extraId) }))
  }

  const updateTemplateBundleExtra = (extraId, patch) => {
    setTemplateDraft((prev) => ({
      ...prev,
      bundled_extras: (prev.bundled_extras || []).map((entry) => {
        if (entry.id !== extraId) return entry
        const next = { ...entry, ...patch }
        if (Object.prototype.hasOwnProperty.call(patch, 'inventory_item_id')) {
          const inventory = inventoryById[patch.inventory_item_id] || null
          next.name = inventory?.name || entry.name
          next.unit_price = inventory?.selling_price != null && inventory?.selling_price !== ''
            ? String(inventory.selling_price)
            : entry.unit_price
          next.unit = inventory?.unit || ''
        }
        return next
      })
    }))
  }

  const persistConfiguration = async (nextTemplates, nextResources) => {
    setConfigSaving(true)
    setConfigError('')
    setConfigSuccess('')
    try {
      const payload = {
        ...(settings || {}),
        day_use_templates: nextTemplates.map((template) => normalizeDayUseTemplate({
          ...template,
          bundled_extras: (template.bundled_extras || []).map((extra) => normalizeDayUseExtraPreset(extra))
        })),
        day_use_resources: nextResources.map((resource) => normalizeDayUseResource(resource))
      }
      const saved = await window.api.settings.save(payload)
      setSettings?.(saved)
      setConfigSuccess('Day Use setup saved.')
      setTemplateDraft(emptyTemplateDraft())
      setResourceDraft(emptyResourceDraft())
    } catch (err) {
      setConfigError(err?.message || 'Could not save Day Use setup.')
    } finally {
      setConfigSaving(false)
    }
  }

  const addTemplate = async () => {
    if (!templateDraft.name.trim()) {
      setConfigError('Template name is required.')
      return
    }
    const nextTemplates = [...configTemplates, normalizeDayUseTemplate({
      ...templateDraft,
      key: templateDraft.key || slugifyTemplateFallback(templateDraft.name) || undefined,
      bundled_extras: (templateDraft.bundled_extras || []).map((extra) => normalizeDayUseExtraPreset(extra))
    })]
    setConfigTemplates(nextTemplates)
    await persistConfiguration(nextTemplates, configResources)
  }

  const removeTemplate = async (templateKey) => {
    const nextTemplates = configTemplates.filter((template) => template.key !== templateKey)
    setConfigTemplates(nextTemplates)
    await persistConfiguration(nextTemplates, configResources)
  }

  const addResource = async () => {
    if (!resourceDraft.name.trim()) {
      setConfigError('Resource name is required.')
      return
    }
    const nextResources = [...configResources, normalizeDayUseResource(resourceDraft)]
    setConfigResources(nextResources)
    await persistConfiguration(configTemplates, nextResources)
  }

  const removeResource = async (resourceKey) => {
    const nextResources = configResources.filter((resource) => resource.key !== resourceKey)
    setConfigResources(nextResources)
    await persistConfiguration(configTemplates, nextResources)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!form.guest_name.trim()) { setError('Guest name is required'); return }
    if (!form.date) { setError('Date is required'); return }
    if (adults < 1) { setError('At least 1 adult is required'); return }
    if (resourceConflict && form.date === selectedDate) {
      setError(`Resource conflict: ${resourceConflict.resource_name || form.resource_name} is already booked for that time slot.`)
      return
    }
    for (const extra of normalizedExtras) {
      if (!(extra.quantity > 0)) continue
      if (!extra.inventory_item_id && !String(extra.name || '').trim()) {
        setError('Each extra needs an item name.')
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      await window.api.dayuse.add({
        ...form,
        adults,
        children,
        fee_per_adult: Number(form.fee_per_adult || 0),
        fee_per_child: Number(form.fee_per_child || 0),
        flat_fee: Number(form.flat_fee || 0),
        hourly_rate: Number(form.hourly_rate || 0),
        duration_hours: durationHours,
        package_fee: Number(form.package_fee || 0),
        deposit_amount: depositAmount,
        status: normalizeDayUseStatus(form.status),
        pricing_mode: normalizedPricingMode,
        end_time: endTime || null,
        extras: normalizedExtras
          .filter((entry) => entry.quantity > 0 && (entry.inventory_item_id || String(entry.name || '').trim()))
          .map((entry) => ({
            inventory_item_id: entry.inventory_item_id || null,
            name: String(entry.name || '').trim(),
            quantity: entry.quantity,
            unit_price: entry.unit_price,
            unit: entry.unit || null
          }))
      })
      setShowForm(false)
      if (form.date === selectedDate) load()
      loadInventoryItems()
    } catch (err) {
      setError(err?.message || 'Failed to save entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this day use entry?')) return
    setDeleting(id)
    await window.api.dayuse.delete(id).catch(() => {})
    setDeleting(null)
    load()
    loadInventoryItems()
  }

  const handleStatusUpdate = async (id, status) => {
    setStatusUpdating(id)
    try {
      const result = await window.api.dayuse.updateStatus(id, status)
      setEntries((prev) => prev.map((entry) => entry.id === id ? {
        ...entry,
        status,
        ...(result?.offline ? { _pending_sync: true, _sync_state: 'pending', _sync_error: null } : {})
      } : entry))
    } catch (err) {
      window.alert(err?.message || 'Could not update day-use status.')
    } finally {
      setStatusUpdating(null)
    }
  }

  const openSettleModal = (entry) => {
    setSettleModal(entry)
    setSettleMethod(entry?.payment_method || 'Cash')
    setSettleMarkCompleted(true)
  }

  const handleSettleBalance = async () => {
    if (!settleModal?.id) return
    setSettling(true)
    try {
      const result = await window.api.dayuse.settleBalance(settleModal.id, settleMethod, settleMarkCompleted)
      setEntries((prev) => prev.map((entry) => entry.id === settleModal.id ? {
        ...entry,
        payment_method: settleMethod,
        deposit_amount: Number(entry.total || 0),
        balance_due: 0,
        ...(settleMarkCompleted ? { status: 'completed' } : {}),
        ...(result?.offline ? { _pending_sync: true, _sync_state: 'pending', _sync_error: null } : {})
      } : entry))
      setSettleModal(null)
    } catch (err) {
      window.alert(err?.message || 'Could not settle the balance.')
    } finally {
      setSettling(false)
    }
  }

  const handleSaveSlipPDF = async () => {
    if (!slipEntry) return
    setSlipSaving(true)
    try {
      await window.api.receipts.savePDF({
        guestName: slipEntry.guest_name || 'Walk-in',
        bookingId: slipEntry.id,
        invoiceNumber: buildSlipReference(slipEntry)
      })
    } finally {
      setSlipSaving(false)
    }
  }

  const handleSlipWhatsApp = () => {
    if (!slipEntry?.phone) {
      window.alert('This guest does not have a phone number saved.')
      return
    }
    const row = normalizeDayUseReportRow(slipEntry)
    const message = [
      `${settings?.lodge_name || 'Lodge'} Day Use Slip`,
      '',
      `Guest: ${row.guest}`,
      `Reference: ${buildSlipReference(slipEntry)}`,
      `Date: ${row.date}`,
      `Activity: ${row.templateName || row.activityLabel}`,
      `Access: ${row.accessSummary}`,
      row.resourceName ? `Resource: ${row.resourceName}` : '',
      row.startTime ? `Time: ${row.startTime}${row.endTime ? `-${row.endTime}` : ''}` : '',
      row.extrasSummary ? `Extras: ${row.extrasSummary}` : '',
      `Total: ${currency}${row.total.toFixed(2)}`,
      `Deposit: ${currency}${row.depositAmount.toFixed(2)}`,
      `Balance: ${currency}${row.balanceDue.toFixed(2)}`
    ].filter(Boolean).join('\n')
    const phone = String(slipEntry.phone || '').replace(/\D/g, '')
    const normalizedPhone = !phone.startsWith('267') && phone.length <= 8 ? `267${phone}` : phone
    window.api.shell.openExternal(`https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`)
  }

  const handleSlipEmail = () => {
    if (!slipEntry?.phone && !slipEntry?.guest_name) return
    const row = normalizeDayUseReportRow(slipEntry)
    const subject = `Day Use Slip ${buildSlipReference(slipEntry)}`
    const message = [
      `Guest: ${row.guest}`,
      `Date: ${row.date}`,
      `Activity: ${row.templateName || row.activityLabel}`,
      `Access: ${row.accessSummary}`,
      row.resourceName ? `Resource: ${row.resourceName}` : '',
      row.extrasSummary ? `Extras: ${row.extrasSummary}` : '',
      `Total: ${currency}${row.total.toFixed(2)}`,
      `Deposit: ${currency}${row.depositAmount.toFixed(2)}`,
      `Balance Due: ${currency}${row.balanceDue.toFixed(2)}`
    ].filter(Boolean).join('\n')
    window.api.shell.openExternal(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`)
  }

  const selectedOutstandingEntries = filteredEntries.filter((entry) => Number(entry.balance_due || 0) > 0 && normalizeDayUseStatus(entry.status) !== 'cancelled')

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className={slipEntry ? 'no-print' : ''}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Briefcase size={26} className="text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Day Use</h1>
              <p className="text-sm text-gray-500">Flexible walk-in entries for pool visits, braais, workspace use, and other lodge activities.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSetup((prev) => !prev)} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors">
              <ClipboardList size={16} /> {showSetup ? 'Hide Setup' : 'Activity Setup'}
            </button>
            <button onClick={openCreate} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors">
              <Plus size={16} /> Add Entry
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <label className="text-sm font-medium text-gray-600">View date:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button onClick={() => setSelectedDate(today())} className="text-xs text-cyan-600 hover:text-cyan-800 font-medium underline">
            Today
          </button>
          <div className="ml-auto text-xs text-gray-500">
            Showing {filteredEntries.length} of {entries.length} entries
          </div>
        </div>

        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Adults</p>
            <p className="text-2xl font-bold text-gray-800">{totalAdults}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Children</p>
            <p className="text-2xl font-bold text-gray-800">{totalChildren}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center shadow-sm">
            <p className="text-xs text-amber-700 mb-1">Extras Sold</p>
            <p className="text-2xl font-bold text-amber-800">{totalExtrasSold}</p>
          </div>
          <div className="bg-cyan-50 rounded-xl border border-cyan-200 p-4 text-center shadow-sm">
            <p className="text-xs text-cyan-600 mb-1">Revenue</p>
            <p className="text-2xl font-bold text-cyan-700">{currency}{totalRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 text-center shadow-sm">
            <p className="text-xs text-violet-600 mb-1">Outstanding</p>
            <p className="text-2xl font-bold text-violet-700">{currency}{totalOutstanding.toFixed(2)}</p>
          </div>
        </div>

        {activityStats.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {activityStats.map((stat) => (
              <span key={stat.label} className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-700">
                {stat.label} · {stat.count} · {currency}{stat.revenue.toFixed(2)}
              </span>
            ))}
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
            <label className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 flex items-center gap-2">
              <Search size={14} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search guest, template, resource, or extras"
                className="w-full bg-transparent outline-none"
              />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white text-gray-700">
              <option value="all">All statuses</option>
              {DAY_USE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
            <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white text-gray-700">
              <option value="all">All activities</option>
              {ACTIVITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white text-gray-700">
              <option value="all">All resources</option>
              <option value="none">No resource</option>
              {resources.map((resource) => <option key={resource.key} value={resource.key}>{resource.name}</option>)}
            </select>
            <select value={balanceFilter} onChange={(event) => setBalanceFilter(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white text-gray-700">
              <option value="all">All balances</option>
              <option value="open">Balance due</option>
              <option value="cleared">Fully paid</option>
            </select>
          </div>
          {selectedOutstandingEntries.length > 0 && (
            <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
              <p className="text-sm font-semibold text-violet-900">Balance follow-up queue</p>
              <p className="mt-1 text-xs text-violet-700">
                {selectedOutstandingEntries.length} day-use entr{selectedOutstandingEntries.length === 1 ? 'y still carries' : 'ies still carry'} a balance on this view.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedOutstandingEntries.slice(0, 4).map((entry) => (
                  <button key={`queue-${entry.id}`} onClick={() => openSettleModal(entry)} className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-800">
                    <CreditCard size={12} />
                    {entry.guest_name} · {currency}{Number(entry.balance_due || 0).toFixed(2)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {showSetup && (
          <div className="grid gap-6 mb-8 lg:grid-cols-2">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Activity Templates</h2>
                  <p className="text-sm text-gray-500">Create lodge-specific walk-in activities, pricing defaults, and bundled extras.</p>
                </div>
              </div>
              <div className="space-y-3 mb-4">
                {configTemplates.map((template) => (
                  <div key={template.key} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900">{template.name}</p>
                        <p className="text-xs text-gray-500 mt-1">{template.description || getDayUseActivityLabel(template)}</p>
                        <p className="text-xs text-cyan-700 mt-2">
                          {PRICING_MODE_LABELS[template.pricing_mode]} · {template.activity_type}
                          {template.pricing_mode === 'per_person' ? ` · ${currency}${Number(template.fee_per_adult || 0).toFixed(2)}/adult` : ''}
                          {template.pricing_mode === 'flat' ? ` · ${currency}${Number(template.flat_fee || 0).toFixed(2)}` : ''}
                          {template.pricing_mode === 'hourly' ? ` · ${currency}${Number(template.hourly_rate || 0).toFixed(2)}/hr` : ''}
                          {template.pricing_mode === 'package' ? ` · ${template.package_name || 'Package'} ${currency}${Number(template.package_fee || 0).toFixed(2)}` : ''}
                        </p>
                        {(template.bundled_extras || []).length > 0 && (
                          <p className="text-xs text-amber-700 mt-2">
                            Bundle: {(template.bundled_extras || []).map((extra) => `${extra.name} x${extra.quantity}`).join(', ')}
                          </p>
                        )}
                      </div>
                      <button type="button" onClick={() => removeTemplate(template.key)} className="text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Template name" value={templateDraft.name} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, name: event.target.value }))} />
                <select className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={templateDraft.activity_type} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, activity_type: event.target.value }))}>
                  {ACTIVITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={templateDraft.pricing_mode} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, pricing_mode: event.target.value }))}>
                  {DAY_USE_PRICING_MODES.map((mode) => <option key={mode} value={mode}>{PRICING_MODE_LABELS[mode]}</option>)}
                </select>
                <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Description" value={templateDraft.description} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, description: event.target.value }))} />
                {templateDraft.pricing_mode === 'per_person' && (
                  <>
                    <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Adult fee" value={templateDraft.fee_per_adult} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, fee_per_adult: event.target.value }))} />
                    <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Child fee" value={templateDraft.fee_per_child} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, fee_per_child: event.target.value }))} />
                  </>
                )}
                {templateDraft.pricing_mode === 'flat' && (
                  <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm col-span-2" placeholder="Flat fee" value={templateDraft.flat_fee} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, flat_fee: event.target.value }))} />
                )}
                {templateDraft.pricing_mode === 'hourly' && (
                  <>
                    <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Hourly rate" value={templateDraft.hourly_rate} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, hourly_rate: event.target.value }))} />
                    <input type="number" min="0" step="0.5" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Default hours" value={templateDraft.default_duration_hours} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, default_duration_hours: event.target.value }))} />
                  </>
                )}
                {templateDraft.pricing_mode === 'package' && (
                  <>
                    <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Package name" value={templateDraft.package_name} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, package_name: event.target.value }))} />
                    <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Package fee" value={templateDraft.package_fee} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, package_fee: event.target.value }))} />
                  </>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={templateDraft.includes_pool} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, includes_pool: event.target.checked }))} />
                  Pool
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={templateDraft.includes_facility_access} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, includes_facility_access: event.target.checked }))} />
                  Facility
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={templateDraft.includes_braai} onChange={(event) => setTemplateDraft((prev) => ({ ...prev, includes_braai: event.target.checked }))} />
                  Braai
                </label>
              </div>

              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">Bundled extras</h3>
                    <p className="text-xs text-amber-800">Package presets can preload firewood, meat, setup, or any other add-on.</p>
                  </div>
                  <button type="button" onClick={() => setTemplateDraft((prev) => ({ ...prev, bundled_extras: [...(prev.bundled_extras || []), createExtraDraft()] }))} className="text-xs font-medium text-amber-900 hover:underline">
                    + Add bundle item
                  </button>
                </div>
                <div className="space-y-3">
                  {(templateDraft.bundled_extras || []).map((extra) => (
                    <div key={extra.id} className="grid grid-cols-[1.1fr_1.1fr_0.6fr_0.8fr_auto] gap-3 items-end">
                      <select className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={extra.inventory_item_id} onChange={(event) => updateTemplateBundleExtra(extra.id, { inventory_item_id: event.target.value })}>
                        <option value="">Custom / not stock-linked</option>
                        {inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Bundle item name" value={extra.name} onChange={(event) => updateTemplateBundleExtra(extra.id, { name: event.target.value })} />
                      <input type="number" min="0" step="0.1" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={extra.quantity} onChange={(event) => updateTemplateBundleExtra(extra.id, { quantity: event.target.value })} />
                      <input type="number" min="0" step="0.01" className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={extra.unit_price} onChange={(event) => updateTemplateBundleExtra(extra.id, { unit_price: event.target.value })} />
                      <button type="button" onClick={() => setTemplateDraft((prev) => ({ ...prev, bundled_extras: (prev.bundled_extras || []).filter((entry) => entry.id !== extra.id) }))} className="h-10 w-10 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-100">
                        <Trash2 size={14} className="mx-auto" />
                      </button>
                    </div>
                  ))}
                  {(templateDraft.bundled_extras || []).length === 0 && (
                    <div className="text-sm text-amber-800 flex items-center gap-2">
                      <Flame size={14} />
                      No bundled extras yet.
                    </div>
                  )}
                </div>
              </div>

              <button type="button" onClick={addTemplate} disabled={configSaving} className="mt-4 inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                <Save size={14} /> Add template
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Resources</h2>
              <p className="text-sm text-gray-500 mb-4">Track gazebos, braai stands, tables, lounges, and other reservable day-use spaces.</p>
              <div className="space-y-3 mb-4">
                {configResources.map((resource) => {
                  const bookingsUsingResource = entries.filter((entry) => {
                    const identities = [entry.resource_key, entry.resource_name].map((value) => String(value || '').trim())
                    return identities.includes(String(resource.key || '').trim()) || identities.includes(String(resource.name || '').trim())
                  })
                  return (
                    <div key={resource.key} className="rounded-xl border border-gray-200 p-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{resource.name}</p>
                        <p className="text-xs text-gray-500 mt-1">{resource.type}{resource.notes ? ` · ${resource.notes}` : ''}</p>
                        {bookingsUsingResource.length > 0 && (
                          <p className="text-xs text-cyan-700 mt-2">{bookingsUsingResource.length} booking(s) on {selectedDate}</p>
                        )}
                      </div>
                      <button type="button" onClick={() => removeResource(resource.key)} className="text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Resource name" value={resourceDraft.name} onChange={(event) => setResourceDraft((prev) => ({ ...prev, name: event.target.value }))} />
                <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Type" value={resourceDraft.type} onChange={(event) => setResourceDraft((prev) => ({ ...prev, type: event.target.value }))} />
                <input className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm" placeholder="Notes" value={resourceDraft.notes} onChange={(event) => setResourceDraft((prev) => ({ ...prev, notes: event.target.value }))} />
              </div>
              <button type="button" onClick={addResource} disabled={configSaving} className="mt-4 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                <Save size={14} /> Add resource
              </button>
              {(configError || configSuccess) && (
                <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${configError ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                  {configError || configSuccess}
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
            <Briefcase size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No day use entries match this view</p>
            <button onClick={openCreate} className="mt-3 text-cyan-600 text-sm font-medium hover:underline">
              Add the first entry
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEntries.map((entry) => {
              const syncBadge = getSyncBadge(entry)
              const row = normalizeDayUseReportRow(entry)
              return (
                <div key={entry.id} className={`rounded-xl border p-4 shadow-sm ${entry?._sync_state === 'failed' ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      {syncBadge && (
                        <div className="mb-2">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${syncBadge.tone}`}>
                            {syncBadge.label}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">{entry.guest_name}</p>
                        <span className="text-xs px-2 py-1 rounded-full bg-cyan-50 text-cyan-700">{entry.template_name || getDayUseActivityLabel(entry)}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${getStatusClasses(entry.status)}`}>{formatDayUseStatus(entry.status)}</span>
                        {entry.includes_braai && <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">Braai</span>}
                        {Number(entry.balance_due || 0) > 0 && <span className="text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-700">Balance {currency}{Number(entry.balance_due || 0).toFixed(2)}</span>}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {entry.adults} adult{entry.adults === 1 ? '' : 's'}{entry.children > 0 ? ` • ${entry.children} children` : ''}{entry.phone ? ` • ${entry.phone}` : ''}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {row.accessSummary}
                        {entry.start_time ? ` • ${entry.start_time}${entry.end_time ? `-${entry.end_time}` : ''}` : ''}
                        {Number(entry.duration_hours || 0) > 0 ? ` • ${Number(entry.duration_hours || 0)}h` : ''}
                        {entry.resource_name ? ` • ${entry.resource_name}` : ''}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {entry.payment_method || 'Cash'}
                        {Number(entry.deposit_amount || 0) > 0 ? ` • Deposit ${currency}${Number(entry.deposit_amount || 0).toFixed(2)}` : ''}
                      </p>
                      {entry.service_notes && <p className="text-sm text-gray-600 mt-2">{entry.service_notes}</p>}
                      {entry.notes && <p className="text-sm text-gray-600 mt-2">{entry.notes}</p>}
                      {entry._sync_state === 'failed' && entry._sync_error && (
                        <p className="mt-2 text-xs text-rose-700">{entry._sync_error}</p>
                      )}
                      {Array.isArray(entry.extras) && entry.extras.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entry.extras.map((extra, index) => (
                            <span key={`${entry.id}-extra-${index}`} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">
                              <Package size={12} />
                              {extra.name} x{Number(extra.quantity || 0)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-gray-900">{currency}{Number(entry.total || 0).toFixed(2)}</p>
                      <select
                        value={normalizeDayUseStatus(entry.status)}
                        onChange={(event) => handleStatusUpdate(entry.id, event.target.value)}
                        disabled={statusUpdating === entry.id}
                        className="mt-2 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                      >
                        {DAY_USE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                      </select>
                      <div className="mt-3 flex flex-col items-end gap-2">
                        {Number(entry.balance_due || 0) > 0 && (
                          <button onClick={() => openSettleModal(entry)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">
                            <CreditCard size={12} /> Settle balance
                          </button>
                        )}
                        <button onClick={() => setSlipEntry(entry)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-100">
                          <Printer size={12} /> Slip
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          disabled={deleting === entry.id}
                          className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Day Use Entry</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
              {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
              {resourceConflict && form.date === selectedDate && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Resource clash detected</p>
                    <p className="mt-1">{resourceConflict.resource_name || form.resource_name} is already assigned for {resourceConflict.start_time || 'an overlapping slot'}.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" value={form.date} onChange={(event) => set('date', event.target.value)} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white" value={form.template_key} onChange={(event) => handleTemplateChange(event.target.value)}>
                    {templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name *</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="e.g. John Doe" value={form.guest_name} onChange={(event) => set('guest_name', event.target.value)} required autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Optional" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.status} onChange={(event) => set('status', event.target.value)}>
                    {DAY_USE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Activity Type</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.activity_type} onChange={(event) => handleActivityChange(event.target.value)}>
                    {ACTIVITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input type="time" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.start_time} onChange={(event) => set('start_time', event.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration (hours)</label>
                  <input type="number" min="0" step="0.5" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.duration_hours} onChange={(event) => set('duration_hours', event.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adults *</label>
                  <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.adults} onChange={(event) => set('adults', event.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Children</label>
                  <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.children} onChange={(event) => set('children', event.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Resource</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.resource_key} onChange={(event) => handleResourceChange(event.target.value)}>
                    <option value="">No assigned resource</option>
                    {resources.map((resource) => <option key={resource.key} value={resource.key}>{resource.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Custom Resource Name</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.resource_name} onChange={(event) => set('resource_name', event.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-cyan-900">Pricing</h3>
                    <p className="text-xs text-cyan-800">Choose how this walk-in activity is charged.</p>
                  </div>
                  {endTime && <span className="text-xs font-medium text-cyan-700">Ends at {endTime}</span>}
                </div>
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pricing Mode</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={form.pricing_mode} onChange={(event) => set('pricing_mode', event.target.value)}>
                      {DAY_USE_PRICING_MODES.map((mode) => <option key={mode} value={mode}>{PRICING_MODE_LABELS[mode]}</option>)}
                    </select>
                  </div>
                  {normalizedPricingMode === 'per_person' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Adult Fee ({currency})</label>
                        <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.fee_per_adult} onChange={(event) => set('fee_per_adult', event.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Child Fee ({currency})</label>
                        <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.fee_per_child} onChange={(event) => set('fee_per_child', event.target.value)} />
                      </div>
                    </>
                  )}
                  {normalizedPricingMode === 'flat' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Flat Fee ({currency})</label>
                      <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.flat_fee} onChange={(event) => set('flat_fee', event.target.value)} />
                    </div>
                  )}
                  {normalizedPricingMode === 'hourly' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate ({currency})</label>
                      <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.hourly_rate} onChange={(event) => set('hourly_rate', event.target.value)} />
                    </div>
                  )}
                  {normalizedPricingMode === 'package' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Package Name</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.package_name} onChange={(event) => set('package_name', event.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Package Fee ({currency})</label>
                        <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.package_fee} onChange={(event) => set('package_fee', event.target.value)} />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Deposit ({currency})</label>
                    <input type="number" step="0.01" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={form.deposit_amount} onChange={(event) => set('deposit_amount', event.target.value)} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">Optional extras</h3>
                    <p className="text-xs text-amber-800">Package bundles preload here automatically. Stock-linked extras come only from Others inventory.</p>
                  </div>
                  <button type="button" onClick={addExtra} className="text-xs font-medium text-amber-900 hover:underline">
                    + Add extra
                  </button>
                </div>
                <div className="space-y-3">
                  {form.extras.map((extra) => (
                    <div key={extra.id} className="grid grid-cols-[1.2fr_1.2fr_0.6fr_0.8fr_auto] gap-3 items-end">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Inventory item</label>
                        <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white" value={extra.inventory_item_id} onChange={(event) => updateExtra(extra.id, { inventory_item_id: event.target.value })}>
                          <option value="">Custom / not stock-linked</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({Number(item.current_stock || 0)} {item.unit || 'unit'})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Item name</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={extra.name} onChange={(event) => updateExtra(extra.id, { name: event.target.value })} placeholder="e.g. Firewood bundle" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                        <input type="number" min="0" step="0.1" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={extra.quantity} onChange={(event) => updateExtra(extra.id, { quantity: event.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Unit price</label>
                        <input type="number" min="0" step="0.01" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={extra.unit_price} onChange={(event) => updateExtra(extra.id, { unit_price: event.target.value })} />
                      </div>
                      <button type="button" onClick={() => removeExtra(extra.id)} className="h-10 w-10 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-100">
                        <Trash2 size={14} className="mx-auto" />
                      </button>
                    </div>
                  ))}
                  {form.extras.length === 0 && (
                    <div className="text-sm text-amber-800 flex items-center gap-2">
                      <Flame size={14} />
                      No extras added for this visit.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white" value={form.payment_method} onChange={(event) => set('payment_method', event.target.value)}>
                    {PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service Notes</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Setup, equipment, or staffing notes..." value={form.service_notes} onChange={(event) => set('service_notes', event.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">General Notes</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Optional notes..." value={form.notes} onChange={(event) => set('notes', event.target.value)} />
              </div>

              <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-cyan-700">Entry total</p>
                  <p className="text-xs text-cyan-600">
                    Base {currency}{baseTotal.toFixed(2)} + Extras {currency}{extrasTotal.toFixed(2)} - Deposit {currency}{depositAmount.toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-cyan-800">{currency}{previewTotal.toFixed(2)}</span>
                  <p className="text-xs text-cyan-700">Balance {currency}{previewBalance.toFixed(2)}</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-5 py-2.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-lg transition-colors">
                  {saving ? 'Saving...' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {settleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Settle Day Use Balance</h2>
              <button onClick={() => setSettleModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="mt-2 text-sm text-gray-600">{settleModal.guest_name} still owes {currency}{Number(settleModal.balance_due || 0).toFixed(2)}.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white" value={settleMethod} onChange={(event) => setSettleMethod(event.target.value)}>
                  {PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={settleMarkCompleted} onChange={(event) => setSettleMarkCompleted(event.target.checked)} />
                Mark the entry as completed after payment
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setSettleModal(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSettleBalance} disabled={settling} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
                <CheckCircle2 size={14} /> {settling ? 'Saving...' : 'Settle Balance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {slipEntry && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50 no-print" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:static print:block print:p-0">
            <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 no-print">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Day Use Slip</h2>
                  <p className="text-sm text-gray-500">Printable or shareable summary for this walk-in visit.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveSlipPDF} disabled={slipSaving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    <Download size={14} /> {slipSaving ? 'Saving...' : 'Save PDF'}
                  </button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
                    <Printer size={14} /> Print
                  </button>
                  <button onClick={handleSlipWhatsApp} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
                    <MessageCircle size={14} /> WhatsApp
                  </button>
                  <button onClick={handleSlipEmail} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    <Mail size={14} /> Email
                  </button>
                  <button onClick={() => setSlipEntry(null)} className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="p-8 print:p-8">
                <div className="text-center border-b border-dashed border-gray-300 pb-6">
                  <p className="text-xs uppercase tracking-[0.25em] text-cyan-700 font-semibold">Day Use Slip</p>
                  <h1 className="mt-2 text-3xl font-black text-gray-900">{settings?.lodge_name || settings?.company_name || 'Lodge'}</h1>
                  <p className="mt-2 text-sm text-gray-500">{buildSlipReference(slipEntry)} · {normalizeDayUseReportRow(slipEntry).date}</p>
                </div>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Guest</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{slipEntry.guest_name || 'Walk-in'}</p>
                      {slipEntry.phone && <p className="text-sm text-gray-500">{slipEntry.phone}</p>}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Activity</p>
                      <p className="mt-1 text-base font-semibold text-gray-900">{slipEntry.template_name || getDayUseActivityLabel(slipEntry)}</p>
                      <p className="text-sm text-gray-500">{getDayUseAccessSummary(slipEntry)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Timing</p>
                      <p className="mt-1 text-sm text-gray-700">
                        {slipEntry.start_time ? `${slipEntry.start_time}${slipEntry.end_time ? ` - ${slipEntry.end_time}` : ''}` : 'Time not recorded'}
                        {Number(slipEntry.duration_hours || 0) > 0 ? ` · ${Number(slipEntry.duration_hours || 0)}h` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Resource</p>
                      <p className="mt-1 text-sm text-gray-700">{slipEntry.resource_name || 'No assigned resource'}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-cyan-800">Total</span>
                      <span className="text-xl font-bold text-cyan-900">{currency}{Number(slipEntry.total || 0).toFixed(2)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm text-cyan-800">Deposit</span>
                      <span className="font-semibold text-cyan-900">{currency}{Number(slipEntry.deposit_amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-cyan-800">Balance Due</span>
                      <span className="font-semibold text-violet-700">{currency}{Number(slipEntry.balance_due || 0).toFixed(2)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-cyan-800">Payment Method</span>
                      <span className="font-semibold text-cyan-900">{slipEntry.payment_method || 'Cash'}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-cyan-800">Status</span>
                      <span className="font-semibold text-cyan-900">{formatDayUseStatus(slipEntry.status)}</span>
                    </div>
                  </div>
                </div>
                {Array.isArray(slipEntry.extras) && slipEntry.extras.length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Extras</p>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200">
                      {slipEntry.extras.map((extra, index) => (
                        <div key={`slip-extra-${index}`} className="flex items-center justify-between border-b last:border-b-0 border-gray-100 px-4 py-3 text-sm">
                          <span className="text-gray-700">{extra.name} x{Number(extra.quantity || 0)}</span>
                          <span className="font-medium text-gray-900">{currency}{(Number(extra.quantity || 0) * Number(extra.unit_price || 0)).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(slipEntry.service_notes || slipEntry.notes) && (
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Service Notes</p>
                      <p className="mt-2 text-sm text-gray-700">{slipEntry.service_notes || 'No service notes.'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-gray-500">General Notes</p>
                      <p className="mt-2 text-sm text-gray-700">{slipEntry.notes || 'No notes.'}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
