import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { state } from '../state.js'

// JSON remains the canonical recovery representation. The customer-facing
// .tbbackup envelope adds a manifest, checksums, readme, and optional encryption.
const STARTER_BACKUP_SCHEMA = 'tsa-bonno-starter-backup/v1'
const STARTER_BACKUP_PACKAGE_SCHEMA = 'tsa-bonno-starter-backup-package/v2'
const STARTER_BACKUP_PACKAGE_SCHEMA_V3 = 'tsa-bonno-starter-backup-package/v3'
// v3 is the only format emitted by the current exporter. v2 remains a
// read-only import adapter for packages made by older builds.
const DEFAULT_PACKAGE_SCHEMA = STARTER_BACKUP_PACKAGE_SCHEMA_V3
const SUPPORTED_PACKAGE_SCHEMAS = new Set([STARTER_BACKUP_PACKAGE_SCHEMA, STARTER_BACKUP_PACKAGE_SCHEMA_V3])
const MAX_ROWS_PER_TABLE = 100000
const MAX_HISTORY_ENTRIES = 20
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024
const REQUIRED_TABLE_KEYS = ['settings', 'rooms', 'customers', 'bookings', 'quotations', 'signed_payment_ledger', 'maintenance']
const PROTECTED_FIELD_NAMES = new Set([
  'lodge_mesh_secret', 'idempotency_key', 'password', 'password_hash',
  'pin', 'pin_hash', 'access_token', 'refresh_token', 'service_role_key',
  'secret_key', 'private_key', 'online_confirmation_token'
])
// Binary identity artifacts and uploaded media are not recovery DTO fields.
// Legacy packages may contain them; the sanitizer counts and omits them.
const EXCLUDED_RESTORE_FIELD_NAMES = new Set(['id_photo', 'logo', 'hero_image', 'photo', 'photos'])
const BOOKING_ACCOMMODATION_DETAIL_FIELDS = new Set(['booking_id', 'lodge_id', 'accommodation_kind', 'adults', 'children', 'tents', 'vehicles', 'rate_mode', 'pricing_snapshot', 'created_at'])
const BOOKING_PRICING_SNAPSHOT_FIELDS = new Set(['nights', 'site_rate', 'person_rate', 'tent_rate', 'vehicle_rate', 'people', 'tents', 'vehicles', 'calculated_total'])
// Restore DTO allowlist: explicit per-table field contracts. The restore path
// strips or rejects any field not listed here; `select('*')` is an export
// convenience and not a restore contract.
const RESTORE_FIELD_ALLOWLIST = {
  settings: new Set(['id', 'lodge_id', 'lodge_name', 'company_name', 'address', 'city', 'country', 'phone', 'email', 'website', 'vat_number', 'currency', 'setup_complete', 'created_at', 'updated_at', 'business_type', 'property_type', 'vat_enabled', 'vat_rate', 'deleted', 'slug', 'booking_tagline', 'booking_description', 'whatsapp_number', 'booking_check_in_from', 'booking_check_out_until', 'booking_cancellation_policy', 'booking_payment_terms', 'booking_house_rules', 'booking_faq', 'assistant_enabled', 'timezone', 'public_offer_rooms', 'public_offer_multi_room', 'public_offer_full_lodge', 'public_offer_day_use', 'public_offer_events', 'public_offer_campsites', 'operating_profile']),
  // Keep the historical aliases for importing older packages, but emit and
  // restore the current rooms schema (rate_per_night/max_occupancy plus the
  // housekeeping and campsite pricing fields).
  rooms: new Set(['id', 'lodge_id', 'room_number', 'room_type', 'room_type_id', 'floor_section_id', 'rate_per_night', 'max_occupancy', 'status', 'housekeeping_status', 'housekeeping_notes', 'description', 'created_at', 'updated_at', 'amenities', 'accommodation_kind', 'capacity_adults', 'capacity_children', 'max_tents', 'max_vehicles', 'is_powered', 'site_surface', 'shared_facilities', 'rate_mode', 'rate_per_person', 'rate_per_tent', 'rate_per_vehicle', 'floor', 'capacity', 'price_per_night']),
  customers: new Set(['id', 'lodge_id', 'name', 'email', 'phone', 'address', 'id_number', 'is_blacklisted', 'blacklist_reason', 'created_at', 'updated_at', 'date_of_birth', 'nationality', 'notes']),
  // amount_paid and payment_status are deliberately excluded: both are
  // database-derived from the signed payment ledger during a real restore.
  bookings: new Set(['id', 'lodge_id', 'room_id', 'customer_id', 'check_in', 'check_out', 'adults', 'children', 'tents_count', 'vehicles_count', 'accommodation_kind', 'booking_accommodation_details', 'status', 'total_amount', 'deposit_amount', 'payment_method', 'charges_total', 'created_at', 'updated_at', 'created_by', 'booking_number', 'invoice_number', 'is_exclusive_event', 'event_daily_rate', 'cancelled_at', 'cancel_reason', 'quotation_id', 'notes', 'source', 'group_id', 'vat_enabled', 'vat_rate']),
  quotations: new Set(['id', 'quotation_number', 'lodge_id', 'customer_id', 'customer_name', 'customer_phone', 'room_id', 'room_name', 'check_in', 'check_out', 'adults', 'children', 'subtotal', 'tax_amount', 'total_amount', 'currency', 'notes', 'status', 'valid_until', 'converted_booking_id', 'created_by', 'created_at', 'updated_at', 'parent_quotation_id', 'quotation_type', 'event_name', 'event_daily_rate', 'accommodation_lines']),
  signed_payment_ledger: new Set(['id', 'booking_id', 'conference_booking_id', 'lodge_id', 'amount', 'method', 'type', 'paid_at', 'recorded_by', 'notes', 'created_at']),
  // `issue`/`description` remain for older cache/package rows; the current
  // maintenance ticket contract also carries title, notes, costs, vendor,
  // reported_date, and completed_at.
  maintenance: new Set(['id', 'lodge_id', 'room_id', 'title', 'issue', 'description', 'notes', 'status', 'priority', 'reported_date', 'reported_by', 'labour_cost', 'parts_cost', 'total_cost', 'vendor_name', 'cost_notes', 'created_at', 'updated_at', 'resolved_at', 'completed_at'])
}
// Unique-value fields that must be regenerated when remapping into a recovery
// target where the source lodge still exists.
const UNIQUE_REGENERATED_FIELDS = {
  settings: ['slug'],
  bookings: ['id'],
  customers: ['id'],
  rooms: ['id'],
  quotations: ['id'],
  signed_payment_ledger: ['id'],
  maintenance: ['id']
}
const CORE_TABLE_SPECS = [
  { key: 'settings', table: 'settings', cache: 'settings', order: 'updated_at', select: 'id,lodge_id,lodge_name,company_name,address,city,country,phone,email,website,vat_number,currency,setup_complete,created_at,updated_at,business_type,property_type,vat_enabled,vat_rate,deleted,slug,booking_tagline,booking_description,whatsapp_number,booking_check_in_from,booking_check_out_until,booking_cancellation_policy,booking_payment_terms,booking_house_rules,booking_faq,assistant_enabled,timezone,public_offer_rooms,public_offer_multi_room,public_offer_full_lodge,public_offer_day_use,public_offer_events,public_offer_campsites,operating_profile' },
  { key: 'rooms', table: 'rooms', cache: 'rooms', order: 'room_number', select: 'id,lodge_id,room_number,room_type,room_type_id,floor_section_id,rate_per_night,max_occupancy,status,housekeeping_status,housekeeping_notes,description,created_at,photo,photos,amenities,updated_at,accommodation_kind,capacity_adults,capacity_children,max_tents,max_vehicles,is_powered,site_surface,shared_facilities,rate_mode,rate_per_person,rate_per_tent,rate_per_vehicle' },
  { key: 'customers', table: 'customers', cache: 'customers', order: 'name', select: 'id,lodge_id,name,email,phone,id_number,address,nationality,notes,is_blacklisted,blacklist_reason,created_at,updated_at' },
  { key: 'bookings', table: 'bookings', cache: 'bookings', order: 'check_in', select: 'id,lodge_id,room_id,customer_id,check_in,check_out,adults,children,tents_count,vehicles_count,accommodation_kind,total_amount,deposit_amount,payment_method,status,notes,created_by,updated_at,created_at,booking_number,invoice_number,is_exclusive_event,event_daily_rate,quotation_id,charges_total,source,vat_enabled,vat_rate,cancel_reason,cancelled_at,booking_accommodation_details(booking_id,lodge_id,accommodation_kind,adults,children,tents,vehicles,rate_mode,pricing_snapshot,created_at)' },
  { key: 'quotations', table: 'quotations', cache: 'quotations', order: 'created_at', select: 'id,quotation_number,lodge_id,customer_id,customer_name,customer_phone,room_id,room_name,check_in,check_out,adults,children,subtotal,tax_amount,total_amount,currency,notes,status,valid_until,converted_booking_id,created_by,created_at,updated_at,parent_quotation_id,quotation_type,event_name,event_daily_rate,accommodation_lines' },
  { key: 'signed_payment_ledger', table: 'payments', cache: 'payments', order: 'created_at', select: 'id,booking_id,conference_booking_id,lodge_id,amount,method,type,paid_at,recorded_by,notes,created_at' },
  { key: 'maintenance', table: 'maintenance_tickets', cache: 'maintenance', order: 'created_at', select: 'id,lodge_id,room_id,title,description,status,priority,reported_date,notes,labour_cost,parts_cost,total_cost,vendor_name,cost_notes,created_at' }
]
const INCLUDED_CATEGORIES = ['property settings', 'rooms', 'guest/customer records', 'bookings', 'quotations', 'signed payment ledger', 'maintenance tickets']
const EXCLUDED_CATEGORIES = ['uploaded documents and images', 'invoices and expenses', 'inventory and supplies', 'POS sales and cash-up', 'conference/day-use/event records', 'staff accounts and credentials', 'audit logs', 'sync queues and local cache state', 'managed backup policy and files']
const RECOVERY_README = [
  'TSA BONNO HOSPITALITYOS — CORE DATA RECOVERY EXPORT', '',
  'This .tbbackup file is a customer-owned, support-led recovery package.',
  'It is not a live restore file and it must not be imported by editing the application database.', '',
  'Keep this file confidential: it contains guest personal data and operational history.',
  'If encrypted, the passphrase is never stored in this file. Share it with support through a separate secure channel.',
  'Contact authorized Tsa Bonno support for validation and recovery into a disposable environment.', '',
  `Package format: ${DEFAULT_PACKAGE_SCHEMA} (older ${STARTER_BACKUP_PACKAGE_SCHEMA} packages can still be checked)`
].join('\n') + '\n'

