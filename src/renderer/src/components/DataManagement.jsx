import { useEffect, useState } from 'react'
import { Database, Upload, Download, FileSpreadsheet, Users, BedDouble, Receipt, ShoppingCart, CheckCircle2, AlertCircle, Loader2, HardDrive, ShieldCheck } from 'lucide-react'
import DataImport from './DataImport'

const TABS = ['Import Data', 'Export Data', 'Backups']

const EXPORT_SECTIONS = [
  { icon: FileSpreadsheet, label: 'Bookings',   desc: 'All booking records — guest, room, dates, status, payments' },
  { icon: ShieldCheck,     label: 'Invoices',   desc: 'Booking invoice register with balances and guest contacts' },
  { icon: Users,           label: 'Guests',     desc: 'Full guest directory with contact and ID details' },
  { icon: BedDouble,       label: 'Rooms',      desc: 'Room list with types, rates and configurations' },
  { icon: FileSpreadsheet, label: 'Quotations', desc: 'Quotation history and conversion pipeline data' },
  { icon: Receipt,         label: 'Expenses',   desc: 'All expense records by category' },
  { icon: ShoppingCart,    label: 'POS Orders', desc: 'Point-of-sale transaction history with line items' },
  { icon: Database,        label: 'Operations', desc: 'Maintenance, inventory, supplies, conference, and day-use data' },
]

function ExportTab() {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null) // { success, filePath, error, canceled }

  const handleExport = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await window.api.data.exportAll()
      setResult(res)
    } catch (e) {
      setResult({ success: false, error: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <p className="text-gray-500 text-sm mb-6">
        Export a complete snapshot of your lodge data into a single Excel workbook. Each category
        becomes its own sheet — ready for archiving, migration, or offline analysis.
      </p>

      {/* Sections list */}
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
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4">
          <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-800">Export complete</p>
            <p className="text-xs text-green-600 mt-0.5 break-all">{result.filePath}</p>
          </div>
        </div>
      )}
      {result?.error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{result.error}</p>
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Exporting…</>
          : <><Download size={16} /> Export All Data</>
        }
      </button>
    </div>
  )
}

function BackupsTab() {
  const [info, setInfo] = useState({ backups: [], backupDir: '', policy: null })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyRunning, setPolicyRunning] = useState(false)
  const [policyResult, setPolicyResult] = useState(null)
  const [policy, setPolicy] = useState({
    enabled: false,
    target_dir: '',
    export_json: true,
    export_excel: true
  })

  const loadInfo = async () => {
    const data = await window.api.backup.getInfo().catch(() => ({ backups: [], backupDir: '', policy: null }))
    setInfo(data || { backups: [], backupDir: '', policy: null })
    if (data?.policy) {
      setPolicy({
        enabled: data.policy.enabled === true,
        target_dir: data.policy.target_dir || '',
        export_json: data.policy.export_json !== false,
        export_excel: data.policy.export_excel !== false
      })
    }
  }

  useEffect(() => {
    loadInfo()
  }, [])

  const handleCreate = async () => {
    setLoading(true)
    setResult(null)
    const res = await window.api.backup.createManual().catch((e) => ({ success: false, error: e.message }))
    setResult(res)
    setLoading(false)
    loadInfo()
  }

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
        export_json: res.policy.export_json !== false,
        export_excel: res.policy.export_excel !== false
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
      const parts = [res.jsonPath, res.excelPath].filter(Boolean)
      setPolicyResult({
        success: true,
        message: parts.length > 0
          ? `Managed export created: ${parts.join(' | ')}`
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
    <div className="p-6 max-w-3xl space-y-6">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Managed Weekly Exports</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create automatic weekly Excel and JSON snapshots into a synced folder like OneDrive, Google Drive, or Dropbox. Supabase remains the parent system; this adds an extra client-side recovery layer.
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

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Export formats</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={policy.export_excel}
                  onChange={(e) => savePolicy({ export_excel: e.target.checked })}
                  disabled={policySaving}
                />
                Excel workbook
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={policy.export_json}
                  onChange={(e) => savePolicy({ export_json: e.target.checked })}
                  disabled={policySaving}
                />
                JSON snapshot
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-4">
          <p className="text-sm font-semibold text-gray-900">Managed backup folder</p>
          <p className="mt-1 break-all text-xs text-gray-500">
            {policy.target_dir || 'No synced folder selected yet.'}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Choose a folder inside OneDrive, Google Drive, Dropbox, or another synced location so weekly Boroko exports are copied off the device automatically.
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
              disabled={policyRunning || !policy.target_dir || (!policy.export_excel && !policy.export_json)}
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

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Backup Center</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create expanded local snapshots for recovery, migration, or support-led restore work.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <HardDrive size={16} />}
              {loading ? 'Creating…' : 'Create Manual Backup'}
            </button>
            <button
              onClick={() => window.api.backup.openFolder()}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              <Download size={16} />
              Open Backup Folder
            </button>
          </div>
        </div>

        {result?.success && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            Manual backup created: {result.filePath}
          </div>
        )}
        {result?.error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {result.error}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Recent Backups</h3>
        <p className="mt-1 text-xs text-gray-500">{info.backupDir || 'Backup directory unavailable'}</p>
        <div className="mt-4 space-y-3">
          {(info.backups || []).map((backup) => (
            <div key={backup.name} className="rounded-xl bg-gray-50 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">{backup.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {new Date(backup.created).toLocaleString('en-GB')} · {(Number(backup.size || 0) / 1024).toFixed(1)} KB
              </p>
            </div>
          ))}
          {!info.backups?.length && (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
              No local backups found yet. Create one to start building restore coverage for this device.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DataManagement() {
  const [tab, setTab] = useState(0)

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Database size={20} className="text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Data Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Import or export lodge data</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
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
      {tab === 0 ? <DataImport /> : tab === 1 ? <ExportTab /> : <BackupsTab />}
    </div>
  )
}
