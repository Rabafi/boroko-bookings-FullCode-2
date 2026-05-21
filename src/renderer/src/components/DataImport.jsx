import { useState, useEffect, useMemo } from 'react'
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSpreadsheet,
  ArrowRight,
  Trash2,
  RotateCcw,
  Download,
  Undo2,
  Clock,
  ShieldAlert
} from 'lucide-react'
import { formatLocalDate } from '../utils/localDate'

// ── Field definitions ────────────────────────────────────────────────────────
const IMPORT_FIELD_SETS = {
  bookings: [
  { key: 'guest_name',      label: 'Guest Name',       required: true,  hint: 'Full name of the guest' },
  { key: 'email',           label: 'Email',             required: false, hint: 'Guest email address' },
  { key: 'phone',           label: 'Phone',             required: false, hint: 'Contact phone number' },
  { key: 'id_number',       label: 'ID / Passport No',  required: false, hint: 'National ID or passport number' },
  { key: 'nationality',     label: 'Nationality',        required: false, hint: 'Country of origin' },
  { key: 'room_number',     label: 'Room Number',        required: true,  hint: 'Must match an existing room number exactly' },
  { key: 'check_in',        label: 'Check-In Date',      required: true,  hint: 'Format: YYYY-MM-DD' },
  { key: 'check_out',       label: 'Check-Out Date',     required: true,  hint: 'Format: YYYY-MM-DD' },
  { key: 'adults',          label: 'Adults',             required: false, hint: 'Number of adults (default: 1)' },
  { key: 'children',        label: 'Children',           required: false, hint: 'Number of children (default: 0)' },
  { key: 'total_amount',    label: 'Total Amount',       required: false, hint: 'Override calculated total (optional — leave blank to use room rate × nights)' },
  { key: 'amount_paid',     label: 'Amount Paid',        required: false, hint: 'Leave blank or 0 if unpaid' },
  { key: 'payment_method',  label: 'Payment Method',     required: false, hint: 'Cash, Card, Orange Money, etc.' },
  { key: 'status',          label: 'Booking Status',     required: false, hint: 'confirmed, checked_in, checked_out (default: checked_out)' },
  { key: 'notes',           label: 'Notes',              required: false, hint: 'Any additional notes' },
  ],
  guests: [
    { key: 'name', label: 'Guest Name', required: true, hint: 'Full name of the guest' },
    { key: 'email', label: 'Email', required: false, hint: 'Guest email address' },
    { key: 'phone', label: 'Phone', required: false, hint: 'Contact phone number' },
    { key: 'id_number', label: 'ID / Passport No', required: false, hint: 'National ID or passport number' },
    { key: 'nationality', label: 'Nationality', required: false, hint: 'Country of origin' },
  ],
  rooms: [
    { key: 'room_number', label: 'Room Number', required: true, hint: 'Must be unique' },
    { key: 'room_type', label: 'Room Type', required: false, hint: 'Standard, Deluxe, Family, etc.' },
    { key: 'rate', label: 'Rate', required: false, hint: 'Nightly room rate' },
    { key: 'max_adults', label: 'Max Adults', required: false, hint: 'Used for occupancy setup' },
    { key: 'max_children', label: 'Max Children', required: false, hint: 'Used for occupancy setup' },
  ],
  inventory: [
    { key: 'name', label: 'Item Name', required: true, hint: 'POS or stock item name' },
    { key: 'category', label: 'Category', required: false, hint: 'Bar, Kitchen, Drinks, etc.' },
    { key: 'unit', label: 'Unit', required: false, hint: 'bottle, pack, kg, unit' },
    { key: 'current_stock', label: 'Current Stock', required: false, hint: 'Opening stock quantity' },
    { key: 'reorder_level', label: 'Reorder Level', required: false, hint: 'Low-stock threshold' },
    { key: 'selling_price', label: 'Selling Price', required: false, hint: 'Optional POS selling price' },
  ],
  supplies: [
    { key: 'name', label: 'Supply Item', required: true, hint: 'Room supply item name' },
    { key: 'category', label: 'Category', required: false, hint: 'Linen, Bathroom, Cleaning, etc.' },
    { key: 'unit', label: 'Unit', required: false, hint: 'piece, bottle, pack, unit' },
    { key: 'current_stock', label: 'Current Stock', required: false, hint: 'Opening stock quantity' },
    { key: 'reorder_level', label: 'Reorder Level', required: false, hint: 'Low-stock threshold' },
  ],
  expenses: [
    { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD or DD/MM/YYYY' },
    { key: 'category', label: 'Category', required: true, hint: 'Expense category' },
    { key: 'description', label: 'Description', required: false, hint: 'Expense description' },
    { key: 'amount', label: 'Amount', required: true, hint: 'Expense amount' },
    { key: 'paid_by', label: 'Paid By', required: false, hint: 'Optional payment note' },
    { key: 'notes', label: 'Notes', required: false, hint: 'Optional extra notes' },
  ]
}

const getFieldsForType = (type) => IMPORT_FIELD_SETS[type] || IMPORT_FIELD_SETS.bookings

const STEPS = ['Upload File', 'Map Columns', 'Preview & Edit', 'Import']
const IMPORT_MAPPING_MEMORY_KEY = 'bb_import_mapping_memory_v1'

// ── Helpers ──────────────────────────────────────────────────────────────────
const FIELD_ALIASES = {
  guest_name:     ['guest', 'name', 'full name', 'guest name', 'client', 'customer', 'customer name', 'client name', 'visitor', 'occupant', 'tenant'],
  email:          ['email', 'e-mail', 'mail', 'email address', 'guest email'],
  phone:          ['phone', 'mobile', 'cell', 'contact', 'tel', 'telephone', 'contact number', 'phone number', 'mobile number'],
  id_number:      ['id', 'id number', 'passport', 'national id', 'id/passport', 'passport no', 'passport number', 'document number'],
  nationality:    ['nationality', 'country', 'origin'],
  room_number:    ['room', 'room no', 'room number', 'room_number', 'room #', 'unit', 'unit no', 'unit number', 'room name', 'cabin', 'suite'],
  check_in:       ['check in', 'check-in', 'checkin', 'arrival', 'arrival date', 'from', 'start', 'start date', 'date in', 'in date'],
  check_out:      ['check out', 'check-out', 'checkout', 'departure', 'departure date', 'to', 'end', 'end date', 'date out', 'out date'],
  adults:         ['adults', 'adult', 'pax', 'guests', 'adult guests', 'no adults'],
  children:       ['children', 'child', 'kids', 'minors', 'no children'],
  total_amount:   ['total', 'total amount', 'rate', 'room total', 'grand total', 'total cost', 'amount due', 'booking total', 'charge'],
  amount_paid:    ['paid', 'amount paid', 'payment', 'deposit', 'paid amount', 'deposit paid', 'received', 'amount received'],
  payment_method: ['payment method', 'method', 'payment type', 'how paid', 'paid by', 'paid via', 'pay type', 'payment mode', 'mode of payment', 'tender', 'tender type'],
  status:         ['status', 'booking status', 'state', 'booking state', 'reservation status'],
  notes:          ['notes', 'note', 'remarks', 'comments', 'comment', 'special requests'],
  name:           ['name', 'item name', 'supply item', 'guest name', 'full name', 'product', 'product name', 'description'],
  room_type:      ['room type', 'type'],
  rate:           ['rate', 'nightly rate', 'rate per night', 'price'],
  max_adults:     ['max adults', 'adults', 'maximum adults'],
  max_children:   ['max children', 'children', 'maximum children'],
  category:       ['category', 'type', 'group', 'department'],
  unit:           ['unit', 'uom', 'measure', 'measurement'],
  current_stock:  ['current stock', 'stock', 'quantity', 'qty', 'opening stock', 'on hand'],
  reorder_level:  ['reorder level', 'minimum stock', 'low stock', 'min stock', 'par level'],
  selling_price:  ['selling price', 'price', 'sale price', 'retail price'],
  date:           ['date', 'expense date', 'transaction date', 'paid date'],
  description:    ['description', 'details', 'item', 'expense', 'expense item', 'particulars'],
  amount:         ['amount', 'cost', 'total', 'expense amount', 'value'],
  paid_by:        ['paid by', 'method', 'payment method', 'paid via', 'payment type'],
}

function normalizeHeaderText(value) {
  return String(value || '').toLowerCase().replace(/[_\-/#]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function compactHeaderText(value) {
  return normalizeHeaderText(value).replace(/[^a-z0-9]/g, '')
}

function headerTokens(value) {
  return normalizeHeaderText(value).split(' ').filter(Boolean)
}

function readMappingMemory() {
  try {
    const stored = window.localStorage?.getItem(IMPORT_MAPPING_MEMORY_KEY)
    const parsed = stored ? JSON.parse(stored) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normaliseDate(val) {
  if (!val) return ''
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000))
    return formatLocalDate(date)
  }
  const s = String(val).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const short = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2}|\d{4})$/)
  if (short) {
    const first = Number(short[1])
    const second = Number(short[2])
    const year = short[3].length === 2 ? `20${short[3]}` : short[3]
    const useMonthDayYear = first <= 12 && second > 12
    const day = useMonthDayYear ? second : first
    const month = useMonthDayYear ? first : second
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    }
  }
  const d = new Date(s)
  if (!isNaN(d)) return formatLocalDate(d)
  return s
}