function stableStringify(value) {
  // Deterministic JSON serialization for per-table canonical hashes.
  // Object keys are sorted recursively; arrays keep order (rows are ordered by
  // their server-side `order` clause at export time).
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry) ?? 'null').join(',')}]`
  const keys = Object.keys(value).sort()
  const entries = []
  for (const key of keys) {
    const serialized = stableStringify(value[key])
    if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`)
  }
  return `{${entries.join(',')}}`
}

function perTableCanonicalHash(rows) {
  return sha256(stableStringify(rows))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBookingAccommodationRelation(value) {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    if (value.length !== 1) throw new Error('A booking cannot contain more than one accommodation detail record.')
    return value[0]
  }
  return value
}

function sanitizeBookingAccommodationDetails(value) {
  // PostgREST may expose a one-to-one relation as a one-element array; the
  // online loader normalizes that wire shape before it reaches this DTO
  // sanitizer. Imported packages must already use the contract's object shape
  // so malformed arrays fail closed during validation.
  const detail = value === null ? undefined : value
  if (detail === undefined) return undefined
  if (!isPlainObject(detail)) return detail
  const out = {}
  for (const [key, nestedValue] of Object.entries(detail)) {
    if (!BOOKING_ACCOMMODATION_DETAIL_FIELDS.has(key)) continue
    if (key === 'pricing_snapshot' && isPlainObject(nestedValue)) {
      out[key] = Object.fromEntries(Object.entries(nestedValue).filter(([field]) => BOOKING_PRICING_SNAPSHOT_FIELDS.has(field)))
    } else {
      out[key] = nestedValue
    }
  }
  return out
}

function sanitizeRowForRestore(tableKey, row) {
  const allowlist = RESTORE_FIELD_ALLOWLIST[tableKey]
  if (!allowlist) return { ...row }
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (EXCLUDED_RESTORE_FIELD_NAMES.has(key)) continue
    if (!allowlist.has(key)) continue
    if (tableKey === 'bookings' && key === 'booking_accommodation_details') {
      const detail = sanitizeBookingAccommodationDetails(value)
      if (detail !== undefined) out[key] = detail
      continue
    }
    out[key] = value
  }
  return out
}

function buildDtoSanitizationReport(tables, sanitizedTables) {
  const perTable = {}
  let totalRows = 0
  let rowsWithStrippedFields = 0
  let strippedFieldCount = 0
  for (const key of REQUIRED_TABLE_KEYS) {
    const rows = Array.isArray(tables?.[key]) ? tables[key] : []
    const safeRows = Array.isArray(sanitizedTables?.[key]) ? sanitizedTables[key] : []
    const fields = {}
    let tableRowsWithStrippedFields = 0
    let tableStrippedFieldCount = 0
    rows.forEach((row, index) => {
      const originalKeys = Object.keys(row || {})
      const safeKeys = new Set(Object.keys(safeRows[index] || {}))
      const stripped = originalKeys.filter((field) => !safeKeys.has(field))
      if (stripped.length) tableRowsWithStrippedFields += 1
      for (const field of stripped) {
        fields[field] = (fields[field] || 0) + 1
        tableStrippedFieldCount += 1
      }
      if (key === 'bookings' && isPlainObject(row?.booking_accommodation_details) && isPlainObject(safeRows[index]?.booking_accommodation_details)) {
        const sourceDetail = row.booking_accommodation_details
        const safeDetail = safeRows[index].booking_accommodation_details
        const detailStripped = Object.keys(sourceDetail).filter((field) => !Object.hasOwn(safeDetail, field))
        let nestedStrippedCount = detailStripped.length
        for (const field of detailStripped) {
          const reportField = `booking_accommodation_details.${field}`
          fields[reportField] = (fields[reportField] || 0) + 1
          tableStrippedFieldCount += 1
        }
        if (isPlainObject(sourceDetail.pricing_snapshot) && isPlainObject(safeDetail.pricing_snapshot)) {
          for (const field of Object.keys(sourceDetail.pricing_snapshot).filter((entry) => !Object.hasOwn(safeDetail.pricing_snapshot, entry))) {
            const reportField = `booking_accommodation_details.pricing_snapshot.${field}`
            fields[reportField] = (fields[reportField] || 0) + 1
            tableStrippedFieldCount += 1
            nestedStrippedCount += 1
          }
        }
        if (nestedStrippedCount > 0 && stripped.length === 0) tableRowsWithStrippedFields += 1
      }
    })
    perTable[key] = {
      rows: rows.length,
      rows_with_stripped_fields: tableRowsWithStrippedFields,
      stripped_field_count: tableStrippedFieldCount,
      fields
    }
    totalRows += rows.length
    rowsWithStrippedFields += tableRowsWithStrippedFields
    strippedFieldCount += tableStrippedFieldCount
  }
  return {
    total_rows: totalRows,
    rows_with_stripped_fields: rowsWithStrippedFields,
    stripped_field_count: strippedFieldCount,
    per_table: perTable
  }
}

function validateNonNegativeInt(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new Error(`${label} must be a non-negative 32-bit integer.`)
  }
}

