function slugifyKey(value, fallback = 'day-use') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
}

export const DEFAULT_DAY_USE_TEMPLATES = [
  {
    key: 'pool-access',
    name: 'Pool Access',
    description: 'Classic swimming day pass for walk-in guests.',
    activity_type: 'pool',
    includes_pool: true,
    includes_facility_access: false,
    includes_braai: false,
    pricing_mode: 'per_person',
    fee_per_adult: 0,
    fee_per_child: 0,
    default_duration_hours: 0,
    bundled_extras: [],
    package_name: '',
    package_fee: 0,
    flat_fee: 0,
    hourly_rate: 0
  },
  {
    key: 'facility-chill',
    name: 'Facility Chill',
    description: 'General facility access for day visitors using lounges, bar, or kitchen.',
    activity_type: 'facility',
    includes_pool: false,
    includes_facility_access: true,
    includes_braai: false,
    pricing_mode: 'flat',
    fee_per_adult: 0,
    fee_per_child: 0,
    default_duration_hours: 0,
    bundled_extras: [],
    package_name: '',
    package_fee: 0,
    flat_fee: 0,
    hourly_rate: 0
  },
  {
    key: 'braai-package',
    name: 'Braai / Barbecue',
    description: 'Walk-in braai access with optional firewood and meat extras.',
    activity_type: 'braai',
    includes_pool: false,
    includes_facility_access: true,
    includes_braai: true,
    pricing_mode: 'package',
    fee_per_adult: 0,
    fee_per_child: 0,
    default_duration_hours: 4,
    bundled_extras: [
      { inventory_item_id: null, name: 'Firewood bundle', quantity: 1, unit_price: 0, unit: '' },
      { inventory_item_id: null, name: 'Braai setup', quantity: 1, unit_price: 0, unit: '' }
    ],
    package_name: 'Braai package',
    package_fee: 0,
    flat_fee: 0,
    hourly_rate: 0
  },
  {
    key: 'workspace-hourly',
    name: 'Workspace / Meeting Corner',
    description: 'Hourly use of a work table, lounge, or small meeting corner.',
    activity_type: 'facility',
    includes_pool: false,
    includes_facility_access: true,
    includes_braai: false,
    pricing_mode: 'hourly',
    fee_per_adult: 0,
    fee_per_child: 0,
    default_duration_hours: 2,
    bundled_extras: [],
    package_name: '',
    package_fee: 0,
    flat_fee: 0,
    hourly_rate: 0
  }
]

export const DEFAULT_DAY_USE_RESOURCES = [
  { key: 'gazebo-1', name: 'Gazebo 1', type: 'gazebo', notes: '' },
  { key: 'gazebo-2', name: 'Gazebo 2', type: 'gazebo', notes: '' },
  { key: 'braai-stand-1', name: 'Braai Stand 1', type: 'braai-stand', notes: '' },
  { key: 'picnic-table-1', name: 'Picnic Table 1', type: 'picnic-table', notes: '' }
]

export const DAY_USE_STATUS_OPTIONS = ['reserved', 'checked_in', 'active', 'completed', 'cancelled']
export const DAY_USE_PRICING_MODES = ['per_person', 'flat', 'hourly', 'package']

export function normalizeDayUseExtraPreset(extra = {}) {
  return {
    inventory_item_id: extra.inventory_item_id || null,
    name: String(extra.name || '').trim(),
    quantity: Math.max(0, Number(extra.quantity || 0)),
    unit_price: Math.max(0, Number(extra.unit_price || 0)),
    unit: String(extra.unit || '').trim()
  }
}

export function normalizeDayUseTemplate(template = {}) {
  const key = slugifyKey(template.key || template.name || 'day-use')
  const pricingMode = DAY_USE_PRICING_MODES.includes(template.pricing_mode) ? template.pricing_mode : 'per_person'
  return {
    key,
    name: String(template.name || 'Day Use').trim() || 'Day Use',
    description: String(template.description || '').trim(),
    activity_type: String(template.activity_type || 'facility'),
    includes_pool: template.includes_pool === true,
    includes_facility_access: template.includes_facility_access !== false,
    includes_braai: template.includes_braai === true,
    pricing_mode: pricingMode,
    fee_per_adult: Number(template.fee_per_adult || 0),
    fee_per_child: Number(template.fee_per_child || 0),
    flat_fee: Number(template.flat_fee || 0),
    hourly_rate: Number(template.hourly_rate || 0),
    package_name: String(template.package_name || '').trim(),
    package_fee: Number(template.package_fee || 0),
    default_duration_hours: Number(template.default_duration_hours || 0),
    bundled_extras: (Array.isArray(template.bundled_extras) ? template.bundled_extras : [])
      .map(normalizeDayUseExtraPreset)
      .filter((extra) => extra.quantity > 0 && (extra.inventory_item_id || extra.name))
  }
}