function normalizeImportStatus(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (!raw) return ''
  const aliases = {
    checkedout: 'checked_out',
    check_out: 'checked_out',
    checkout: 'checked_out',
    checkedin: 'checked_in',
    check_in: 'checked_in',
    checkin: 'checked_in',
    confirm: 'confirmed',
    booked: 'confirmed',
    active: 'confirmed',
    cancelled: 'cancelled',
    canceled: 'cancelled'
  }
  return aliases[raw] || raw
}

function normalizePaymentMethod(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const aliases = {
    card: 'Card',
    creditcard: 'Card',
    debitcard: 'Card',
    cash: 'Cash',
    orange: 'Orange Money',
    orangemoney: 'Orange Money',
    banktransfer: 'Bank Transfer',
    eft: 'Bank Transfer',
    mobilemoney: 'Mobile Money'
  }
  return aliases[compact] || raw
}

function cleanupImportRow(row, importType) {
  const next = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
  ;['check_in', 'check_out', 'date'].forEach((key) => {
    if (next[key]) next[key] = normaliseDate(next[key])
  })
  if (next.status) next.status = normalizeImportStatus(next.status)
  if (next.payment_method || importType === 'bookings') next.payment_method = normalizePaymentMethod(next.payment_method)
  return next
}

function buildImportRisk(dryRunReport, activeCount) {
  if (!dryRunReport) return { label: 'Not checked', tone: 'slate', detail: 'Run a dry check before importing.' }
  const total = Number(dryRunReport.total || activeCount || 0)
  const errors = Array.isArray(dryRunReport.errors) ? dryRunReport.errors.length : 0
  const overlaps = Number(dryRunReport.overlaps || 0)
  const duplicates = Number(dryRunReport.duplicates || 0)
  if (!total) return { label: 'No rows', tone: 'amber', detail: 'There are no active rows to import.' }
  if (errors > 0 || overlaps > 0) return { label: 'High review needed', tone: 'red', detail: `${errors || overlaps} row issue${(errors || overlaps) === 1 ? '' : 's'} should be fixed first.` }
  if (duplicates > 0) return { label: 'Needs review', tone: 'amber', detail: `${duplicates} duplicate record${duplicates === 1 ? '' : 's'} will be skipped.` }
  return { label: 'Looks good', tone: 'green', detail: `${total} row${total === 1 ? '' : 's'} passed the dry check.` }
}

