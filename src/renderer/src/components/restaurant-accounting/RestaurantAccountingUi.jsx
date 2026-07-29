import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useSettings } from '../../app-context'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'

export async function accountingInvoke(operation, ...args) {
  const bridge = window.api?.restaurantAccountingV2?.invoke
  if (!bridge) throw new Error('Accounting is unavailable in this desktop build. Restart after updating the app.')
  return bridge(operation, ...args)
}

export async function runIdempotent(scope, action) {
  const storageKey = `restaurant-accounting:pending:${scope}`
  let operationKey = window.sessionStorage.getItem(storageKey)
  if (!operationKey) {
    operationKey = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.sessionStorage.setItem(storageKey, operationKey)
  }
  const result = await action(operationKey)
  window.sessionStorage.removeItem(storageKey)
  return result
}

export const unwrap = (result, fallback = null) => result?.data ?? result ?? fallback
export const money = (value, currency = 'BWP') => new Intl.NumberFormat('en-BW', { style: 'currency', currency }).format(Number(value || 0))
export const today = () => new Date().toISOString().slice(0, 10)
export const firstOfMonth = () => `${today().slice(0, 7)}-01`

export function AccountingPage({ eyebrow, title, description, actions, children }) {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  return <div className="hpos-page-frame min-h-full bg-slate-50 p-4 md:p-6">
    <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">{eyebrow || (barOnly ? 'Bar Accounting & Workforce' : 'Restaurant Accounting')}</p><h1 className="mt-1 text-2xl font-black text-slate-900">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p></div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
    {children}
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

