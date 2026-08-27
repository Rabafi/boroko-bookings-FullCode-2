import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CircleAlert, Clock3, Download, Printer, RefreshCw, ShieldCheck } from 'lucide-react'
import { useSettings } from '../app-context'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
]

const unavailable = 'Unavailable'

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function display(value, suffix = '') {
  const parsed = number(value)
  return parsed === null ? unavailable : `${parsed.toLocaleString()}${suffix}`
}

function money(value, currency) {
  const parsed = number(value)
  return parsed === null
    ? unavailable
    : `${currency} ${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function paymentRows(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([method, amount]) => ({ method, amount }))
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function BasicReports() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [rangeDays, setRangeDays] = useState(1)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [artifactBusy, setArtifactBusy] = useState('')
  const [artifactError, setArtifactError] = useState('')
  const [artifactNotice, setArtifactNotice] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')

  const load = async (days) => {
    setLoading(true)
    setError('')
    try {
      const bridge = window.api?.reports?.basicSummary
      if (typeof bridge !== 'function') {
        throw new Error('Basic report service is not available in this desktop build.')
      }
      const result = await bridge(days)
      if (!result || result.schema_version !== 'starter-basic-report-v1') {
        throw new Error('The server returned an invalid basic report response.')
      }
      setReport(result)
    } catch (err) {
      setReport(null)
      setError(err?.message || 'Could not load the basic report.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(rangeDays) }, [rangeDays])

  const nextPaint = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })

  const createArtifact = async (kind) => {
    if (!report || artifactBusy) return
    setArtifactBusy(kind)
    setArtifactError('')
    setArtifactNotice('')
    const timestamp = new Date().toLocaleString()
    setGeneratedAt(timestamp)
    try {
      await nextPaint()
      const bridge = kind === 'pdf'
        ? window.api?.reports?.basicSavePDF
        : window.api?.reports?.basicPrint
      if (typeof bridge !== 'function') {
        throw new Error('Starter report printing is not available in this desktop build.')
      }
      const result = kind === 'pdf'
        ? await bridge({ rangeDays })
        : await bridge({ operationId: crypto.randomUUID() })
      if (result?.canceled) {
        setArtifactNotice('PDF save cancelled. No file was created.')
      } else if (result?.success) {
        setArtifactNotice(kind === 'pdf'
          ? `PDF saved${result.fileName ? ` as ${result.fileName}` : ''}.`
          : 'Report sent to the selected printer.')
      } else {
        throw new Error(result?.error || (kind === 'pdf' ? 'The PDF could not be saved.' : 'The report could not be printed.'))
      }
    } catch (err) {
      setArtifactError(err?.message || (kind === 'pdf' ? 'The PDF could not be saved.' : 'The report could not be printed.'))
    } finally {
      setArtifactBusy('')
    }
  }

  const operational = report?.operational || {}
  const financial = report?.financial || {}
  const certified = report?.complete === true
    && report?.dataset_status === 'certified'
    && financial?.certified === true
  const methods = useMemo(
    () => paymentRows(financial.by_payment_method),
    [financial.by_payment_method]
  )
  const trend = Array.isArray(operational.trend) ? operational.trend : []
  const financialReason = financial.unavailable_reason
    || 'The server could not certify every financial source row. Amounts are withheld.'

  return (
    <main id="printable-report" className="mx-auto max-w-6xl space-y-6 p-6" data-testid="basic-reports">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Starter · view only</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">Operating summary</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            A server-backed snapshot of lodge activity. Financial values appear only when the payment-ledger evidence is certified.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Report period">
            {RANGES.map(({ days, label }) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${rangeDays === days ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                aria-pressed={rangeDays === days}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => createArtifact('pdf')} disabled={!report || loading || Boolean(artifactBusy)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="h-4 w-4" /> {artifactBusy === 'pdf' ? 'Saving…' : 'Save PDF'}
          </button>
          <button type="button" onClick={() => createArtifact('print')} disabled={!report || loading || Boolean(artifactBusy)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Printer className="h-4 w-4" /> {artifactBusy === 'print' ? 'Printing…' : 'Print'}
          </button>
        </div>
      </header>

      <div className="print-only mb-6 border-b-2 border-emerald-700 pb-4">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Tsa Bonno HospitalityOS · Starter</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{settings?.lodge_name || settings?.company_name || 'Lodge'} · Basic Operating Summary</h1>
        <p className="mt-1 text-sm text-slate-700">Period: {report?.period?.start || 'Unavailable'} to {report?.period?.end || 'Unavailable'} ({rangeDays} day{rangeDays === 1 ? '' : 's'})</p>
        <p className="mt-1 text-xs text-slate-600">Generated: {generatedAt || 'Unavailable'} · Certification: {certified ? 'Certified' : 'Not certified — financial values withheld'} · Source: server-authoritative · View-only</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Report unavailable</p>
            <p className="mt-1">{error} Check the connection and try again. If it continues, confirm the Starter report migration is deployed.</p>
          </div>
        </div>
      )}

      {artifactError && <div className="no-print rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{artifactError}</div>}
      {artifactNotice && <div className="no-print rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{artifactNotice}</div>}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          <RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />
          Loading server summary…
        </div>
      ) : report ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Occupancy"
              value={display(operational.occupancy_rate, '%')}
              hint={`${display(operational.occupied_room_nights)} occupied room-nights · ${display(operational.available_room_nights)} available`}
            />
            <Metric label="Arrivals" value={display(operational.arrivals)} />
            <Metric label="Departures" value={display(operational.departures)} />
            <Metric
              label="Bookings created"
              value={display(operational.bookings_created)}
              hint={`${display(operational.cancelled)} cancelled · ${display(operational.no_shows)} no-shows`}
            />
          </section>

          <p className="text-xs text-slate-500">
            Today: {display(operational.occupied_rooms_today)} occupied and {display(operational.available_rooms_today)} available rooms. {operational.occupancy_basis}
          </p>

          <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Net collections by method</h2>
                  <p className="mt-1 text-xs text-slate-500">Signed payment ledger, including refunds</p>
                </div>
                <ShieldCheck className={`h-5 w-5 ${certified ? 'text-emerald-600' : 'text-amber-500'}`} aria-label={certified ? 'Certified' : 'Not certified'} />
              </div>
              {!certified ? (
                <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{financialReason}</div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <div><span className="block text-xs text-slate-500">Gross</span><strong>{money(financial.gross_collections, currency)}</strong></div>
                    <div><span className="block text-xs text-slate-500">Refunds</span><strong>{money(financial.refunds, currency)}</strong></div>
                    <div><span className="block text-xs text-slate-500">Net</span><strong>{money(financial.net_collections, currency)}</strong></div>
                  </div>
                  <div className="mt-2 divide-y divide-slate-100">
                    {methods.length ? methods.map((row) => (
                      <div className="flex justify-between py-3 text-sm" key={row.method}>
                        <span className="capitalize text-slate-600">{row.method.replaceAll('_', ' ')}</span>
                        <strong className="text-slate-900">{money(row.amount, currency)}</strong>
                      </div>
                    )) : <p className="py-3 text-sm text-slate-500">No collections recorded in this period.</p>}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Outstanding balances</h2>
              <p className="mt-1 text-xs text-slate-500">Current active booking balances, derived from the payment ledger</p>
              <p className="mt-5 text-3xl font-bold text-slate-900">{certified ? money(financial.outstanding, currency) : unavailable}</p>
              {!certified && <p className="mt-2 text-xs text-amber-700">Unavailable until financial evidence is complete.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-700" />
              <h2 className="font-bold text-slate-900">Activity trend</h2>
              <span className="ml-auto text-xs text-slate-500">{rangeDays} day{rangeDays === 1 ? '' : 's'}</span>
            </div>
            {trend.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {trend.map((row) => (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm" key={row.date}>
                    <p className="text-xs text-slate-500">{row.date}</p>
                    <p className="mt-1 font-semibold text-slate-900">{display(row.bookings_created)} bookings created</p>
                    <p className="text-xs text-slate-600">{display(row.arrivals)} arrivals · {display(row.departures)} departures</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">No activity was returned for this period.</p>}
          </section>
        </>
      ) : null}

      <footer className="flex items-center gap-2 text-xs text-slate-500">
        <Clock3 className="h-4 w-4" />
        Server-generated · view-only · PDF/print snapshot only. CSV, Excel, and full report exports are not available in Starter.
      </footer>
    </main>
  )
}
