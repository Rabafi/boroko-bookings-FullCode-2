import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export function DarkConfirmDialog({
  open,
  title = 'Are you sure?',
  message = 'This action needs confirmation before we continue.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus()
    }
  }, [open])

  if (!open) return null

  const toneStyles = {
    danger: { icon: 'bg-red-500/20 text-red-400', btn: 'bg-red-600 hover:bg-red-700' },
    warning: { icon: 'bg-amber-500/20 text-amber-400', btn: 'bg-amber-600 hover:bg-amber-700' },
    info: { icon: 'bg-blue-500/20 text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700' }
  }
  const style = toneStyles[tone] || toneStyles.danger

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${style.icon}`}>
              <AlertTriangle size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">{title}</h2>
              <p className="mt-1 text-sm text-gray-400">{message}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-xl p-2 text-gray-500 hover:text-gray-300 hover:bg-gray-800">
            <X size={17} />
          </button>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${style.btn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