function validateBookingAccommodationDetails(row) {
  if (!Object.hasOwn(row, 'booking_accommodation_details')) return
  const detail = row.booking_accommodation_details
  if (!isPlainObject(detail)) throw new Error('booking_accommodation_details must be an object.')
  for (const field of ['booking_id', 'lodge_id', 'accommodation_kind', 'adults', 'children', 'tents', 'vehicles', 'rate_mode', 'pricing_snapshot']) {
    if (!Object.hasOwn(detail, field) || detail[field] === null || detail[field] === undefined) {
      throw new Error(`Required campsite detail field ${field} is missing.`)
    }
  }
  for (const field of Object.keys(detail)) {
    if (!BOOKING_ACCOMMODATION_DETAIL_FIELDS.has(field)) throw new Error(`Unsupported campsite detail field ${field}.`)
  }
  if (row.id !== undefined && row.id !== null && String(detail.booking_id) !== String(row.id)) {
    throw new Error('Campsite detail booking_id must equal its containing booking ID.')
  }
  if (row.lodge_id !== undefined && row.lodge_id !== null && String(detail.lodge_id) !== String(row.lodge_id)) {
    throw new Error('Campsite detail lodge_id must equal its containing booking lodge.')
  }
  if (typeof detail.accommodation_kind !== 'string' || detail.accommodation_kind.trim().length < 1 || detail.accommodation_kind.trim().length > 64) {
    throw new Error('Campsite detail accommodation_kind must be a non-empty string.')
  }
  if (typeof detail.rate_mode !== 'string' || detail.rate_mode.trim().length < 1 || detail.rate_mode.trim().length > 64) {
    throw new Error('Campsite detail rate_mode must be a non-empty string.')
  }
  for (const field of ['adults', 'children', 'tents', 'vehicles']) validateNonNegativeInt(detail[field], `Campsite detail ${field}`)
  if (!isPlainObject(detail.pricing_snapshot) || Buffer.byteLength(JSON.stringify(detail.pricing_snapshot), 'utf8') > 65536) {
    throw new Error('pricing_snapshot must be a bounded JSON object.')
  }
  for (const [field, value] of Object.entries(detail.pricing_snapshot)) {
    if (!BOOKING_PRICING_SNAPSHOT_FIELDS.has(field)) throw new Error(`Unsupported pricing_snapshot field ${field}.`)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`pricing_snapshot field ${field} must be a non-negative number.`)
  }
  if (Object.hasOwn(detail, 'created_at') && detail.created_at !== undefined && detail.created_at !== null && typeof detail.created_at !== 'string') {
    throw new Error('Campsite detail created_at must be a timestamp string.')
  }
  if (Object.hasOwn(row, 'tents_count') && row.tents_count !== undefined && row.tents_count !== null) {
    validateNonNegativeInt(row.tents_count, 'tents_count')
    if (String(row.tents_count) !== String(detail.tents)) throw new Error('Booking tents_count disagrees with campsite detail tents.')
  }
  if (Object.hasOwn(row, 'vehicles_count') && row.vehicles_count !== undefined && row.vehicles_count !== null) {
    validateNonNegativeInt(row.vehicles_count, 'vehicles_count')
    if (String(row.vehicles_count) !== String(detail.vehicles)) throw new Error('Booking vehicles_count disagrees with campsite detail vehicles.')
  }
  if (Object.hasOwn(row, 'accommodation_kind') && row.accommodation_kind !== undefined && row.accommodation_kind !== null) {
    if (typeof row.accommodation_kind !== 'string' || row.accommodation_kind.trim().length < 1 || row.accommodation_kind.trim().length > 64) throw new Error('accommodation_kind must be a non-empty string.')
    if (row.accommodation_kind.trim().toLowerCase() !== detail.accommodation_kind.trim().toLowerCase()) throw new Error('Booking accommodation_kind disagrees with campsite detail.')
  }
}

function validateRowTypes(tableKey, row) {
  // Minimal type contracts: IDs must be string-like, monetary fields numeric,
  // lodge linkage present. Full schema evolution is handled by adapters.
  if (row.id !== undefined && row.id !== null && typeof row.id !== 'string' && typeof row.id !== 'number') {
    throw new Error(`Backup table ${tableKey} contains an invalid id type.`)
  }
  if (tableKey === 'signed_payment_ledger' && row.amount !== undefined && row.amount !== null && typeof row.amount !== 'number') {
    const numeric = Number(row.amount)
    if (!Number.isFinite(numeric)) throw new Error(`Backup table ${tableKey} contains a non-numeric payment amount.`)
  }
  if (tableKey === 'bookings') {
    for (const field of ['tents_count', 'vehicles_count']) {
      if (row[field] !== undefined && row[field] !== null) validateNonNegativeInt(row[field], field)
    }
    if (row.accommodation_kind !== undefined && row.accommodation_kind !== null && (typeof row.accommodation_kind !== 'string' || row.accommodation_kind.trim().length < 1 || row.accommodation_kind.trim().length > 64)) {
      throw new Error('accommodation_kind must be a non-empty string.')
    }
    validateBookingAccommodationDetails(row)
  }
}

const LEDGER_PAYMENT_TYPES = new Set(['payment', 'deposit', 'refund', 'retention_fee'])