function scoreHeaderMatch(column, fieldKey) {
  const columnText = normalizeHeaderText(column)
  const columnCompact = compactHeaderText(column)
  const columnTokens = new Set(headerTokens(column))
  const patterns = [fieldKey.replace(/_/g, ' '), ...(FIELD_ALIASES[fieldKey] || [])]
  let best = 0

  patterns.forEach((patternRaw) => {
    const patternText = normalizeHeaderText(patternRaw)
    const patternCompact = compactHeaderText(patternRaw)
    const patternTokens = headerTokens(patternRaw)
    if (!patternText || !patternCompact) return

    if (columnText === patternText) best = Math.max(best, 100)
    if (columnCompact === patternCompact) best = Math.max(best, 96)
    if (columnText.includes(patternText) && patternText.length >= 3) best = Math.max(best, 74 + Math.min(patternText.length, 20))
    if (patternText.includes(columnText) && columnText.length >= 4) best = Math.max(best, 52)

    const shared = patternTokens.filter((token) => columnTokens.has(token)).length
    if (shared) {
      const fullTokenMatch = shared === patternTokens.length
      best = Math.max(best, (shared * 18) + (fullTokenMatch ? 20 : 0))
    }
  })

  return best
}

function smartGuess(columns, fieldKey) {
  const best = columns.reduce((winner, column) => {
    const score = scoreHeaderMatch(column, fieldKey)
    return score > winner.score ? { column, score } : winner
  }, { column: '', score: 0 })
  return best.score >= 45 ? best.column : ''
}

function buildSmartMapping(columns, fields) {
  const used = new Set()
  const mapping = {}
  fields.forEach(({ key }) => {
    const guess = smartGuess(columns.filter((column) => !used.has(column)), key)
    mapping[key] = guess
    if (guess) used.add(guess)
  })
  return mapping
}

function getMappingStats(mapping, fields) {
  const mapped = fields.filter((field) => mapping[field.key]).length
  const required = fields.filter((field) => field.required)
  const requiredMapped = required.filter((field) => mapping[field.key]).length
  return {
    mapped,
    total: fields.length,
    requiredMapped,
    requiredTotal: required.length,
    percent: fields.length ? Math.round((mapped / fields.length) * 100) : 0,
    requiredComplete: requiredMapped === required.length
  }
}

function applyMappingMemory(columns, importType, fields, baseMapping = {}) {
  const remembered = readMappingMemory()[importType] || {}
  const columnByName = new Map(columns.map((column) => [normalizeHeaderText(column), column]))
  const next = { ...baseMapping }
  const used = new Set(Object.values(next).filter(Boolean))

  fields.forEach(({ key }) => {
    const column = columnByName.get(remembered[key])
    if (column && !used.has(column)) {
      if (next[key]) used.delete(next[key])
      next[key] = column
      used.add(column)
    }
  })

  return next
}

function mappingUsesMemory(columns, importType, fields, mapping = {}) {
  const remembered = readMappingMemory()[importType] || {}
  const available = new Set(columns.map(normalizeHeaderText))
  return fields.some(({ key }) => {
    const rememberedColumn = remembered[key]
    return rememberedColumn && available.has(rememberedColumn) && normalizeHeaderText(mapping[key]) === rememberedColumn
  })
}

function saveMappingMemory(importType, fields, mapping = {}) {
  try {
    const current = readMappingMemory()
    const nextTypeMemory = { ...(current[importType] || {}) }
    fields.forEach(({ key }) => {
      if (mapping[key]) nextTypeMemory[key] = normalizeHeaderText(mapping[key])
    })
    window.localStorage?.setItem(IMPORT_MAPPING_MEMORY_KEY, JSON.stringify({ ...current, [importType]: nextTypeMemory }))
  } catch {
    // Import should continue even if the browser refuses local storage.
  }
}

function detectImportType(columns, importTypes) {
  const candidates = (Array.isArray(importTypes) && importTypes.length ? importTypes : [{ key: 'bookings', label: 'Bookings' }])
    .map((type) => {
      const fields = getFieldsForType(type.key)
      const mapping = buildSmartMapping(columns, fields)
      const stats = getMappingStats(mapping, fields)
      const score = (stats.requiredMapped * 4) + stats.mapped
      return { ...type, mapping, stats, score }
    })
    .sort((a, b) => b.score - a.score)
  return candidates[0] || { key: 'bookings', label: 'Bookings', mapping: {}, stats: { percent: 0 } }
}

