import { AlertTriangle, X } from 'lucide-react'

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message = 'This action needs confirmation before we continue.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  if (!open) return null

  const toneClass = tone === 'danger'
    ? 'bg-rose-100 text-rose-700'
    : tone === 'warning'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700'
  const buttonClass = tone === 'danger'
    ? 'bg-rose-600 hover:bg-rose-700'
    : tone === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700'
      : 'bg-emerald-600 hover:bg-emerald-700'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white/96 p-5 shadow-[0_28px_90px_rgba(15,23,42,0.28)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${toneClass}`}>
              <AlertTriangle size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-[-0.02em] text-slate-900">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={17} />
          </button>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary justify-center">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${buttonClass}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