function validateLedgerEntrySign(payment, index, bookingIds, { allowUnlinkedConference = false, allowOrphanPayments = false } = {}) {
  const paymentId = payment?.id ? String(payment.id) : `at row ${index + 1}`
  const type = String(payment?.type || '').trim().toLowerCase()
  if (!LEDGER_PAYMENT_TYPES.has(type)) {
    throw new Error(`Backup payment ${paymentId} has unsupported transaction type. Use payment, deposit, retention_fee, or refund.`)
  }
  const amount = Number(payment?.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new Error(`Backup payment ${paymentId} must have a non-zero numeric amount.`)
  if (type === 'refund' && amount >= 0) throw new Error(`Backup payment ${paymentId} is a refund and must have a negative amount.`)
  if (type !== 'refund' && amount <= 0) throw new Error(`Backup payment ${paymentId} must have a positive amount for transaction type ${type}.`)

  const bookingId = payment?.booking_id ? String(payment.booking_id) : null
  const conferenceId = payment?.conference_booking_id ? String(payment.conference_booking_id) : null
  if (bookingId && conferenceId) throw new Error(`Backup payment ${paymentId} has both a booking and excluded conference reference.`)
  if (!bookingId && !(allowOrphanPayments || (allowUnlinkedConference && conferenceId))) {
    throw new Error(`Backup payment ${paymentId} is orphaned and cannot be restored without a booking reference.`)
  }
  if (bookingId && !bookingIds.has(bookingId) && !allowOrphanPayments) throw new Error(`Backup payment ${paymentId} references a booking that is not included in the package.`)
  return { type, amount, bookingId, conferenceId }
}

function validateLedgerRows(tables, options = {}) {
  const bookings = Array.isArray(tables?.bookings) ? tables.bookings : []
  const payments = Array.isArray(tables?.signed_payment_ledger) ? tables.signed_payment_ledger : []
  const bookingIds = new Set(bookings.map((row) => String(row?.id || '')).filter(Boolean))
  const validated = payments.map((payment, index) => validateLedgerEntrySign(payment, index, bookingIds, options))
  const netByBooking = new Map()
  validated.forEach(({ bookingId, amount }) => {
    if (bookingId && bookingIds.has(bookingId)) netByBooking.set(bookingId, (netByBooking.get(bookingId) || 0) + amount)
  })
  for (const [bookingId, net] of netByBooking) {
    if (Math.round(net * 100) / 100 < 0) throw new Error(`Backup payment ledger for booking ${bookingId} would produce a negative paid balance.`)
  }
  return validated
}

function buildTableSnapshotCoherence(tables, warnings, driftDetected = false) {
  // The seven reads are independent, not a point-in-time snapshot. Without a
  // server-side transaction, coherence is only advisory. Always report false
  // here; a count recheck can disclose drift but cannot prove consistency.
  // Count rechecks are useful drift signals only. Independent reads can never
  // prove a point-in-time snapshot without a server-side transaction.
  return {
    snapshot_coherent: false,
    transactional_snapshot: false,
    drift_detected: driftDetected,
    drift_status: driftDetected ? 'detected' : 'not_detected_by_count_recheck',
    per_table: Object.fromEntries(REQUIRED_TABLE_KEYS.map((key) => [key, {
      count: Array.isArray(tables?.[key]) ? tables[key].length : 0,
      read_consistency: 'individual_read_only',
      drift_checked: key === 'bookings' || key === 'signed_payment_ledger'
    }])),
    snapshot_note: driftDetected
      ? 'Drift detected between export and recheck; bookings or ledger changed during the independent reads. Treat as non-atomic.'
      : 'Independent reads; not a coherent point-in-time snapshot. Reconcile bookings and payment ledger together during restore.',
    generated_via: driftDetected ? 'independent_read_with_drift_recheck' : 'independent_read_non_transactional'
  }
}

function captureBackupContext(overrides = {}) {
  // Freeze mutable global state once per backup operation. All subsequent reads
  // for this run use the captured values. This prevents a lodge switch,
  // reconnect, or online/offline flip mid-export from mixing lodges/sources.
  const lodgeId = overrides.lodgeId !== undefined ? String(overrides.lodgeId || '').trim() : String(state.lodgeId || '').trim()
  const supabaseClient = overrides.supabase !== undefined ? overrides.supabase : state.supabase
  const isOnline = overrides.isOnline !== undefined ? Boolean(overrides.isOnline) : Boolean(state.isOnline)
  const cacheDir = overrides.cacheDir !== undefined ? String(overrides.cacheDir || '').trim() : String(state.cacheDir || '').trim()
  const appVersion = overrides.appVersion !== undefined ? String(overrides.appVersion || 'unknown') : String(overrides.appVersion || 'unknown')
  return { lodgeId, supabaseClient, isOnline, cacheDir, appVersion }
}

function asRows(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return [value]
  return []
}
function rowBelongsToLodge(row, lodgeId, { allowMissing = false } = {}) {
  if (!row || row.lodge_id === undefined || row.lodge_id === null || row.lodge_id === '') return allowMissing
  return String(row.lodge_id) === String(lodgeId)
}
function containsProtectedKey(value) {
  if (Array.isArray(value)) return value.some(containsProtectedKey)
  if (!value || typeof value !== 'object') return false
  if (Object.keys(value).some((key) => PROTECTED_FIELD_NAMES.has(String(key).toLowerCase()))) return true
  return Object.values(value).some(containsProtectedKey)
}
function normalizeTable(name, value, lodgeId) {
  const rows = asRows(value)
  const foreignRows = rows.filter((row) => !rowBelongsToLodge(row, lodgeId, { allowMissing: name === 'settings' })).length
  if (foreignRows > 0) throw new Error(`Backup stopped: ${name} returned ${foreignRows} record(s) from another lodge.`)
  return rows.map((row) => {
    const safe = { ...row }
    if (name === 'settings') {
      delete safe.lodge_mesh_secret
      delete safe.logo
      delete safe.hero_image
    }
    if (name === 'customers') delete safe.id_photo
    if (name === 'rooms') {
      delete safe.photo
      delete safe.photos
    }
    if (name === 'signed_payment_ledger') delete safe.idempotency_key
    return safe
  })
}
function readSource(value, fallback = 'unknown') { return Array.isArray(value) ? value._source || fallback : fallback }
function isComplete(value, source) { return Array.isArray(value) && value._complete !== undefined ? value._complete === true : source === 'server' }
function buildTableEvidence(name, value, rows) {
  // Note: source is captured per-load; the fallback mirrors the immutable
  // context's online flag where available.
  const source = readSource(value, 'offline-cache')
  return { table: name, count: rows.length, source, complete: isComplete(value, source), note: source === 'server' && isComplete(value, source) ? 'Server-confirmed read.' : 'Local or partial read; verify with support before relying on this package for full recovery.' }
}
function withReadEvidence(rows, source, complete) {
  const result = Array.isArray(rows) ? rows : []
  Object.defineProperties(result, { _source: { value: source, enumerable: true }, _complete: { value: complete === true, enumerable: true } })
  return result
}
function readLocalRows(name, cacheDirOverride) {
  try {
    const cacheDir = String(cacheDirOverride !== undefined ? cacheDirOverride : state.cacheDir || '').trim()
    if (!cacheDir) return []
    const value = JSON.parse(fs.readFileSync(path.join(cacheDir, `${name}.json`), 'utf8'))
    return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
  } catch { return [] }
}

async function loadLodgeRowsForBackup(spec, context) {
  const effectiveContext = context || captureBackupContext()
  const lodgeId = effectiveContext.lodgeId
  const supabaseClient = effectiveContext.supabaseClient
  const isOnline = effectiveContext.isOnline
  const cacheDir = effectiveContext.cacheDir
  if (!isOnline || !supabaseClient) {
    if (spec.key === 'settings') return withReadEvidence([readLocalRows(spec.cache, cacheDir)[0] || { lodge_id: lodgeId }], 'offline-cache', false)
    return withReadEvidence(readLocalRows(spec.cache, cacheDir), 'offline-cache', false)
  }
  const rows = []
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += 500) {
    let query = supabaseClient.from(spec.table).select(spec.select || '*').eq('lodge_id', lodgeId)
    if (spec.order) query = query.order(spec.order, { ascending: spec.key === 'rooms' || spec.key === 'customers' })
    const { data, error } = await query.range(from, from + 499)
    if (error) throw new Error(`Server ${spec.key} read failed: ${error.message || 'unknown error'}`)
    const page = spec.key === 'bookings'
      ? (data || []).map((row) => {
          if (!Object.hasOwn(row || {}, 'booking_accommodation_details')) return row
          const detail = normalizeBookingAccommodationRelation(row.booking_accommodation_details)
          if (detail === undefined) {
            const { booking_accommodation_details: _omitted, ...withoutDetail } = row
            return withoutDetail
          }
          return { ...row, booking_accommodation_details: detail }
        })
      : (data || [])
    rows.push(...page)
    if (from + page.length >= MAX_ROWS_PER_TABLE && page.length === 500) throw new Error(`Server ${spec.key} contains more than ${MAX_ROWS_PER_TABLE.toLocaleString()} records. Starter backup stopped before claiming a complete export; ask support for a managed export.`)
    if (page.length < 500) break
  }
  if (spec.key === 'settings' && rows.length === 0) throw new Error('Server settings read returned no row for the active lodge; no complete backup was created.')
  return withReadEvidence(rows, 'server', true)
}