export function normalizeDayUseResource(resource = {}) {
  const key = slugifyKey(resource.key || resource.name || 'resource')
  return {
    key,
    name: String(resource.name || 'Resource').trim() || 'Resource',
    type: String(resource.type || 'general').trim() || 'general',
    notes: String(resource.notes || '').trim()
  }
}

export function resolveDayUseTemplates(settings = {}) {
  const rows = Array.isArray(settings?.day_use_templates)
    ? settings.day_use_templates
    : DEFAULT_DAY_USE_TEMPLATES
  return rows.map(normalizeDayUseTemplate)
}

export function resolveDayUseResources(settings = {}) {
  const rows = Array.isArray(settings?.day_use_resources)
    ? settings.day_use_resources
    : DEFAULT_DAY_USE_RESOURCES
  return rows.map(normalizeDayUseResource)
}

export function normalizeDayUseStatus(value = 'checked_in') {
  const normalized = String(value || 'checked_in').trim().toLowerCase()
  return DAY_USE_STATUS_OPTIONS.includes(normalized) ? normalized : 'checked_in'
}

export function normalizeDayUsePricingMode(value = 'per_person') {
  const normalized = String(value || 'per_person').trim().toLowerCase()
  return DAY_USE_PRICING_MODES.includes(normalized) ? normalized : 'per_person'
}

export function computeDayUseBaseTotal(payload = {}) {
  const pricingMode = normalizeDayUsePricingMode(payload.pricing_mode)
  const adults = Math.max(0, Number(payload.adults || 0))
  const children = Math.max(0, Number(payload.children || 0))
  const feePerAdult = Math.max(0, Number(payload.fee_per_adult || 0))
  const feePerChild = Math.max(0, Number(payload.fee_per_child || 0))
  const flatFee = Math.max(0, Number(payload.flat_fee || 0))
  const hourlyRate = Math.max(0, Number(payload.hourly_rate || 0))
  const durationHours = Math.max(0, Number(payload.duration_hours || 0))
  const packageFee = Math.max(0, Number(payload.package_fee || 0))

  if (pricingMode === 'flat') return flatFee
  if (pricingMode === 'hourly') return hourlyRate * durationHours
  if (pricingMode === 'package') return packageFee
  return (adults * feePerAdult) + (children * feePerChild)
}

export function computeDayUseEndTime(startTime = '', durationHours = 0) {
  const raw = String(startTime || '').trim()
  if (!/^\d{2}:\d{2}$/.test(raw)) return ''
  const [hours, minutes] = raw.split(':').map((part) => Number(part || 0))
  const totalMinutes = (hours * 60) + minutes + Math.max(0, Math.round(Number(durationHours || 0) * 60))
  const nextHours = Math.floor(totalMinutes / 60) % 24
  const nextMinutes = totalMinutes % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function toMinutes(startTime = '', durationHours = 0) {
  const raw = String(startTime || '').trim()
  if (!/^\d{2}:\d{2}$/.test(raw)) return null
  const [hours, minutes] = raw.split(':').map((part) => Number(part || 0))
  return {
    start: (hours * 60) + minutes,
    end: (hours * 60) + minutes + Math.max(0, Math.round(Number(durationHours || 0) * 60))
  }
}

function resolveResourceIdentities(entry = {}) {
  return [entry.resource_key, entry.resource_name]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
}

export function findDayUseResourceConflict(entries = [], payload = {}, excludeId = null) {
  const resourceIdentities = resolveResourceIdentities(payload)
  const targetDate = String(payload.date || '').trim()
  if (resourceIdentities.length === 0 || !targetDate) return null

  const candidateWindow = toMinutes(payload.start_time, payload.duration_hours)
  const sourceEntries = Array.isArray(entries) ? entries : []
  for (const entry of sourceEntries) {
    if (!entry || entry.id === excludeId) continue
    if (String(entry.status || '').trim().toLowerCase() === 'cancelled') continue
    if (String(entry.date || '').trim() !== targetDate) continue
    const entryIdentities = resolveResourceIdentities(entry)
    if (!entryIdentities.some((identity) => resourceIdentities.includes(identity))) continue
    const entryWindow = toMinutes(entry.start_time, entry.duration_hours)
    if (!candidateWindow || !entryWindow) return entry
    if (candidateWindow.start < entryWindow.end && candidateWindow.end > entryWindow.start) {
      return entry
    }
  }
  return null
}
