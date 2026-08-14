import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAccess, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'

export async function accountingInvoke(operation, ...args) {
  const bridge = window.api?.restaurantAccountingV2?.invoke
  if (!bridge) throw new Error('Accounting is unavailable in this desktop build. Restart after updating the app.')
  return bridge(operation, ...args)
}

export async function runIdempotent(scope, action) {
  const storageKey = `restaurant-accounting:pending:${scope}`
  const durableStorage = window.localStorage
  let operationKey = durableStorage.getItem(storageKey) || window.sessionStorage.getItem(storageKey)
  if (!operationKey) {
    operationKey = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    durableStorage.setItem(storageKey, operationKey)
  }
  try {
    const result = await action(operationKey)
    durableStorage.removeItem(storageKey)
    window.sessionStorage.removeItem(storageKey)
    return result
  } catch (error) {
    // Keep the same key across a timeout, app restart, and offline replay.
    // The operator must retry the original operation rather than creating a
    // second financial intent.
    durableStorage.setItem(storageKey, operationKey)
    throw error
  }
}

export const unwrap = (result, fallback = null) => result?.data ?? result ?? fallback
export const money = (value, currency = 'BWP') => new Intl.NumberFormat('en-BW', { style: 'currency', currency }).format(Number(value || 0))
export const today = (timeZone = 'Africa/Gaborone') => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
export const firstOfMonth = (timeZone = 'Africa/Gaborone') => `${today(timeZone).slice(0, 7)}-01`

export function AccountingExportButton({ fileName, data, disabled = false, exportOperation, exportArgs = [], onError }) {
  const access = useAccess()
  const requiredCapability = exportOperation === 'exportPayrollRegister' ? 'accounting.payroll_export' : 'accounting.export'
  const canExport = canAccessCapability(access, requiredCapability)
  const [busyFormat, setBusyFormat] = useState('')
  const exportFile = async (format) => {
    setBusyFormat(format)
    try {
      if (exportOperation && window.api?.restaurantAccountingV2?.exportFile) {
        const result = await window.api.restaurantAccountingV2.exportFile({ operation: exportOperation, args: exportArgs, fileName, format })
        if (result?.success === false) throw new Error(result.error || 'Accounting export was not saved.')
        return
      }
      if (format !== 'json') throw new Error('This desktop build only supports JSON for this accounting export. Restart after updating the app.')
      const source = data
      const complete = source != null && source.complete === true && (source.export_manifest?.completeness === 'COMPLETE' || source.exportManifest?.completeness === 'COMPLETE')
      const completeness = complete ? 'COMPLETE' : 'INCOMPLETE'
      if (!complete) throw new Error(`Accounting export is ${completeness}: the server did not certify this export as complete. Resolve the named source or reconciliation exception first.`)
      const canonical = JSON.stringify(source)
      let localHash = null
      if (window.crypto?.subtle) {
        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
        localHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      }
      const envelope = {
        export_version: source.export_version || 'bar-accounting-financial-truth-v1',
        completeness: 'COMPLETE',
        source: source.source || 'server-authoritative-accounting-export',
        generated_at: source.generated_at || new Date().toISOString(),
        report_run_id: source.report_run_id || source.export_manifest?.report_run_id || source.exportManifest?.report_run_id || null,
        data_hash: source.data_hash || source.export_manifest?.data_hash || source.exportManifest?.data_hash || localHash,
        data: source,
        canonical_hash_input: canonical,
      }
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName || 'accounting-export'}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      onError?.(error?.message || String(error))
    } finally {
      setBusyFormat('')
    }
  }
  const formats = exportOperation ? ['json', 'xlsx', 'csv', 'pdf'] : ['json']
  return <div className="flex flex-wrap gap-2" aria-label="Complete accounting exports">
    {canExport && formats.map((format) => <AccountingButton key={format} tone="secondary" disabled={disabled || (!exportOperation && data == null)} busy={busyFormat === format} onClick={() => exportFile(format)}><Download size={15} />{format === 'json' ? 'JSON' : format.toUpperCase()}</AccountingButton>)}
  </div>
}