async function buildStarterBackupPayload(options = {}) {
  // Capture once; do not re-read global state per table.
  const context = options._backupContext || captureBackupContext({ lodgeId: options.lodgeId, supabase: options.supabase, isOnline: options.isOnline, cacheDir: options.cacheDir, appVersion: options.appVersion })
  const lodgeId = context.lodgeId
  if (!lodgeId) throw new Error('Choose an active lodge profile before creating a Starter backup.')
  const loadedValues = await Promise.all(CORE_TABLE_SPECS.map((spec) => loadLodgeRowsForBackup(spec, context)))
  const values = Object.fromEntries(CORE_TABLE_SPECS.map((spec, index) => [spec.key, loadedValues[index]]))
  const normalizedTables = Object.fromEntries(CORE_TABLE_SPECS.map((spec) => [spec.key, normalizeTable(spec.key, values[spec.key], lodgeId)]))
  const rowsByTable = Object.fromEntries(CORE_TABLE_SPECS.map((spec) => [spec.key, normalizedTables[spec.key].map((row) => sanitizeRowForRestore(spec.key, row))]))
  // Compare the loaded rows, not only the normalized rows, so the disclosure
  // includes media/secrets removed by the export scrubber as well as fields
  // omitted by the restore DTO allowlist.
  const loadedRowsByTable = Object.fromEntries(CORE_TABLE_SPECS.map((spec) => [spec.key, asRows(values[spec.key])]))
  const dtoSanitization = buildDtoSanitizationReport(loadedRowsByTable, rowsByTable)
  for (const key of REQUIRED_TABLE_KEYS) for (const row of rowsByTable[key]) validateRowTypes(key, row)
  validateLedgerRows(rowsByTable)
  const evidence = CORE_TABLE_SPECS.map((spec) => buildTableEvidence(spec.key, values[spec.key], rowsByTable[spec.key]))
  const warnings = evidence.filter((item) => !item.complete).map((item) => `${item.table} is ${item.source === 'offline-cache' ? 'from the local offline cache' : 'not server-confirmed'}; confirm this package with support before relying on it for complete recovery.`)
  if (!context.isOnline) warnings.unshift('The application was offline when this package was created. It contains available local data and is not proof of a complete server backup.')
  let driftDetected = false
  let driftWarning = null
  if (context.isOnline && context.supabaseClient) {
    try {
      for (const key of ['bookings', 'signed_payment_ledger']) {
        const spec = CORE_TABLE_SPECS.find((entry) => entry.key === key)
        const { count, error } = await context.supabaseClient.from(spec.table).select('id', { count: 'exact', head: true }).eq('lodge_id', lodgeId)
        if (!error && typeof count === 'number' && count !== rowsByTable[key].length) {
          driftDetected = true
          driftWarning = `Drift detected: ${key} changed during export (initial ${rowsByTable[key].length}, recheck ${count}).`
          break
        }
      }
    } catch {}
    if (driftDetected && driftWarning) warnings.push(driftWarning)
  }
  const generatedAt = new Date().toISOString()
  const snapshotCoherence = buildTableSnapshotCoherence(rowsByTable, warnings, driftDetected)
  return {
    schema: STARTER_BACKUP_SCHEMA,
    app_version: String(options.appVersion || context.appVersion || 'unknown'), generated_at: generatedAt, lodge_id: lodgeId,
    mode: 'starter-core-data-export',
    recovery: { restore_mode: 'support-led', live_restore_available: false, ownership_note: 'Customer-owned JSON export. Keep this file in a secure location and provide it to support only when recovery is required.' },
    privacy: { contains_personal_data: true, includes: 'Guest names, contact details, booking history, quotations, payment records, room operations, and maintenance notes.', handling_note: 'Treat this file as confidential. Store it securely and share it only with authorized lodge staff or support. Connection secrets and payment idempotency keys are intentionally excluded.' },
    completeness: { complete: warnings.length === 0, warnings, tables: evidence, snapshot_coherence: snapshotCoherence, dto_sanitization: dtoSanitization },
    tables: rowsByTable
  }
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function requirePassphrase(passphrase) {
  const value = String(passphrase || '')
  if (value.length < 12) throw new Error('Use an encryption passphrase with at least 12 characters.')
  if (value.length > 1024) throw new Error('The encryption passphrase is too long.')
  return value
}
function buildManifest(payload, appVersion = payload?.app_version || 'unknown', format = DEFAULT_PACKAGE_SCHEMA) {
  const tableKeys = CORE_TABLE_SPECS.map((spec) => spec.key)
  const base = { format, core_schema: payload?.schema || STARTER_BACKUP_SCHEMA, app_version: String(appVersion || 'unknown'), generated_at: payload?.generated_at || null, lodge_id: payload?.lodge_id || null, recovery_mode: 'support-led-disposable-restore-only', live_restore_available: false, contains_personal_data: true, included_categories: [...INCLUDED_CATEGORIES], excluded_categories: [...EXCLUDED_CATEGORIES], table_keys: tableKeys, table_counts: Object.fromEntries(tableKeys.map((key) => [key, Array.isArray(payload?.tables?.[key]) ? payload.tables[key].length : 0])), complete: payload?.completeness?.complete === true, warnings: Array.isArray(payload?.completeness?.warnings) ? payload.completeness.warnings : [], dto_sanitization: payload?.completeness?.dto_sanitization || null }
  return format === STARTER_BACKUP_PACKAGE_SCHEMA_V3
    ? { ...base, per_table_hashes: payload?.__perTableHashes || buildV3PerTableHashes(payload?.tables) }
    : base
}

function buildV3PerTableHashes(tables) {
  const out = {}
  for (const key of REQUIRED_TABLE_KEYS) {
    const rows = Array.isArray(tables?.[key]) ? tables[key] : []
    out[key] = perTableCanonicalHash(rows)
  }
  return out
}

export function buildRestorePreviewReport(manifest, counts, options = {}) {
  // Read-only preview helper for Command Central: never includes raw rows or PII.
  return {
    format: manifest?.format || DEFAULT_PACKAGE_SCHEMA,
    core_schema: manifest?.core_schema || STARTER_BACKUP_SCHEMA,
    lodge_id: manifest?.lodge_id || null,
    app_version: manifest?.app_version || null,
    generated_at: manifest?.generated_at || null,
    table_counts: counts || {},
    per_table_hashes: manifest?.per_table_hashes || null,
    manifest_verified: options.manifestVerified === true,
    snapshot_coherence: options.snapshotCoherence || null,
    complete: manifest?.complete === true,
    warnings: Array.isArray(manifest?.warnings) ? manifest.warnings : [],
    dto_sanitization: manifest?.dto_sanitization || null,
    excluded_categories: [...EXCLUDED_CATEGORIES],
    included_categories: [...INCLUDED_CATEGORIES]
  }
}
function packageParts(payload, options = {}) {
  // v3 is now the default production format (per-table canonical hashes). Callers
  // may explicitly pass useV3:false to emit v2 for legacy compatibility; all
  // normal exports and automation use v3.
  const shouldUseV3 = options.useV3 !== false
  const sourceTables = Object.fromEntries(REQUIRED_TABLE_KEYS.map((key) => [key, Array.isArray(payload?.tables?.[key]) ? payload.tables[key] : []]))
  const sanitizedTables = Object.fromEntries(REQUIRED_TABLE_KEYS.map((key) => [key, sourceTables[key].map((row) => sanitizeRowForRestore(key, row))]))
  const dtoSanitization = buildDtoSanitizationReport(sourceTables, sanitizedTables)
  const sanitizedPayload = {
    ...payload,
    tables: sanitizedTables,
    completeness: { ...(payload?.completeness || {}), dto_sanitization: dtoSanitization }
  }
  const perTableHashes = shouldUseV3 ? buildV3PerTableHashes(sanitizedTables) : null
  const manifestPayload = shouldUseV3 ? { ...sanitizedPayload, __perTableHashes: perTableHashes } : sanitizedPayload
  const coreData = canonicalJson(sanitizedPayload)
  const manifest = buildManifest(manifestPayload, options.appVersion, shouldUseV3 ? DEFAULT_PACKAGE_SCHEMA : STARTER_BACKUP_PACKAGE_SCHEMA)
  const readme = RECOVERY_README
  const checksums = { 'core-data.json': sha256(coreData), 'manifest.json': sha256(canonicalJson(manifest)), 'README.txt': sha256(readme) }
  return { coreData, manifest, readme, checksums, perTableHashes, sanitizedPayload, dtoSanitization }
}

export function createStarterBackupPackage(payload, options = {}) {
  const parts = packageParts(payload, options)
  const inner = { manifest: parts.manifest, checksums: parts.checksums, files: { 'core-data.json': parts.coreData, 'manifest.json': canonicalJson(parts.manifest), 'README.txt': parts.readme } }
  // When v3 hashes exist, also embed them as a non-PII reconciliation sidecar so a
  // trusted backend can verify without trusting PostgreSQL canonicalization.
  if (parts.perTableHashes) inner.per_table_hashes = parts.perTableHashes
  const passphrase = String(options.passphrase || '')
  let envelope
  if (passphrase) {
    const password = requirePassphrase(passphrase)
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12)
    const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(inner), 'utf8')), cipher.final()])
    envelope = { format: parts.manifest.format, encrypted: true, created_at: parts.manifest.generated_at, lodge_id: parts.manifest.lodge_id, app_version: parts.manifest.app_version, manifest_summary: { format: parts.manifest.format, core_schema: parts.manifest.core_schema, contains_personal_data: true, encrypted: true }, encryption: { algorithm: 'aes-256-gcm', kdf: 'scrypt', kdf_params: { N: 32768, r: 8, p: 1 }, salt: salt.toString('base64'), iv: iv.toString('base64'), auth_tag: cipher.getAuthTag().toString('base64'), ciphertext_sha256: sha256(ciphertext) }, ciphertext: ciphertext.toString('base64') }
  } else envelope = { format: parts.manifest.format, encrypted: false, created_at: parts.manifest.generated_at, lodge_id: parts.manifest.lodge_id, app_version: parts.manifest.app_version, manifest: parts.manifest, checksums: parts.checksums, files: inner.files, ...(parts.perTableHashes ? { per_table_hashes: parts.perTableHashes } : {}) }
  const bytes = Buffer.from(canonicalJson(envelope), 'utf8')
  return { bytes, packageSha256: sha256(bytes), coreDataSha256: parts.checksums['core-data.json'], checksums: parts.checksums, manifest: parts.manifest, counts: Object.fromEntries((parts.manifest.table_keys || []).map((key) => [key, Array.isArray(parts.sanitizedPayload?.tables?.[key]) ? parts.sanitizedPayload.tables[key].length : 0])), encrypted: envelope.encrypted === true, perTableHashes: parts.perTableHashes || null, dtoSanitization: parts.dtoSanitization }
}

function decodeEnvelope(buffer, passphrase = '') {
  let envelope
  try { envelope = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '')) } catch { throw new Error('This file is not a valid Tsa Bonno .tbbackup package.') }
  if (!SUPPORTED_PACKAGE_SCHEMAS.has(envelope?.format)) throw new Error('Unsupported or outdated .tbbackup package format.')
  if (envelope.encrypted !== true) return { envelope, inner: envelope }
  if (envelope?.encryption?.algorithm !== 'aes-256-gcm' || envelope?.encryption?.kdf !== 'scrypt') throw new Error('Unsupported backup encryption settings.')
  if (envelope?.encryption?.kdf_params?.N !== 32768 || envelope?.encryption?.kdf_params?.r !== 8 || envelope?.encryption?.kdf_params?.p !== 1) throw new Error('Unsupported backup key-derivation settings.')
  const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64')
  if (!ciphertext.length || sha256(ciphertext) !== envelope?.encryption?.ciphertext_sha256) throw new Error('Backup verification failed: encrypted package was changed or is incomplete.')
  let plaintext
  try {
    const key = crypto.scryptSync(requirePassphrase(passphrase), Buffer.from(String(envelope.encryption.salt || ''), 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(envelope.encryption.iv || ''), 'base64'))
    decipher.setAuthTag(Buffer.from(String(envelope.encryption.auth_tag || ''), 'base64'))
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch { throw new Error('Backup could not be decrypted. Check the passphrase and try again.') }
  try { return { envelope, inner: JSON.parse(plaintext.toString('utf8')) } } catch { throw new Error('Backup decryption produced an invalid package.') }
}