function applyMapping(rawRows, mapping, fields = IMPORT_FIELD_SETS.bookings, importType = 'bookings') {
  return rawRows.map((raw) => {
    const row = {}
    fields.forEach(({ key }) => {
      const col = mapping[key]
      let val = col ? raw[col] : ''
      if (key === 'check_in' || key === 'check_out' || key === 'date') val = normaliseDate(val)
      row[key] = val !== undefined && val !== null ? String(val) : ''
    })
    return cleanupImportRow(row, importType)
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
            i < current ? 'bg-green-600 text-white' :
            i === current ? 'bg-green-500 text-white ring-2 ring-green-300' :
            'bg-gray-200 text-gray-500'
          }`}>
            {i < current ? <CheckCircle2 size={14} /> : i + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:block ${i === current ? 'text-green-700' : i < current ? 'text-green-600' : 'text-gray-400'}`}>{s}</span>
          {i < STEPS.length - 1 && <div className={`w-6 h-0.5 mx-1 ${i < current ? 'bg-green-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

// Step 1 ─ Upload
function UploadStep({ onParsed, importType, setImportType, importTypes }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const parseSelectedFile = async (filePath) => {
    setLoading(true); setErr('')
    try {
      const result = await window.api.import.parseExcel(filePath)
      if (!result) { setLoading(false); return }
      if (result.error) { setErr(result.error); setLoading(false); return }
      if (result.rows.length === 0) { setErr('The Excel file has no data rows.'); setLoading(false); return }
      onParsed(result)
    } catch (e) {
      setErr(e.message)
      setLoading(false)
    }
  }

  const handleBrowse = async () => {
    await parseSelectedFile('')
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    const name = String(file.name || '')
    if (!/\.(xlsx|xls)$/i.test(name)) {
      setErr('Drop an Excel file ending in .xlsx or .xls.')
      return
    }
    const filePath = window.api.import.getDroppedFilePath?.(file)
    if (!filePath) {
      setErr('Could not read the dropped file path. Use Browse Excel File instead.')
      return
    }
    await parseSelectedFile(filePath)
  }

  const handleTemplate = async () => {
    setTemplateSaving(true)
    try {
      const res = await window.api.import.downloadTemplate(importType)
      if (res?.error) setErr(res.error)
    } catch (e) {
      setErr(e.message)
    } finally {
      setTemplateSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center">
        <FileSpreadsheet size={40} className="text-green-600" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Import Data Safely</h2>
        <p className="text-gray-500 text-sm max-w-md">
          Upload an Excel file (.xlsx or .xls), review the mapping, run a dry check, then import only the rows you approve.
          Imports save directly to the online database, so they must be done while online.
        </p>
      </div>
      <div className="w-full max-w-md">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Import template type
          <select
            value={importType}
            onChange={(e) => {
              setImportType(e.target.value)
              setErr('')
            }}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          >
            {importTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        {importType !== 'bookings' && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            This importer creates new records only. Existing matches are skipped so spreadsheet data cannot overwrite live records.
          </p>
        )}
      </div>
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={handleDrop}
        className={`w-full max-w-md rounded-2xl border-2 border-dashed px-6 py-7 text-center transition-colors ${
          dragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <Upload size={22} className={`mx-auto mb-2 ${dragActive ? 'text-green-700' : 'text-gray-500'}`} />
        <p className="text-sm font-semibold text-gray-800">Drop an Excel file here</p>
        <p className="mt-1 text-xs text-gray-500">The app will detect the import type and pre-map the columns.</p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleBrowse}
          disabled={loading}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors disabled:opacity-60"
        >
          <Upload size={18} />
          {loading ? 'Reading file...' : 'Browse Excel File'}
        </button>
        <button
          onClick={handleTemplate}
          disabled={templateSaving}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-5 py-3 rounded-xl font-medium transition-colors disabled:opacity-60"
        >
          <Download size={16} />
          {templateSaving ? 'Saving...' : 'Download Template'}
        </button>
      </div>
      {err && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-lg text-sm">
          <XCircle size={16} />{err}
        </div>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 max-w-md w-full text-xs text-blue-700 space-y-1">
        <p className="font-semibold text-blue-800">Tips for best results:</p>
        <p>• First row should be column headers (e.g. "Guest Name", "Check-In", "Room")</p>
        <p>• Dates should be in YYYY-MM-DD or DD/MM/YYYY format</p>
        <p>• Room numbers must match rooms already set up in the system</p>
        <p>• Download the template for a clean "Import Data" sheet and short read-me guide</p>
        <p>• For bookings, optional "Total Amount" overrides calculated rate x nights</p>
        <p>• Maximum 500 rows per import</p>
        <p>• Import and undo both require an internet connection</p>
      </div>
    </div>
  )
}

// Step 2 ─ Map Columns
function MappingStep({ parsed, onMapped, onBack, fields }) {
  const { columns, fileName, sheetName } = parsed
  const [mapping, setMapping] = useState(() => {
    return parsed.suggestedMapping || buildSmartMapping(columns, fields)
  })

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key])
  const mappingStats = getMappingStats(mapping, fields)

  const inp = "w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 p-3 bg-green-50 border border-green-200 rounded-xl">
        <FileSpreadsheet size={20} className="text-green-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-green-800">{fileName}</p>
          <p className="text-xs text-green-600">Sheet: {sheetName} &nbsp;·&nbsp; {parsed.rows.length} rows &nbsp;·&nbsp; {columns.length} columns detected</p>
          {parsed.detectedImportLabel && (
            <p className="mt-1 text-xs text-green-700">
              Detected as {parsed.detectedImportLabel} import with {parsed.detectedConfidence || 0}% initial mapping confidence.
            </p>
          )}
          {parsed.usedMappingMemory && (
            <p className="mt-1 text-xs text-green-700">
              Reused saved column choices from a previous import.
            </p>
          )}
        </div>
      </div>
      {parsed.truncated && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={15} />
          Only the first 500 rows were loaded from {parsed.totalRows} rows. Import those first, then split the remaining rows into another file.
        </div>
      )}

      <p className="text-sm text-gray-600 mb-4">
        Match each <strong>app field</strong> on the left to the corresponding <strong>Excel column</strong> on the right.
        Fields marked <span className="text-red-500">*</span> are required.
        Smart guesses have been pre-filled — review and adjust as needed.
      </p>

      <div className={`mb-4 rounded-xl border px-3 py-2 text-sm ${
        mappingStats.requiredComplete ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}>
        <p className="font-semibold">
          Smart mapping confidence: {mappingStats.percent}%
          <span className="ml-2 text-xs font-normal">
            {mappingStats.mapped} of {mappingStats.total} fields matched · {mappingStats.requiredMapped} of {mappingStats.requiredTotal} required fields ready
          </span>
        </p>
        {!mappingStats.requiredComplete && (
          <p className="mt-1 text-xs">Choose the missing required columns below before previewing.</p>
        )}
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {fields.map(({ key, label, required, hint }) => (
          <div key={key} className="grid grid-cols-[1fr_32px_1fr] items-center gap-2">
            <div className={`p-2 rounded-lg border text-sm ${mapping[key] ? 'border-green-300 bg-green-50' : required ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
              <span className="font-medium text-gray-800">{label}</span>
              {required && <span className="text-red-500 ml-1">*</span>}
              <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
            </div>
            <ArrowRight size={16} className="text-gray-400 mx-auto" />
            <select
              className={inp}
              value={mapping[key]}
              onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
            >
              <option value="">— skip —</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        ))}
      </div>

      {missingRequired.length > 0 && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg text-sm mt-4">
          <AlertTriangle size={15} />
          Required fields not mapped: {missingRequired.map((f) => f.label).join(', ')}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg border hover:bg-gray-50 transition-colors">
          <ChevronLeft size={16} /> Back
        </button>
        <button
          onClick={() => onMapped(mapping)}
          disabled={missingRequired.length > 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors"
        >
          Preview Data <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// Step 3 ─ Preview & Edit (with duplicate detection)
function PreviewStep({ rows, onBack, onImport, dryRunReport, onDryRun, dryRunning, fields, importType }) {
  const [data, setData] = useState(rows.map((r, i) => ({ ...r, _id: i, _skip: false, _duplicate: false })))
  const [editCell, setEditCell] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [exportingErrors, setExportingErrors] = useState(false)

  const activeRows = data.filter((r) => !r._skip)
  const skippedRows = data.filter((r) => r._skip)
  const duplicateRows = data.filter((r) => r._duplicate && !r._skip)
  const supportsBookingOverlapCheck = importType === 'bookings'
  const dryRunErrors = Array.isArray(dryRunReport?.errors) ? dryRunReport.errors : []
  const risk = buildImportRisk(dryRunReport, activeRows.length)
  const riskClass = {
    green: 'border-green-200 bg-green-50 text-green-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700'
  }[risk.tone] || 'border-slate-200 bg-slate-50 text-slate-700'

  const checkDuplicates = async () => {
    if (!supportsBookingOverlapCheck) return
    setChecking(true)
    try {
      const rowsToCheck = data.filter((r) => !r._skip).map(({ guest_name, room_number, check_in, check_out }) => ({
        guest_name, room_number, check_in, check_out
      }))
      const dupes = await window.api.import.checkDuplicates(rowsToCheck)
      if (Array.isArray(dupes) && dupes.length > 0) {
        const dupeSet = new Set(dupes.map((d) => `${d.room_number}|${d.check_in}|${d.check_out}`))
        setData((prev) => prev.map((r) => ({
          ...r,
          _duplicate: dupeSet.has(`${r.room_number}|${r.check_in}|${r.check_out}`)
        })))
      } else {
        setData((prev) => prev.map((r) => ({ ...r, _duplicate: false })))
      }
      setChecked(true)
    } catch {
      // If check fails, proceed without duplicate info
    } finally {
      setChecking(false)
    }
  }

  const updateCell = (rowId, field, value) => {
    setData((prev) => prev.map((r) => r._id === rowId ? { ...r, [field]: value } : r))
    setChecked(false) // invalidate duplicate check on edit
  }

  const toggleSkip = (rowId) => {
    setData((prev) => prev.map((r) => r._id === rowId ? { ...r, _skip: !r._skip } : r))
  }

  const resetAll = () => {
    setData((prev) => prev.map((r) => ({ ...r, _skip: false })))
  }

  const skipAllDuplicates = () => {
    setData((prev) => prev.map((r) => r._duplicate ? { ...r, _skip: true } : r))
  }

  const applyCommonFixes = () => {
    setData((prev) => prev.map((row) => row._skip ? row : { ...cleanupImportRow(row, importType), _id: row._id, _skip: row._skip, _duplicate: row._duplicate }))
    setChecked(false)
  }

  const applyRoomSuggestion = (rowNumber, roomNumber) => {
    const target = activeRows[rowNumber - 1]
    if (!target) return
    setData((prev) => prev.map((row) => row._id === target._id ? { ...row, room_number: roomNumber } : row))
    setChecked(false)
  }

  const exportErrorWorkbook = async () => {
    if (dryRunErrors.length === 0) return
    setExportingErrors(true)
    try {
      const result = await window.api.import.exportErrors?.({
        importType,
        rows: activeRows.map(({ _id: _i, _skip: _s, _duplicate: _d, ...rest }) => rest),
        errors: dryRunErrors
      })
      if (result?.error) alert(result.error)
    } catch (e) {
      alert(e.message || 'Could not export import issues.')
    } finally {
      setExportingErrors(false)
    }
  }

  const visibleFields = importType === 'bookings'
    ? fields.filter((f) => ['guest_name','room_number','check_in','check_out','adults','total_amount','amount_paid','payment_method','status','notes'].includes(f.key))
    : fields

  const thCls = "px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap bg-gray-50"
  const tdCls = "px-2 py-1 text-xs text-gray-800 border-b border-gray-100"

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {activeRows.length} rows ready to import
            {skippedRows.length > 0 && <span className="ml-2 text-amber-600">({skippedRows.length} skipped)</span>}
          </p>
          <p className="text-xs text-gray-500">Click any cell to edit it. Use the trash button to skip a row.</p>
        </div>
        <div className="flex gap-2">
          {supportsBookingOverlapCheck && (
            <button
              onClick={checkDuplicates}
              disabled={checking || activeRows.length === 0}
              className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              <ShieldAlert size={12} />
              {checking ? 'Checking...' : checked ? 'Re-check Overlaps' : 'Check Room Overlaps'}
            </button>
          )}
          <button
            onClick={() => onDryRun(activeRows.map(({ _id: _i, _skip: _s, _duplicate: _d, ...rest }) => rest))}
            disabled={dryRunning || activeRows.length === 0}
            className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            <ShieldAlert size={12} />
            {dryRunning ? 'Checking...' : 'Dry Run Report'}
          </button>
          <button
            onClick={applyCommonFixes}
            disabled={activeRows.length === 0}
            className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            <RotateCcw size={12} />
            Auto-clean
          </button>
          {skippedRows.length > 0 && (
            <button onClick={resetAll} className="flex items-center gap-1 text-xs text-gray-600 border hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors">
              <RotateCcw size={12} /> Restore all
            </button>
          )}
        </div>
      </div>

      {checked && duplicateRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle size={16} />
            <span><strong>{duplicateRows.length}</strong> row{duplicateRows.length !== 1 ? 's' : ''} overlap with existing bookings (highlighted in amber)</span>
          </div>
          <button
            onClick={skipAllDuplicates}
            className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap"
          >
            Skip All Duplicates
          </button>
        </div>
      )}
      {checked && duplicateRows.length === 0 && (
        <div className="flex items-center gap-2 mb-3 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          <CheckCircle2 size={16} />
          No duplicate bookings found — safe to import.
        </div>
      )}
      {dryRunReport && (
        <div className="mb-3 rounded-xl border border-purple-200 bg-purple-50 p-3 text-sm text-purple-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">Dry-run report</p>
              <div className={`mt-2 inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold ${riskClass}`}>
                Risk score: {risk.label} — {risk.detail}
              </div>
            </div>
            {dryRunErrors.length > 0 && (
              <button
                type="button"
                onClick={exportErrorWorkbook}
                disabled={exportingErrors}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-60"
              >
                <Download size={12} />
                {exportingErrors ? 'Exporting...' : 'Export Issues'}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs">
            {dryRunReport.valid || 0} valid of {dryRunReport.total || 0} rows
            {importType === 'bookings'
              ? ` · ${dryRunReport.would_create_customers || 0} new guests · ${dryRunReport.would_reuse_customers || 0} existing guests · ${dryRunReport.overlaps || 0} overlaps`
              : ` · ${dryRunReport.would_create || 0} new records · ${dryRunReport.duplicates || 0} duplicates skipped`}
          </p>
          {dryRunErrors.length > 0 && (
            <div className="mt-2 rounded-lg border border-purple-200 bg-white/60 p-2">
              <p className="text-xs font-semibold">{dryRunErrors.length} rows need correction before import.</p>
              <div className="mt-1 max-h-24 overflow-y-auto space-y-1">
                {dryRunErrors.slice(0, 6).map((entry, idx) => {
                  const messages = Array.isArray(entry.errors) ? entry.errors : [entry.error].filter(Boolean)
                  const roomSuggestions = entry.suggestions?.room_number || []
                  return (
                    <div key={`${entry.row || idx}-${idx}`} className="text-xs">
                      <p><span className="font-semibold">Row {entry.row || idx + 1}:</span> {messages.join(' ')}</p>
                      {roomSuggestions.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="opacity-75">Try:</span>
                          {roomSuggestions.map((roomNumber) => (
                            <button
                              key={roomNumber}
                              type="button"
                              onClick={() => applyRoomSuggestion(entry.row || idx + 1, roomNumber)}
                              className="rounded-md border border-purple-200 bg-white px-2 py-0.5 font-semibold text-purple-700 hover:bg-purple-100"
                            >
                              Room {roomNumber}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {dryRunErrors.length > 6 && (
                  <p className="text-xs opacity-75">And {dryRunErrors.length - 6} more row issue{dryRunErrors.length - 6 === 1 ? '' : 's'}.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-auto border border-gray-200 rounded-xl" style={{ maxHeight: '420px' }}>
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr>
              <th className={`${thCls} w-8`}>#</th>
              {visibleFields.map((f) => (
                <th key={f.key} className={thCls}>{f.label}</th>
              ))}
              <th className={`${thCls} w-8`}>Skip</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const isDupe = row._duplicate && !row._skip
              return (
                <tr key={row._id} className={
                  row._skip ? 'bg-gray-50 opacity-40'
                  : isDupe ? 'bg-amber-50'
                  : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }>
                  <td className={`${tdCls} text-center ${isDupe ? 'text-amber-500' : 'text-gray-400'}`}>
                    {isDupe && <AlertTriangle size={10} className="inline mr-0.5" />}
                    {idx + 1}
                  </td>
                  {visibleFields.map((f) => (
                    <td key={f.key} className={tdCls}>
                      {editCell?.rowId === row._id && editCell?.field === f.key && !row._skip ? (
                        <input
                          autoFocus
                          className="w-full border border-green-400 rounded px-1 py-0.5 text-xs focus:outline-none min-w-[80px]"
                          value={row[f.key] || ''}
                          onChange={(e) => updateCell(row._id, f.key, e.target.value)}
                          onBlur={() => setEditCell(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditCell(null)}
                        />
                      ) : (
                        <span
                          className={`cursor-pointer hover:bg-green-50 px-1 rounded block ${!row._skip ? 'hover:ring-1 hover:ring-green-300' : ''}`}
                          onClick={() => !row._skip && setEditCell({ rowId: row._id, field: f.key })}
                          title={!row._skip ? 'Click to edit' : ''}
                        >
                          {row[f.key] || <span className="text-gray-300 italic">—</span>}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className={`${tdCls} text-center`}>
                    <button
                      onClick={() => toggleSkip(row._id)}
                      className={`p-1 rounded transition-colors ${row._skip ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-red-500'}`}
                      title={row._skip ? 'Restore row' : 'Skip this row'}
                    >
                      {row._skip ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {activeRows.length === 0 && (
        <div className="text-center py-6 text-amber-600 text-sm">
          <AlertTriangle size={20} className="mx-auto mb-1" />
          All rows are skipped. Restore some rows before importing.
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg border hover:bg-gray-50 transition-colors">
          <ChevronLeft size={16} /> Back
        </button>
        <button
          onClick={() => onImport(activeRows.map(({ _id: _i, _skip: _s, _duplicate: _d, ...rest }) => rest))}
          disabled={activeRows.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors"
        >
          Import {activeRows.length} Record{activeRows.length !== 1 ? 's' : ''} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// Step 4 ─ Importing / Results (with progress bar + undo)
function ResultStep({ result, progress, onReset, onUndo, undoing, importType }) {
  const entityLabel = importType === 'bookings' ? 'bookings' : 'records'
  if (!result) {
    const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Importing {entityLabel}...</p>
        {progress ? (
          <div className="w-64">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Row {progress.current} of {progress.total}</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-green-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Preparing import...</p>
        )}
      </div>
    )
  }

  if (result.error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <XCircle size={48} className="text-red-500" />
        <p className="text-red-700 font-semibold text-lg">Import could not be completed</p>
        <p className="text-red-600 text-sm text-center max-w-md bg-red-50 border border-red-200 px-4 py-3 rounded-lg">{result.error}</p>
        <p className="text-gray-400 text-xs text-center max-w-sm">No data was saved. Fix the issue and try importing again.</p>
        <button onClick={onReset} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2 rounded-xl font-medium transition-colors">
          <RotateCcw size={16} /> Try Again
        </button>
      </div>
    )
  }

  const { imported, skipped, errors, batchId } = result

  return (
    <div className="flex flex-col items-center py-10 gap-6">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${imported > 0 ? 'bg-green-100' : 'bg-amber-100'}`}>
        {imported > 0
          ? <CheckCircle2 size={36} className="text-green-600" />
          : <AlertTriangle size={36} className="text-amber-500" />}
      </div>

      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-1">Import Complete</h2>
        <p className="text-gray-500 text-sm">Here's a summary of what was processed</p>
      </div>

      <div className="flex gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-4 text-center">
          <p className="text-3xl font-bold text-green-700">{imported}</p>
          <p className="text-xs text-green-600 mt-1">{importType === 'bookings' ? 'Bookings' : 'Records'} Imported</p>
        </div>
        {skipped > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-center">
            <p className="text-3xl font-bold text-amber-700">{skipped}</p>
            <p className="text-xs text-amber-600 mt-1">Rows Skipped</p>
          </div>
        )}
      </div>

      {errors && errors.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
            <XCircle size={14} /> Rows with errors ({errors.length})
          </p>
          <div className="max-h-48 overflow-y-auto border border-red-200 rounded-xl">
            {errors.map((e, i) => (
              <div key={i} className={`px-4 py-2 text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-red-50'}`}>
                <span className="font-semibold text-gray-700">Row {e.row}</span>
                {e.guest && <span className="text-gray-500"> · {e.guest}</span>}
                <span className="text-red-600 ml-2">{e.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {batchId && imported > 0 && (
          <button
            onClick={() => onUndo(batchId)}
            disabled={undoing}
            className="flex items-center gap-2 border border-red-300 hover:bg-red-50 text-red-700 px-5 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            <Undo2 size={16} />
            {undoing ? 'Undoing...' : 'Undo This Import'}
          </button>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-5 py-2 rounded-xl font-medium transition-colors"
        >
          <Upload size={16} /> Import Another File
        </button>
      </div>
    </div>
  )
}

// ── Import History ───────────────────────────────────────────────────────────
function ImportHistory() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [undoing, setUndoing] = useState(null)

  useEffect(() => {
    window.api.import.getBatches().then((data) => {
      setBatches(Array.isArray(data) ? data : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleUndo = async (batchId) => {
    if (!confirm('This will permanently delete all bookings and auto-created guests from this import. Continue?')) return
    setUndoing(batchId)
    try {
      const res = await window.api.import.undoBatch(batchId)
      if (res?.error) { alert(res.error); return }
      setBatches((prev) => prev.filter((b) => b.id !== batchId))
    } catch (e) {
      alert(e.message)
    } finally {
      setUndoing(null)
    }
  }

  if (loading) return <p className="text-sm text-gray-400 p-4">Loading import history...</p>
  if (batches.length === 0) return (
    <div className="text-center py-12 text-gray-400 text-sm">
      <Clock size={24} className="mx-auto mb-2 opacity-50" />
      No import history yet. Import a file to get started.
    </div>
  )

  return (
    <div className="space-y-2">
      {batches.map((b) => (
        <div key={b.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {b.filename || 'Unknown file'}
              <span className="ml-2 text-xs text-gray-500">
                {b.row_count} imported{b.error_count > 0 && `, ${b.error_count} errors`}
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(b.created_at).toLocaleString('en-GB')} · {b.entity_type}
            </p>
          </div>
          <button
            onClick={() => handleUndo(b.id)}
            disabled={undoing === b.id}
            className="flex items-center gap-1 text-xs border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Undo2 size={12} />
            {undoing === b.id ? 'Undoing...' : 'Undo'}
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DataImport() {
  const [step, setStep] = useState(0)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState(null)
  const [previewRows, setPreviewRows] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const [undoing, setUndoing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [importType, setImportType] = useState('bookings')
  const [importTypes, setImportTypes] = useState([{ key: 'bookings', label: 'Bookings', executable: true }])
  const [dryRunReport, setDryRunReport] = useState(null)
  const [dryRunning, setDryRunning] = useState(false)
  const fields = useMemo(() => getFieldsForType(importType), [importType])

  // Listen for progress events from main process
  useEffect(() => {
    const cleanup = window.api.import.onProgress((p) => setProgress(p))
    return cleanup
  }, [])

  useEffect(() => {
    window.api.import.getTypes?.()
      .then((types) => setImportTypes(Array.isArray(types) && types.length ? types : [{ key: 'bookings', label: 'Bookings', executable: true }]))
      .catch(() => {})
  }, [])

  const handleParsed = (data) => {
    const detected = detectImportType(data.columns || [], importTypes)
    const detectedFields = getFieldsForType(detected.key)
    const rememberedMapping = applyMappingMemory(data.columns || [], detected.key, detectedFields, detected.mapping || {})
    const rememberedStats = getMappingStats(rememberedMapping, detectedFields)
    setImportType(detected.key)
    setParsed({
      ...data,
      detectedImportType: detected.key,
      detectedImportLabel: detected.label,
      detectedConfidence: rememberedStats.percent || detected.stats?.percent || 0,
      suggestedMapping: rememberedMapping,
      usedMappingMemory: mappingUsesMemory(data.columns || [], detected.key, detectedFields, rememberedMapping)
    })
    setMapping(null)
    setPreviewRows(null)
    setDryRunReport(null)
    setStep(1)
  }

  const handleMapped = (m) => {
    setMapping(m)
    saveMappingMemory(importType, fields, m)
    const mapped = applyMapping(parsed.rows, m, fields, importType)
    setPreviewRows(mapped)
    setDryRunReport(null)
    setStep(2)
  }

  const handleDryRun = async (rows) => {
    setDryRunning(true)
    try {
      const report = await window.api.import.dryRun(rows, importType)
      setDryRunReport(report)
    } catch (e) {
      setDryRunReport({ error: e.message, errors: [{ row: 0, errors: [e.message] }] })
    } finally {
      setDryRunning(false)
    }
  }

  const handleImport = async (rows) => {
    setStep(3)
    setImporting(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.api.import.execute(rows, parsed?.fileName, importType)
      setResult(res)
    } catch (e) {
      setResult({ error: e.message })
    }
    setImporting(false)
  }

  const handleUndo = async (batchId) => {
    if (!confirm('This will permanently delete all bookings and auto-created guests from this import. Continue?')) return
    setUndoing(true)
    try {
      const res = await window.api.import.undoBatch(batchId)
      if (res?.error) { alert(res.error); setUndoing(false); return }
      setResult((prev) => prev ? { ...prev, imported: 0, undone: true } : prev)
    } catch (e) {
      alert(e.message)
    } finally {
      setUndoing(false)
    }
  }

  const reset = () => {
    setStep(0)
    setParsed(null)
    setMapping(null)
    setPreviewRows(null)
    setResult(null)
    setImporting(false)
    setProgress(null)
    setUndoing(false)
    setDryRunReport(null)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Download size={24} className="text-green-600" />
            Data Import
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Import historical guest and booking records from an Excel spreadsheet. Online only.
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border transition-colors ${
            showHistory ? 'bg-gray-100 text-gray-800 border-gray-300' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Clock size={15} />
          Import History
        </button>
      </div>

      {showHistory ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Import History</h2>
          <p className="text-sm text-gray-500 mb-4">
            View past imports and undo them if needed. Undoing deletes all bookings and auto-created guests from that batch.
          </p>
          <ImportHistory />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <StepIndicator current={step} />

          {step === 0 && (
            <UploadStep
              onParsed={handleParsed}
              importType={importType}
              setImportType={setImportType}
              importTypes={importTypes}
            />
          )}
          {step === 1 && parsed && (
            <MappingStep
              parsed={parsed}
              onMapped={handleMapped}
              onBack={() => setStep(0)}
              fields={fields}
            />
          )}
          {step === 2 && previewRows && (
            <PreviewStep
              rows={previewRows}
              onBack={() => setStep(1)}
              onImport={handleImport}
              dryRunReport={dryRunReport}
              onDryRun={handleDryRun}
              dryRunning={dryRunning}
              fields={fields}
              importType={importType}
            />
          )}
          {step === 3 && (
            <ResultStep
              result={importing ? null : result}
              progress={progress}
              onReset={reset}
              onUndo={handleUndo}
              undoing={undoing}
              importType={importType}
            />
          )}
        </div>
      )}
    </div>
  )
}
