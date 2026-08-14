import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Database, Upload, Download, FileSpreadsheet, Users, BedDouble, Receipt, ShoppingCart, CheckCircle2, AlertCircle, Loader2, HardDrive, ShieldCheck, Clock, Wallet, ClipboardCheck, AlertTriangle } from 'lucide-react'
import DataImport from './DataImport'
import { useSettings } from '../app-context'
import { isBarOnlyMode, isRestaurantOnly } from '../../../shared/propertyTypes'

const LODGE_TABS = ['Import Bookings', 'Export Data', 'Backups']
const RESTAURANT_TABS = ['Import Data', 'Export Data', 'Backups']

const LODGE_EXPORT_PRESETS = [
  { key: 'full', label: 'Full Backup Export', desc: 'Everything needed for archiving and support-led recovery.' },
  { key: 'finance', label: 'Finance Export', desc: 'Invoices, expenses, POS, purchases, conference, and day-use income.' },
  { key: 'bookingGuest', label: 'Bookings & Guests', desc: 'Bookings, guests, invoices, and quotations.' },
  { key: 'operations', label: 'Operations Export', desc: 'Rooms, maintenance, stock, supplies, conference, and day-use records.' },
  { key: 'inventory', label: 'Inventory & Supplies', desc: 'Stock items and purchase history only.' },
]

const RESTAURANT_EXPORT_PRESETS = [
  { key: 'restaurant_full', label: 'Full Restaurant Backup', desc: 'Everything needed for archiving and support-led recovery.' },
  { key: 'restaurant_dailyClose', label: 'Daily Close Pack', desc: 'POS sales, expenses, shifts, cash drawer, checklists, and alerts for end-of-day.' },
  { key: 'restaurant_sales', label: 'Sales & Payments', desc: 'POS orders, expenses, cash drawer sessions, and customer data.' },
  { key: 'restaurant_stock', label: 'Stock & Recipe Costing', desc: 'Inventory items, purchases, recipes, and stock movements.' },
  { key: 'restaurant_purchasing', label: 'Purchasing & Suppliers', desc: 'Suppliers, purchase orders, and purchase history.' },
  { key: 'restaurant_staff', label: 'Staff & Shifts', desc: 'Staff roster, shift history, and activity log.' },
  { key: 'restaurant_customers', label: 'Customers & Loyalty', desc: 'Customer directory and activity history.' },
]

const LODGE_EXPORT_SECTIONS = [
  { icon: FileSpreadsheet, label: 'Bookings',   desc: 'All booking records — guest, room, dates, status, payments' },
  { icon: ShieldCheck,     label: 'Invoices',   desc: 'Booking invoice register with balances and guest contacts' },
  { icon: Users,           label: 'Guests',     desc: 'Full guest directory with contact and ID details' },
  { icon: BedDouble,       label: 'Rooms',      desc: 'Room list with types, rates and configurations' },
  { icon: FileSpreadsheet, label: 'Quotations', desc: 'Quotation history and conversion pipeline data' },
  { icon: Receipt,         label: 'Expenses',   desc: 'All expense records by category' },
  { icon: ShoppingCart,    label: 'POS Orders', desc: 'Point-of-sale transaction history with line items' },
  { icon: Database,        label: 'Operations', desc: 'Maintenance, inventory, supplies, conference, and day-use data' },
]

const RESTAURANT_EXPORT_SECTIONS = [
  { icon: ShoppingCart,    label: 'POS Sales',       desc: 'Transaction history with line items and payment methods' },
  { icon: Receipt,         label: 'Expenses',         desc: 'All expense records by category' },
  { icon: Database,        label: 'Inventory',        desc: 'Stock items, ingredients, and purchase history' },
  { icon: FileSpreadsheet, label: 'Recipes',          desc: 'Recipe compositions and ingredient costing' },
  { icon: Users,           label: 'Staff',            desc: 'Staff roster with roles and contact details' },
  { icon: Clock,           label: 'Shifts',           desc: 'Clock-in/out history with durations' },
  { icon: Wallet,          label: 'Cash Drawer',      desc: 'Cash drawer sessions with float and variance' },
  { icon: FileSpreadsheet, label: 'Purchasing',       desc: 'Suppliers, purchase orders, and receiving records' },
  { icon: FileSpreadsheet, label: 'Customers',        desc: 'Customer directory with loyalty status' },
  { icon: AlertTriangle,   label: 'Alerts',           desc: 'Exception alerts and operational issues' },
  { icon: ClipboardCheck,  label: 'Checklists',       desc: 'Daily opening, closing, and cleaning checklists' },
]