export function validateStarterBackupPackage(buffer, options = {}) {
  const packageBytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8')
  if (packageBytes.length > MAX_PACKAGE_BYTES) throw new Error('The selected recovery package is too large to verify safely.')
  const decoded = decodeEnvelope(packageBytes, options.passphrase), inner = decoded.inner, manifest = inner?.manifest, files = inner?.files
  if (!manifest || !files || typeof files['core-data.json'] !== 'string' || typeof files['manifest.json'] !== 'string' || typeof files['README.txt'] !== 'string') throw new Error('Backup package is missing its manifest, core data, or recovery readme.')
  if (sha256(files['core-data.json']) !== inner.checksums?.['core-data.json']) throw new Error('Backup verification failed: core-data.json checksum does not match.')
  if (sha256(files['manifest.json']) !== inner.checksums?.['manifest.json']) throw new Error('Backup verification failed: manifest checksum does not match.')
  if (sha256(files['README.txt']) !== inner.checksums?.['README.txt']) throw new Error('Backup verification failed: recovery readme checksum does not match.')
  let manifestFile
  try { manifestFile = JSON.parse(files['manifest.json']) } catch { throw new Error('Backup manifest is not valid JSON.') }
  if (canonicalJson(manifestFile) !== canonicalJson(manifest)) throw new Error('Backup manifest copies do not match.')
  if (!SUPPORTED_PACKAGE_SCHEMAS.has(manifest?.format) || manifest?.core_schema !== STARTER_BACKUP_SCHEMA) throw new Error('Backup manifest format is unsupported.')
  if (decoded.envelope.encrypted === true && (String(decoded.envelope.lodge_id) !== String(manifest.lodge_id) || String(decoded.envelope.app_version) !== String(manifest.app_version))) throw new Error('Encrypted backup header and manifest identity do not match.')
  let payload
  try { payload = JSON.parse(files['core-data.json']) } catch { throw new Error('Backup core data is not valid JSON.') }
  if (payload?.schema !== STARTER_BACKUP_SCHEMA || payload?.lodge_id !== manifest.lodge_id) throw new Error('Backup core data and manifest identity do not match.')
  if (options.expectedLodgeId && String(options.expectedLodgeId) !== String(payload.lodge_id)) throw new Error('This backup belongs to a different lodge and cannot be rehearsed here.')
  const tableKeys = Array.isArray(manifest.table_keys) ? manifest.table_keys : []
  if (tableKeys.length !== REQUIRED_TABLE_KEYS.length || REQUIRED_TABLE_KEYS.some((key) => !tableKeys.includes(key)) || tableKeys.some((key) => !REQUIRED_TABLE_KEYS.includes(key))) throw new Error('Backup manifest does not contain the required core table set.')
  const missing = tableKeys.filter((key) => !Array.isArray(payload?.tables?.[key]))
  if (missing.length) throw new Error(`Backup is missing required table data: ${missing.join(', ')}.`)
  // Import-side ceiling enforcement: do not stage a package that exceeds export limits.
  for (const key of tableKeys) {
    const count = payload.tables[key].length
    if (count > MAX_ROWS_PER_TABLE) throw new Error(`Backup table ${key} exceeds the ${MAX_ROWS_PER_TABLE.toLocaleString()} record ceiling. Ask support for a managed export.`)
  }
  for (const key of tableKeys) for (const row of payload.tables[key]) {
    if (!rowBelongsToLodge(row, payload.lodge_id, { allowMissing: key === 'settings' })) throw new Error(`Backup table ${key} contains a record without the active lodge identity or from another lodge.`)
    if (containsProtectedKey(row)) throw new Error(`Backup table ${key} contains a protected secret field.`)
    validateRowTypes(key, sanitizeRowForRestore(key, row))
  }
  const counts = Object.fromEntries(tableKeys.map((key) => [key, payload.tables[key].length]))
  if (tableKeys.some((key) => Number(manifest?.table_counts?.[key]) !== counts[key])) throw new Error('Backup manifest record counts do not match the core data.')
  const sanitizedTables = Object.fromEntries(tableKeys.map((key) => [key, payload.tables[key].map((row) => sanitizeRowForRestore(key, row))]))
  const computedDtoSanitization = buildDtoSanitizationReport(payload.tables, sanitizedTables)
  // Current exporters disclose fields stripped before packaging in the
  // manifest. Legacy packages have no disclosure, so use the recomputed DTO
  // report from the rows that arrived here.
  const dtoSanitization = manifest?.dto_sanitization || computedDtoSanitization
  // Payment signs and references are part of the import contract. This runs
  // against the sanitized DTO so excluded fields cannot affect validation.
  validateLedgerRows(sanitizedTables)
  // Per-table hash reconciliation: v3 carries a checked sidecar; for v2
  // packages, recompute the hashes locally and verify any legacy sidecar rather
  // than trusting it. Hashes describe the restore DTO, not excluded source fields.
  let perTableHashes = null
  let perTableHashesVerified = false
  const expectedPerTableHashes = buildV3PerTableHashes(sanitizedTables)
  const suppliedPerTableHashes = manifest?.per_table_hashes || inner?.per_table_hashes || null
  if (manifest?.format === STARTER_BACKUP_PACKAGE_SCHEMA_V3 && !manifest?.per_table_hashes) throw new Error('Backup v3 manifest is missing its per-table hashes.')
  if (suppliedPerTableHashes) {
    const suppliedKeys = Object.keys(suppliedPerTableHashes).sort()
    const expectedKeys = Object.keys(expectedPerTableHashes).sort()
    if (JSON.stringify(suppliedKeys) !== JSON.stringify(expectedKeys) || Object.values(suppliedPerTableHashes).some((hash) => !/^[a-f0-9]{64}$/i.test(String(hash)))) throw new Error('Backup per-table hash sidecar is invalid.')
    const mismatch = expectedKeys.find((key) => expectedPerTableHashes[key] !== String(suppliedPerTableHashes[key]).toLowerCase())
    if (mismatch) throw new Error(`Backup per-table hash does not match for ${mismatch}.`)
    perTableHashesVerified = true
  }
  perTableHashes = expectedPerTableHashes
  // Return only the sanitized DTO. Raw package rows (including legacy identity
  // artifacts) must not cross the main/preload boundary.
  const safePayload = { ...payload, tables: sanitizedTables, completeness: { ...(payload.completeness || {}), dto_sanitization: dtoSanitization } }
  return { success: true, format: manifest.format, encrypted: decoded.envelope.encrypted === true, packageSha256: sha256(packageBytes), coreDataSha256: inner.checksums['core-data.json'], checksums: inner.checksums, manifest, payload: safePayload, sanitizedTables, counts, complete: manifest.complete === true, warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [], perTableHashes, perTableHashesVerified, dtoSanitization, snapshotCoherence: payload?.completeness?.snapshot_coherence || null }
}
export function verifyStarterBackupAtPath(filePath, options = {}) {
  try {
    const target = String(filePath || '').trim()
    if (!target || path.extname(target).toLowerCase() !== '.tbbackup') return { success: false, error: 'Choose a Tsa Bonno .tbbackup file to verify.' }
    if (!fs.existsSync(target)) return { success: false, error: 'The selected .tbbackup file was not found.' }
    const stats = fs.statSync(target)
    if (!stats.isFile()) return { success: false, error: 'The selected recovery package is not a file.' }
    if (stats.size > MAX_PACKAGE_BYTES) return { success: false, error: 'The selected recovery package is too large to verify safely.' }
    const bytes = fs.readFileSync(target), result = validateStarterBackupPackage(bytes, options)
    return { ...result, fileName: path.basename(target), bytes: bytes.length, destination: target }
  } catch (error) { return { success: false, error: error?.message || 'Backup verification failed.' }
  }
}
function fsyncFileSync(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function fsyncDirSync(dirPath) {
  try {
    const handle = fs.openSync(dirPath, 'r')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(temporaryPath, bytes, { flag: 'wx' }); fsyncFileSync(temporaryPath); fs.renameSync(temporaryPath, filePath); fsyncDirSync(path.dirname(filePath)) } catch (error) { try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath) } catch {}; throw new Error(`Starter backup could not be written. Choose another destination and try again. (${error?.code || 'write_error'})`) }
}

