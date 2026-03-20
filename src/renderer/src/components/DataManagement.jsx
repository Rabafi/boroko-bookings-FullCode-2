import { useState } from 'react'
import { Database, Upload, Download, FileSpreadsheet, Users, BedDouble, Receipt, ShoppingCart, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import DataImport from './DataImport'

const TABS = ['Import Data', 'Export Data']

const EXPORT_SECTIONS = [
  { icon: FileSpreadsheet, label: 'Bookings',   desc: 'All booking records — guest, room, dates, status, payments' },
  { icon: Users,           label: 'Guests',     desc: 'Full guest directory with contact and ID details' },
  { icon: BedDouble,       label: 'Rooms',      desc: 'Room list with types, rates and configurations' },
  { icon: Receipt,         label: 'Expenses',   desc: 'All expense records by category' },
  { icon: ShoppingCart,    label: 'POS Orders', desc: 'Point-of-sale transaction history with line items' },
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
            {i === 0 ? <Upload size={14} /> : <Download size={14} />}
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 0 ? <DataImport /> : <ExportTab />}
    </div>
  )
}