export function AccountingPage({ eyebrow, title, description, actions, children }) {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const [readiness, setReadiness] = useState(null)
  useEffect(() => { let cancelled = false; accountingInvoke('getReadiness').then((result) => { if (!cancelled) setReadiness(unwrap(result, null)) }).catch((error) => { if (!cancelled) setReadiness({ error: error.message }) }); return () => { cancelled = true } }, [])
  const releaseReady = readiness?.active === true && readiness?.ready === true && !readiness?.error
  const readinessNotice = readiness?.error
    ? <AccountingNotice type="warning">Accounting readiness could not be verified. This surface is not cleared for financial reliance: {readiness.error}</AccountingNotice>
    : readiness && readiness.ready === false
      ? <AccountingNotice type="warning">Accounting is not enabled for posting. Resolve the server readiness gate before relying on statements, exports, or subledger totals{readiness.missing_requirements?.length ? `: ${readiness.missing_requirements.join(', ')}` : '.'}</AccountingNotice>
      : null
  return <div className="hpos-page-frame min-h-full bg-slate-50 p-4 md:p-6">
    <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">{eyebrow || (barOnly ? 'Bar Accounting & Workforce' : 'Restaurant Accounting')}</p><h1 className="mt-1 text-2xl font-black text-slate-900">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p></div>
        {releaseReady && actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
    {readinessNotice}
    {readiness === null
      ? <AccountingLoading label="Verifying Accounting activation and release readiness…" />
      : releaseReady
        ? children
        : <AccountingNotice type="warning">This Accounting deep link is unavailable until the product entitlement and the server release-readiness gate both pass. No Accounting data or action is presented as financially usable.</AccountingNotice>}
  </div>
}

export function AccountingButton({ children, tone = 'primary', busy = false, disabled = false, ...props }) {
  const tones = { primary: 'bg-emerald-700 text-white hover:bg-emerald-800', secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50', danger: 'bg-rose-700 text-white hover:bg-rose-800', amber: 'bg-amber-600 text-white hover:bg-amber-700' }
  return <button type="button" disabled={disabled || busy} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone] || tones.primary}`} {...props}>{busy && <Loader2 size={15} className="animate-spin" />}{children}</button>
}

export function AccountingPanel({ title, description, actions, children, className = '' }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5 ${className}`}>
    {(title || actions) && <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-extrabold text-slate-900">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}</div>{actions}</div>}
    {children}
  </section>
}

export function AccountingNotice({ type = 'info', children }) {
  const styles = type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800'
  const Icon = type === 'error' || type === 'warning' ? AlertTriangle : ShieldCheck
  return <div className={`mb-4 flex gap-3 rounded-xl border p-3 text-sm leading-5 ${styles}`}><Icon size={18} className="mt-0.5 shrink-0" /><div>{children}</div></div>
}

export function AccountingLoading({ label = 'Loading accounting data…' }) {
  return <div className="flex min-h-48 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600"><Loader2 size={20} className="animate-spin text-emerald-700" />{label}</div>
}

export function AccountingError({ error, onRetry }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900"><div className="flex gap-3"><AlertTriangle className="shrink-0" /><div><h2 className="font-extrabold">This accounting view could not be loaded</h2><p className="mt-1 text-sm">{error || 'Unknown error'}</p>{onRetry && <AccountingButton tone="secondary" className="mt-4" onClick={onRetry}><RefreshCw size={15} />Retry</AccountingButton>}</div></div></div>
}

export function EmptyState({ title, description }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><p className="font-bold text-slate-700">{title}</p>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>
}

export const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'
export const labelClass = 'block text-xs font-bold uppercase tracking-wide text-slate-600'