export function reconstructBookingLedger(tables, options = {}) {
  // Advisory rehearsal calculation only. It must never be treated as an
  // authoritative amount_paid/payment_status write; production derives those
  // values inside the database payment RPC/transaction.
  const bookings = Array.isArray(tables?.bookings) ? tables.bookings : []
  const payments = Array.isArray(tables?.signed_payment_ledger) ? tables.signed_payment_ledger : []
  const ledgerByBooking = new Map()
  const orphanPayments = []
  const bookingIds = new Set(bookings.map((row) => String(row.id || '')).filter(Boolean))
  let totalPayments = 0
  let totalRefunds = 0
  // Strict validation is the default. A caller that is explicitly producing a
  // historical diagnostic may opt into orphan disclosure with strict:false;
  // no restore path should use that mode.
  const strict = options.strict !== false
  const validated = validateLedgerRows(tables, { allowUnlinkedConference: options.allowUnlinkedConference === true, allowOrphanPayments: options.allowOrphanPayments === true || !strict })
  for (let index = 0; index < payments.length; index += 1) {
    const payment = payments[index]
    const { type, amount, bookingId, conferenceId } = validated[index]
    const signedAmount = amount
    if (type === 'refund') totalRefunds += Math.abs(amount)
    else totalPayments += amount
    if (!bookingId || !bookingIds.has(bookingId)) {
      // Conference/event ledgers are outside the Starter restore DTO. Keep a
      // non-financial disclosure for callers explicitly requesting that mode.
      orphanPayments.push({ id: payment.id, booking_id: payment.booking_id, conference_booking_id: conferenceId, amount: payment.amount, reason: conferenceId ? 'excluded_conference_reference' : 'missing_booking_reference' })
      continue
    }
    ledgerByBooking.set(bookingId, (ledgerByBooking.get(bookingId) || 0) + signedAmount)
  }
  const bookingResults = bookings.map((booking) => {
    const paid = ledgerByBooking.get(String(booking.id)) || 0
    const gross = Number(booking.total_amount || 0) + Number(booking.charges_total || 0)
    const roundedPaid = Math.round(paid * 100) / 100
    const roundedGross = Math.round(gross * 100) / 100
    let status = 'unpaid'
    if (roundedPaid >= roundedGross && roundedGross > 0) status = 'paid'
    else if (roundedPaid > 0) status = 'partial'
    else if (String(booking.status || '').toLowerCase() === 'cancelled') status = 'cancelled'
    return { booking_id: booking.id, derived_amount_paid: roundedPaid, derived_payment_status: status, gross_total: roundedGross }
  })
  return {
    advisory: true,
    authoritative: false,
    authority_note: 'Derived rehearsal fields are advisory only. The production database must recompute amount_paid and payment_status from accepted ledger deltas.',
    bookingResults,
    orphanPayments,
    totals: { gross_collections: Math.round(totalPayments * 100) / 100, refunds: Math.round(totalRefunds * 100) / 100, net_paid: Math.round((totalPayments - totalRefunds) * 100) / 100 },
    missing_lineage_disclosure: 'Historical idempotency keys, financial audit logs, and managed retention lineage are not part of the Starter package and are not reconstructed.'
  }
}

export function buildRecoveryIdentityMap(payload, options = {}) {
  // Durable remapping for isolated recovery targets where the source lodge still exists.
  // Preserves original IDs in provenance; generates new target IDs deterministically
  // seeded by recovery operation ID so replays are idempotent.
  const seed = String(options.operationId || options.recoveryLodgeId || randomUUID())
  const newLodgeId = options.recoveryLodgeId || randomUUID()
  const sourceLodgeId = String(payload?.lodge_id || '')
  function deriveId(original) {
    return crypto.createHash('sha256').update(`${seed}:${String(original)}`).digest('hex').slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
  }
  const map = { sourceLodgeId, recoveryLodgeId: newLodgeId, seed, settings: {}, rooms: {}, customers: {}, bookings: {}, quotations: {}, payments: {}, maintenance: {} }
  for (const table of REQUIRED_TABLE_KEYS) {
    const rows = Array.isArray(payload?.tables?.[table]) ? payload.tables[table] : []
    for (const row of rows) {
      const originalId = row?.id ? String(row.id) : null
      if (!originalId) continue
      const bucket = table === 'signed_payment_ledger' ? 'payments' : table
      if (!map[bucket]) map[bucket] = {}
      map[bucket][originalId] = deriveId(`${table}:${originalId}`)
    }
  }
  // Deterministic slug regeneration to avoid unique constraint collisions.
  map.slugMapping = {}
  const settingsRows = Array.isArray(payload?.tables?.settings) ? payload.tables.settings : []
  for (const settings of settingsRows) {
    if (settings.slug) map.slugMapping[settings.slug] = `${String(settings.slug).slice(0, 48)}-recovery-${newLodgeId.slice(0, 8)}`
  }
  return map
}

export function remapPayloadForRecovery(payload, identityMap) {
  const tables = {}
  for (const key of REQUIRED_TABLE_KEYS) {
    const rows = Array.isArray(payload?.tables?.[key]) ? payload.tables[key] : []
    tables[key] = rows.map((row) => {
      const out = sanitizeRowForRestore(key, row)
      // Lodge scope is rewritten to the recovery lodge.
      if (out.lodge_id !== undefined) out.lodge_id = identityMap.recoveryLodgeId
      // Primary key remapped; provenance retained.
      if (out.id && identityMap[key === 'signed_payment_ledger' ? 'payments' : key]?.[String(out.id)]) {
        out._source_id = String(out.id)
        out.id = identityMap[key === 'signed_payment_ledger' ? 'payments' : key][String(out.id)]
      }
      if (key === 'settings' && out.slug && identityMap.slugMapping?.[row.slug]) out.slug = identityMap.slugMapping[row.slug]
      if (out.room_id && identityMap.rooms?.[String(out.room_id)]) out.room_id = identityMap.rooms[String(out.room_id)]
      if (out.customer_id && identityMap.customers?.[String(out.customer_id)]) out.customer_id = identityMap.customers[String(out.customer_id)]
      if (out.booking_id && identityMap.bookings?.[String(out.booking_id)]) out.booking_id = identityMap.bookings[String(out.booking_id)]
      if (out.quotation_id && identityMap.quotations?.[String(out.quotation_id)]) out.quotation_id = identityMap.quotations[String(out.quotation_id)]
      if (out.converted_booking_id && identityMap.bookings?.[String(out.converted_booking_id)]) out.converted_booking_id = identityMap.bookings[String(out.converted_booking_id)]
      if (key === 'bookings' && out.booking_accommodation_details) {
        const detail = out.booking_accommodation_details
        // Nested campsite details are part of the booking DTO, but their
        // foreign keys must follow the same isolated-target remap as the
        // containing booking. Never send source lodge/booking IDs downstream.
        detail.booking_id = identityMap.bookings?.[String(detail.booking_id)] || out.id
        detail.lodge_id = identityMap.recoveryLodgeId
        out.booking_accommodation_details = detail
      }
      // Multi-room quotation lines are JSON snapshots, but their room IDs
      // still identify source-lodge records. Remap them before the payload is
      // handed to the isolated restore target.
      if (key === 'quotations' && Array.isArray(out.accommodation_lines)) {
        out.accommodation_lines = out.accommodation_lines.map((line) => {
          if (!line || typeof line !== 'object') return line
          const mappedLine = { ...line }
          if (mappedLine.room_id && identityMap.rooms?.[String(mappedLine.room_id)]) {
            mappedLine.room_id = identityMap.rooms[String(mappedLine.room_id)]
          }
          return mappedLine
        })
      }
      if (out.conference_booking_id) out._unresolved_conference_ref = String(out.conference_booking_id)
      return out
    })
  }
  // Maintain settings lodge_id linkage for the recovery lodge row.
  if (tables.settings[0]) tables.settings[0].lodge_id = identityMap.recoveryLodgeId
  return { ...payload, lodge_id: identityMap.recoveryLodgeId, tables, _recovery_provenance: { source_lodge_id: identityMap.sourceLodgeId, recovery_lodge_id: identityMap.recoveryLodgeId, seed: identityMap.seed } }
}
export function writeStarterBackupPackageBytes(filePath, bytes) {
  const target = String(filePath || '').trim()
  if (!target || path.extname(target).toLowerCase() !== '.tbbackup') throw new Error('Starter recovery exports must use the .tbbackup format.')
  writeAtomic(target, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || ''))
  return { success: true, destination: target, bytes: Buffer.isBuffer(bytes) ? bytes.length : Buffer.byteLength(String(bytes || '')) }
}
export async function writeStarterBackupToPath(filePath, options = {}) {
  const target = String(filePath || '').trim()
  if (!target) throw new Error('Choose a destination file for the Starter backup.')
  if (path.extname(target).toLowerCase() !== '.tbbackup') throw new Error('Starter recovery exports must use the .tbbackup format.')
  const payload = await buildStarterBackupPayload(options), packaged = createStarterBackupPackage(payload, options)
  writeStarterBackupPackageBytes(target, packaged.bytes)
  return { success: true, fileName: path.basename(target), destination: target, bytes: packaged.bytes.length, sha256: packaged.packageSha256, coreDataSha256: packaged.coreDataSha256, checksums: packaged.checksums, generatedAt: payload.generated_at, lodgeId: payload.lodge_id, appVersion: payload.app_version, complete: payload.completeness.complete, encrypted: packaged.encrypted, warnings: payload.completeness.warnings, counts: packaged.counts, manifest: packaged.manifest }
}

