import { useState, useMemo } from 'react'
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
  Download
} from 'lucide-react'

// ── Field definitions ────────────────────────────────────────────────────────
const APP_FIELDS = [
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
  { key: 'amount_paid',     label: 'Amount Paid',        required: false, hint: 'Leave blank or 0 if unpaid' },
  { key: 'payment_method',  label: 'Payment Method',     required: false, hint: 'Cash, Card, Orange Money, etc.' },
  { key: 'status',          label: 'Booking Status',     required: false, hint: 'confirmed, checked_in, checked_out (default: checked_out)' },
  { key: 'notes',           label: 'Notes',              required: false, hint: 'Any additional notes' },
]

const STEPS = ['Upload File', 'Map Columns', 'Preview & Edit', 'Import']

// ── Helpers ──────────────────────────────────────────────────────────────────
function normaliseDate(val) {
  if (!val) return ''
  // Excel serial number → JS date
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000))
    return date.toISOString().split('T')[0]
  }
  const s = String(val).trim()
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`
  // Try native parse
  const d = new Date(s)
  if (!isNaN(d)) return d.toISOString().split('T')[0]
  return s
}

function smartGuess(columns, fieldKey) {
  const lower = columns.map((c) => c.toLowerCase())
  const aliases = {
    guest_name:     ['guest', 'name', 'full name', 'guest name', 'client', 'customer'],
    email:          ['email', 'e-mail', 'mail'],
    phone:          ['phone', 'mobile', 'cell', 'contact', 'tel', 'telephone'],
    id_number:      ['id', 'id number', 'passport', 'national id', 'id/passport'],
    nationality:    ['nationality', 'country', 'origin'],
    room_number:    ['room', 'room no', 'room number', 'room_number', 'room #', 'unit'],
    check_in:       ['check in', 'check-in', 'checkin', 'arrival', 'from', 'start', 'date in'],
    check_out:      ['check out', 'check-out', 'checkout', 'departure', 'to', 'end', 'date out'],
    adults:         ['adults', 'adult', 'pax', 'guests'],
    children:       ['children', 'child', 'kids'],
    amount_paid:    ['paid', 'amount paid', 'payment', 'deposit', 'amount', 'paid amount'],
    payment_method: ['payment method', 'method', 'payment type', 'how paid'],
    status:         ['status', 'booking status', 'state'],
    notes:          ['notes', 'note', 'remarks', 'comments', 'comment', 'special requests'],
  }
  const patterns = aliases[fieldKey] || []
  for (const pat of patterns) {
    const idx = lower.findIndex((c) => c === pat || c.includes(pat))
    if (idx >= 0) return columns[idx]
  }
  return ''
}

function applyMapping(rawRows, mapping) {
  return rawRows.map((raw) => {
    const row = {}
    APP_FIELDS.forEach(({ key }) => {
      const col = mapping[key]
      let val = col ? raw[col] : ''
      if (key === 'check_in' || key === 'check_out') val = normaliseDate(val)
      row[key] = val !== undefined && val !== null ? String(val) : ''
    })
    return row
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
function UploadStep({ onParsed }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const handleBrowse = async () => {
    setLoading(true); setErr('')
    try {
      const result = await window.api.import.parseExcel()
      if (!result) { setLoading(false); return } // user cancelled
      if (result.error) { setErr(result.error); setLoading(false); return }
      if (result.rows.length === 0) { setErr('The Excel file has no data rows.'); setLoading(false); return }
      onParsed(result)
    } catch (e) {
      setErr(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center">
        <FileSpreadsheet size={40} className="text-green-600" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Import Historical Booking Data</h2>
        <p className="text-gray-500 text-sm max-w-md">
          Upload an Excel file (.xlsx or .xls) containing past guest bookings.
          You'll map the columns and review the data before anything is saved.
        </p>
      </div>
      <button
        onClick={handleBrowse}
        disabled={loading}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors disabled:opacity-60"
      >
        <Upload size={18} />
        {loading ? 'Reading file…' : 'Browse Excel File'}
      </button>
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
        <p>• Maximum 500 rows per import</p>
      </div>
    </div>
  )
}

// Step 2 ─ Map Columns
function MappingStep({ parsed, onMapped, onBack }) {
  const { columns, fileName, sheetName } = parsed
  const [mapping, setMapping] = useState(() => {
    const m = {}
    APP_FIELDS.forEach(({ key }) => { m[key] = smartGuess(columns, key) })
    return m
  })

  const missingRequired = APP_FIELDS.filter((f) => f.required && !mapping[f.key])

  const inp = "w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 p-3 bg-green-50 border border-green-200 rounded-xl">
        <FileSpreadsheet size={20} className="text-green-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-green-800">{fileName}</p>
          <p className="text-xs text-green-600">Sheet: {sheetName} &nbsp;·&nbsp; {parsed.rows.length} rows &nbsp;·&nbsp; {columns.length} columns detected</p>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Match each <strong>app field</strong> on the left to the corresponding <strong>Excel column</strong> on the right.
        Fields marked <span className="text-red-500">*</span> are required.
        Smart guesses have been pre-filled — review and adjust as needed.
      </p>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {APP_FIELDS.map(({ key, label, required, hint }) => (
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

// Step 3 ─ Preview & Edit
function PreviewStep({ rows, onBack, onImport }) {
  const [data, setData] = useState(rows.map((r, i) => ({ ...r, _id: i, _skip: false })))
  const [editCell, setEditCell] = useState(null) // { rowId, field }

  const activeRows = data.filter((r) => !r._skip)
  const skippedRows = data.filter((r) => r._skip)

  const updateCell = (rowId, field, value) => {
    setData((prev) => prev.map((r) => r._id === rowId ? { ...r, [field]: value } : r))
  }

  const toggleSkip = (rowId) => {
    setData((prev) => prev.map((r) => r._id === rowId ? { ...r, _skip: !r._skip } : r))
  }

  const resetAll = () => {
    setData((prev) => prev.map((r) => ({ ...r, _skip: false })))
  }

  const visibleFields = APP_FIELDS.filter((f) =>
    ['guest_name','room_number','check_in','check_out','adults','amount_paid','payment_method','status','notes'].includes(f.key)
  )

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
          <p className="text-xs text-gray-500">Click any cell to edit it. Use the ✕ button to skip a row.</p>
        </div>
        <div className="flex gap-2">
          {skippedRows.length > 0 && (
            <button onClick={resetAll} className="flex items-center gap-1 text-xs text-gray-600 border hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors">
              <RotateCcw size={12} /> Restore all
            </button>
          )}
        </div>
      </div>

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
            {data.map((row, idx) => (
              <tr key={row._id} className={row._skip ? 'bg-gray-50 opacity-40' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className={`${tdCls} text-gray-400 text-center`}>{idx + 1}</td>
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
            ))}
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
          onClick={() => onImport(activeRows.map(({ _id: _i, _skip: _s, ...rest }) => rest))}
          disabled={activeRows.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors"
        >
          Import {activeRows.length} Booking{activeRows.length !== 1 ? 's' : ''} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// Step 4 ─ Importing / Results
function ResultStep({ result, onReset }) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Importing bookings…</p>
        <p className="text-gray-400 text-sm">Please wait, this may take a moment</p>
      </div>
    )
  }

  if (result.error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <XCircle size={48} className="text-red-500" />
        <p className="text-red-700 font-semibold">Import Failed</p>
        <p className="text-red-500 text-sm bg-red-50 border border-red-200 px-4 py-2 rounded-lg">{result.error}</p>
        <button onClick={onReset} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2 rounded-xl font-medium transition-colors">
          <RotateCcw size={16} /> Try Again
        </button>
      </div>
    )
  }

  const { imported, skipped, errors } = result

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
          <p className="text-xs text-green-600 mt-1">Bookings Imported</p>
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function DataImport() {
  const [step, setStep] = useState(0)
  const [parsed, setParsed] = useState(null)      // { fileName, sheetName, columns, rows }
  const [mapping, setMapping] = useState(null)    // { fieldKey → excelColumn }
  const [previewRows, setPreviewRows] = useState(null) // mapped rows for preview
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const handleParsed = (data) => {
    setParsed(data)
    setStep(1)
  }

  const handleMapped = (m) => {
    setMapping(m)
    // Transform raw rows through mapping
    const mapped = applyMapping(parsed.rows, m)
    setPreviewRows(mapped)
    setStep(2)
  }

  const handleImport = async (rows) => {
    setStep(3)
    setImporting(true)
    setResult(null)
    try {
      const res = await window.api.import.execute(rows)
      setResult(res)
    } catch (e) {
      setResult({ error: e.message })
    }
    setImporting(false)
  }

  const reset = () => {
    setStep(0)
    setParsed(null)
    setMapping(null)
    setPreviewRows(null)
    setResult(null)
    setImporting(false)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Download size={24} className="text-green-600" />
          Data Import
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Import historical guest and booking records from an Excel spreadsheet
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <StepIndicator current={step} />

        {step === 0 && <UploadStep onParsed={handleParsed} />}
        {step === 1 && parsed && (
          <MappingStep
            parsed={parsed}
            onMapped={handleMapped}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && previewRows && (
          <PreviewStep
            rows={previewRows}
            onBack={() => setStep(1)}
            onImport={handleImport}
          />
        )}
        {step === 3 && (
          <ResultStep
            result={importing ? null : result}
            onReset={reset}
          />
        )}
      </div>
    </div>
  )
}