function ExportTab({ restaurantMode, EXPORT_PRESETS, EXPORT_SECTIONS }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null) // { success, filePath, error, canceled }
  const [preset, setPreset] = useState(restaurantMode ? 'restaurant_full' : 'full')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [privacyMode, setPrivacyMode] = useState(false)
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    const expectedPrefix = restaurantMode ? 'restaurant_' : ''
    if (!String(preset).startsWith(expectedPrefix)) {
      setPreset(restaurantMode ? 'restaurant_full' : 'full')
    }
  }, [restaurantMode, preset])

  useEffect(() => {
    if (!window.api.data.onExportProgress) return undefined
    return window.api.data.onExportProgress((next) => setProgress(next))
  }, [])

  const handleExport = async () => {
    setLoading(true)
    setResult(null)
    setProgress(null)
    try {
      const res = await window.api.data.exportAll({
        preset,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        privacyMode
      })
      setResult(res)
    } catch (e) {
      setResult({ success: false, error: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={restaurantMode ? 'hpos-data-panel' : 'p-6 max-w-3xl'}>
      <p className="text-gray-500 text-sm mb-6">
        Export {restaurantMode ? 'restaurant' : 'lodge'} data into a multi-sheet Excel workbook. Choose a focused export when you do
        not need the full backup snapshot.
      </p>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {EXPORT_PRESETS.map((option) => (
          <label
            key={option.key}
            className={`rounded-xl border px-4 py-3 transition ${
                preset === option.key ? (restaurantMode ? 'hpos-export-option is-selected' : 'border-green-300 bg-green-50') : (restaurantMode ? 'hpos-export-option' : 'border-gray-200 bg-white hover:bg-gray-50')
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="exportPreset"
                value={option.key}
                checked={preset === option.key}
                onChange={(e) => setPreset(e.target.value)}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-gray-800">{option.label}</p>
                <p className="mt-1 text-xs text-gray-500">{option.desc}</p>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
        <p className="text-sm font-semibold text-gray-800">Optional export controls</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-gray-600">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800"
            />
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={privacyMode}
            onChange={(e) => setPrivacyMode(e.target.checked)}
            className="mt-1"
          />
          <span>Privacy mode: hide {restaurantMode ? 'customer' : 'guest'} email, phone, and ID/passport fields in the export.</span>
        </label>
      </div>

      <div className="space-y-2 mb-8">
        {EXPORT_SECTIONS.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-start gap-3 bg-gray-50 rounded-lg px-4 py-3">
            <div className="w-8 h-8 rounded-md bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
              <Icon size={15} className="text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Result feedback */}
      {result?.success && (
        <div className={`flex items-start gap-3 rounded-lg px-4 py-3 mb-4 ${result.complete === false ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
          {result.complete === false
            ? <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            : <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />}
          <div>
            <p className={`text-sm font-medium ${result.complete === false ? 'text-amber-800' : 'text-green-800'}`}>
              {result.complete === false ? 'Export incomplete — review the Export Manifest sheet' : 'Export complete'}
            </p>
            <p className={`text-xs mt-0.5 break-all ${result.complete === false ? 'text-amber-700' : 'text-green-600'}`}>{result.filePath}</p>
            {Array.isArray(result.sections) && (
              <p className={`mt-1 text-xs ${result.complete === false ? 'text-amber-700' : 'text-green-700'}`}>
                {result.sections.length} workbook section{result.sections.length === 1 ? '' : 's'} exported.
                {result.exportManifest?.errors?.length ? ` ${result.exportManifest.errors.length} source issue${result.exportManifest.errors.length === 1 ? '' : 's'} recorded.` : ''}
              </p>
            )}
          </div>
        </div>
      )}
      {result?.error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{result.error}</p>
        </div>
      )}
      {loading && progress?.stage && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          Export progress: {progress.stage}
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={loading}
        className={restaurantMode ? 'hpos-primary-action' : 'flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors'}
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Exporting…</>
          : <><Download size={16} /> Export Workbook</>
        }
      </button>
    </div>
  )
}

function BackupsTab({ restaurantMode }) {
  const [info, setInfo] = useState({ backups: [], backupDir: '', policy: null })
  const [policySaving, setPolicySaving] = useState(false)
  const [policyRunning, setPolicyRunning] = useState(false)
  const [policyResult, setPolicyResult] = useState(null)
  const [policy, setPolicy] = useState({
    enabled: false,
    target_dir: '',
    export_json: true,
    export_excel: true,
    enforcement_level: 'reminder'
  })

  const loadInfo = async () => {
    const data = await window.api.backup.getInfo().catch(() => ({ backups: [], backupDir: '', policy: null }))
    setInfo(data || { backups: [], backupDir: '', policy: null })
    if (data?.policy) {
      setPolicy({
        enabled: data.policy.enabled === true,
        target_dir: data.policy.target_dir || '',
        export_excel: true, // Always true now
        enforcement_level: data.policy.enforcement_level || 'reminder'
      })
    }
  }

  useEffect(() => {
    loadInfo()
  }, [])

  const savePolicy = async (updates) => {
    setPolicySaving(true)
    setPolicyResult(null)
    try {
      const nextPolicy = { ...policy, ...updates }
      const res = await window.api.backup.savePolicy(nextPolicy)
      if (!res?.success) throw new Error(res?.error || 'Could not save backup policy.')
      setPolicy({
        enabled: res.policy.enabled === true,
        target_dir: res.policy.target_dir || '',
        export_excel: true,
        enforcement_level: res.policy.enforcement_level || 'reminder'
      })
      setPolicyResult({ success: true, message: 'Managed weekly export policy updated.' })
      await loadInfo()
    } catch (e) {
      setPolicyResult({ success: false, error: e.message || 'Could not save backup policy.' })
    } finally {
      setPolicySaving(false)
    }
  }

  const chooseTargetFolder = async () => {
    setPolicyResult(null)
    const res = await window.api.backup.chooseTargetFolder().catch((e) => ({ success: false, error: e.message }))
    if (res?.canceled) return
    if (!res?.success) {
      setPolicyResult({ success: false, error: res?.error || 'Could not choose backup folder.' })
      return
    }
    await savePolicy({ target_dir: res.path })
  }

  const runManagedNow = async () => {
    setPolicyRunning(true)
    setPolicyResult(null)
    try {
      const res = await window.api.backup.runManagedNow()
      if (!res?.success) throw new Error(res?.error || 'Managed weekly export failed.')
      setPolicyResult({
        success: true,
        message: res.excelPath
          ? `Managed export created: ${res.excelPath}`
          : 'Managed export completed.'
      })
      await loadInfo()
    } catch (e) {
      setPolicyResult({ success: false, error: e.message || 'Managed weekly export failed.' })
    } finally {
      setPolicyRunning(false)
    }
  }

  const policyStatus = info.policy || {}
  const statusTone =
    policyStatus.compliance_state === 'healthy' ? 'green' :
    policyStatus.compliance_state === 'disabled' ? 'slate' :
    policyStatus.compliance_state === 'pending_first_run' ? 'blue' :
    'amber'
  const statusClass =
    statusTone === 'green' ? 'border-green-200 bg-green-50 text-green-700' :
    statusTone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-700' :
    statusTone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-700' :
    'border-slate-200 bg-slate-50 text-slate-700'
  const statusLabel =
    policyStatus.compliance_state === 'healthy' ? 'Healthy' :
    policyStatus.compliance_state === 'disabled' ? 'Disabled' :
    policyStatus.compliance_state === 'pending_first_run' ? 'Waiting for first run' :
    policyStatus.compliance_state === 'setup_required' ? 'Setup required' :
    'Needs attention'

  return (
    <div className={restaurantMode ? 'hpos-data-panel space-y-6' : 'p-6 max-w-3xl space-y-6'}>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Weekly Data Archiving</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create a complete Excel snapshot of all {restaurantMode ? 'restaurant' : 'lodge'} {restaurantMode ? 'sales, stock, and operational' : 'transactions, guests, and operational'} history. Keep this enabled so System Health can warn you when a fresh off-device backup is overdue.
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
            {statusLabel}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Enable weekly managed exports</p>
                <p className="mt-1 text-xs text-gray-500">Runs automatically in the desktop app and writes to the selected sync folder.</p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={policy.enabled}
                onChange={(e) => savePolicy({ enabled: e.target.checked })}
                disabled={policySaving}
              />
            </div>
          </label>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-sm font-semibold text-blue-900">Export Format</p>
            <div className="mt-2 flex items-center gap-2 text-sm text-blue-700">
              <ShieldCheck size={16} />
              <span>Full Multi-Sheet Excel Workbook</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Reminder enforcement
          </label>
          <select
            value={policy.enforcement_level || 'reminder'}
            onChange={(e) => savePolicy({ enforcement_level: e.target.value })}
            disabled={policySaving}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800"
          >
            <option value="reminder">Reminder only</option>
            <option value="warning">Warning banner</option>
            <option value="strict">Strict launch warning</option>
          </select>
          <p className="mt-2 text-xs text-gray-500">
            Strict mode keeps the dashboard warning visible until a managed export completes.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-4">
          <p className="text-sm font-semibold text-gray-900">Managed backup folder</p>
          <p className="mt-1 break-all text-xs text-gray-500">
            {policy.target_dir || 'No synced folder selected yet.'}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Choose a folder inside OneDrive, Google Drive, Dropbox, or another synced location so weekly Tsa Bonno exports are copied off the device automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={chooseTargetFolder}
              disabled={policySaving}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              <HardDrive size={15} />
              Choose Synced Folder
            </button>
            <button
              onClick={() => window.api.backup.openManagedFolder()}
              disabled={!policy.target_dir}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <Download size={15} />
              Open Managed Folder
            </button>
            <button
              onClick={runManagedNow}
              disabled={policyRunning || !policy.target_dir}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {policyRunning ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              {policyRunning ? 'Running…' : 'Run Weekly Export Now'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last successful export</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">
              {policyStatus.last_success_at ? new Date(policyStatus.last_success_at).toLocaleString('en-GB') : 'Not yet completed'}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next due</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">
              {policyStatus.next_due_at ? new Date(policyStatus.next_due_at).toLocaleString('en-GB') : 'Runs after first success'}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Policy guidance</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">
              {policyStatus.requires_setup
                ? 'Choose a synced folder to activate the policy.'
                : policyStatus.overdue
                  ? 'This device needs a fresh managed export.'
                  : 'Local backup, Supabase, and synced export can work together.'}
            </p>
          </div>
        </div>

        {policyStatus.last_error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Last managed export issue: {policyStatus.last_error}
          </div>
        )}

        {policyResult?.success && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {policyResult.message}
          </div>
        )}
        {policyResult?.error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {policyResult.error}
          </div>
        )}
      </div>

    </div>
  )
}

export default function DataManagement() {
  const location = useLocation()
  const [tab, setTab] = useState(0)
  const { settings } = useSettings()
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const normalizedPropertyType = String(propertyType || '').trim().toLowerCase()
  const restaurantMode = isRestaurantOnly(propertyType) || ['bar', 'bar_only'].includes(normalizedPropertyType) || isBarOnlyMode(settings)
  const TABS = restaurantMode ? RESTAURANT_TABS : LODGE_TABS
  const EXPORT_PRESETS = restaurantMode ? RESTAURANT_EXPORT_PRESETS : LODGE_EXPORT_PRESETS
  const EXPORT_SECTIONS = restaurantMode ? RESTAURANT_EXPORT_SECTIONS : LODGE_EXPORT_SECTIONS

  useEffect(() => {
    const requestedTab = location.state?.activeTab
    if (requestedTab === 'export') setTab(1)
    if (requestedTab === 'backups') setTab(2)
    if (requestedTab === 'import') setTab(0)
  }, [location.state?.activeTab])

  return (
    <div className={restaurantMode ? 'hpos-data-workspace' : 'p-6 max-w-5xl'}>
      {/* Header */}
      <div className={restaurantMode ? 'hpos-data-hero' : 'flex items-center gap-3 mb-6'}>
        <div className={restaurantMode ? 'hpos-data-hero-icon' : 'w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center'}>
          <Database size={20} />
        </div>
        <div>
          <p className={restaurantMode ? 'hpos-eyebrow' : 'hidden'}>{restaurantMode ? 'Business continuity' : ''}</p>
          <h1 className="text-2xl font-bold text-gray-800">{restaurantMode ? 'Data & backups' : 'Data Management'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{restaurantMode ? 'Move restaurant or bar data safely, create professional workbooks, and protect the business.' : 'Import or export lodge data'}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className={restaurantMode ? 'hpos-data-tabs' : 'flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6'}>
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === i
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {i === 0 ? <Upload size={14} /> : i === 1 ? <Download size={14} /> : <HardDrive size={14} />}
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 0 ? <DataImport /> : tab === 1 ? <ExportTab restaurantMode={restaurantMode} EXPORT_PRESETS={EXPORT_PRESETS} EXPORT_SECTIONS={EXPORT_SECTIONS} /> : <BackupsTab restaurantMode={restaurantMode} />}
    </div>
  )
}