export function getStarterBackupHistory(historyPath, options = {}) {
  try {
    const target = String(historyPath || '').trim()
    if (!target) return []
    const raw = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : [], lodgeId = options.lodgeId ? String(options.lodgeId) : null
    return (Array.isArray(raw) ? raw : []).filter((entry) => !lodgeId || String(entry.lodgeId) === lodgeId).slice(0, MAX_HISTORY_ENTRIES)
  } catch { return [] }
}
export function recordStarterBackupHistory(historyPath, entry = {}) {
  const target = String(historyPath || '').trim()
  if (!target) throw new Error('Starter backup history storage is unavailable.')
  const current = getStarterBackupHistory(target)
  const safeEntry = { id: String(entry.id || randomUUID()), at: String(entry.at || new Date().toISOString()), lodgeId: String(entry.lodgeId || ''), fileName: path.basename(String(entry.fileName || '')), destination: String(entry.destination || ''), bytes: Number(entry.bytes || 0), sha256: String(entry.sha256 || ''), encrypted: entry.encrypted === true, complete: entry.complete === true, counts: entry.counts && typeof entry.counts === 'object' ? entry.counts : {} }
  const next = [safeEntry, ...current.filter((item) => item.sha256 !== safeEntry.sha256)].slice(0, MAX_HISTORY_ENTRIES)
  writeAtomic(target, Buffer.from(canonicalJson(next), 'utf8'))
  return safeEntry
}
export function getStarterBackupReminder(historyPath, options = {}) {
  const history = getStarterBackupHistory(historyPath, options), latest = history[0] || null, now = options.now ? new Date(options.now).getTime() : Date.now(), ageDays = latest?.at ? Math.max(0, (now - new Date(latest.at).getTime()) / 86400000) : null
  return { lastBackupAt: latest?.at || null, lastBackupFileName: latest?.fileName || null, lastBackupComplete: latest ? latest.complete === true : null, ageDays, state: !latest ? 'never' : latest.complete !== true ? 'incomplete' : ageDays > 7 ? 'due' : 'current', reminderDays: 7, history }
}
export function createStarterRestoreRehearsal(sourcePath, targetDirectory, options = {}) {
  try {
    const source = String(sourcePath || '').trim(), targetRoot = String(targetDirectory || '').trim()
    if (!source || path.extname(source).toLowerCase() !== '.tbbackup') return { success: false, error: 'Choose a Tsa Bonno .tbbackup file for the rehearsal.' }
    if (!targetRoot) return { success: false, error: 'A disposable rehearsal folder is required.' }
    // Enforce trusted-main-process decryption: passphrase never leaves main.
    const verification = verifyStarterBackupAtPath(source, options)
    if (!verification.success) return verification
    // Apply DTO sanitization already validated above; rehearsal simulates that contract.
    const effectivePayload = verification.sanitizedTables ? { ...verification.payload, tables: verification.sanitizedTables } : verification.payload
    // Apply isolated identity remapping when a recovery lodge is provisioned, so
    // duplicate IDs never collide with the live lodge.
    const identityMap = options.recoveryLodgeId || options.operationId
      ? buildRecoveryIdentityMap(effectivePayload, { operationId: options.operationId, recoveryLodgeId: options.recoveryLodgeId })
      : null
    const remapped = identityMap ? remapPayloadForRecovery(effectivePayload, identityMap) : effectivePayload
    const restoredTables = {}
    for (const [table, rows] of Object.entries(remapped.tables)) {
      const restoredRows = JSON.parse(JSON.stringify(rows))
      const ids = restoredRows.map((row) => row?.id).filter(Boolean).map(String)
      if (new Set(ids).size !== ids.length) return { success: false, error: `Disposable restore rehearsal found duplicate IDs in ${table}.` }
      // Reconciliation uses the trusted Node canonicalizer hashes, not PostgreSQL serialization.
      restoredTables[table] = { count: restoredRows.length, sha256: perTableCanonicalHash(restoredRows) }
    }
    const customers = new Set(remapped.tables.customers.map((row) => String(row.id || '')).filter(Boolean))
    const rooms = new Set(remapped.tables.rooms.map((row) => String(row.id || '')).filter(Boolean))
    const bookings = new Set(remapped.tables.bookings.map((row) => String(row.id || '')).filter(Boolean))
    for (const booking of remapped.tables.bookings) {
      if (booking.customer_id && !customers.has(String(booking.customer_id))) return { success: false, error: 'Disposable restore rehearsal found a booking with a missing customer reference.' }
      if (booking.room_id && !rooms.has(String(booking.room_id))) return { success: false, error: 'Disposable restore rehearsal found a booking with a missing room reference.' }
    }
    for (const payment of remapped.tables.signed_payment_ledger) {
      if (payment.booking_id && !bookings.has(String(payment.booking_id))) return { success: false, error: 'Disposable restore rehearsal found a payment with a missing booking reference.' }
    }
    // Advisory ledger reconstruction for the rehearsal report only. Production
    // restore must derive financial fields inside its authoritative database RPC.
    const ledgerReconstruction = reconstructBookingLedger(remapped.tables)
    // Cross-check manifest counts against sanitized rows (which should match).
    const sanitizedCounts = Object.fromEntries(Object.entries(remapped.tables).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]))
    const rehearsalDir = path.join(targetRoot, `starter-restore-rehearsal-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 8)}`)
    fs.mkdirSync(rehearsalDir, { recursive: true })
    const report = {
      mode: 'disposable-in-memory-restore-rehearsal',
      support_led: true,
      can_restore_live: false,
      writes_personal_data: false,
      isolated_target: true,
      target_environment: 'disposable_recovery_directory',
      source_package: path.basename(source),
      package_sha256: verification.packageSha256,
      lodge_id: verification.manifest.lodge_id,
      recovery_lodge_id: identityMap?.recoveryLodgeId || null,
      identity_remapped: Boolean(identityMap),
      per_table_hashes: verification.perTableHashes || null,
      per_table_hashes_verified: verification.perTableHashesVerified === true,
      sanitized_counts: sanitizedCounts,
      generated_at: new Date().toISOString(),
      counts: verification.counts,
      restored_tables: restoredTables,
      ledger_reconstruction: { totals: ledgerReconstruction.totals, orphan_payment_count: ledgerReconstruction.orphanPayments.length, booking_status_sample: ledgerReconstruction.bookingResults.slice(0, 3) },
      missing_lineage_disclosure: ledgerReconstruction.missing_lineage_disclosure,
      validation: 'passed',
      scaling_notes: 'This rehearsal loads the full validated payload in memory. Production-scale packages (100k rows/table, 256 MB + base64) should be benchmarked for chunked staging; staged batch loading followed by atomic publication is safer than one enormous insert transaction.'
    }
    writeAtomic(path.join(rehearsalDir, 'restore-report.json'), Buffer.from(canonicalJson(report), 'utf8'))
    if (identityMap) writeAtomic(path.join(rehearsalDir, 'identity-map.json'), Buffer.from(canonicalJson(identityMap), 'utf8'))
    return { success: true, rehearsalDirectory: rehearsalDir, report, counts: verification.counts, canRestoreLive: false, identityMap }
  } catch (error) { return { success: false, error: error?.message || 'Disposable restore rehearsal failed.' }
  }
}
export { STARTER_BACKUP_SCHEMA, STARTER_BACKUP_PACKAGE_SCHEMA, STARTER_BACKUP_PACKAGE_SCHEMA_V3, DEFAULT_PACKAGE_SCHEMA, SUPPORTED_PACKAGE_SCHEMAS, RESTORE_FIELD_ALLOWLIST, EXCLUDED_RESTORE_FIELD_NAMES, buildStarterBackupPayload, captureBackupContext, buildTableSnapshotCoherence, buildDtoSanitizationReport, perTableCanonicalHash, sanitizeRowForRestore }
