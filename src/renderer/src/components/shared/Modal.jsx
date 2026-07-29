import { useEffect } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children, footer = null, size = 'md' }) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && typeof onClose === 'function') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto flex w-full ${widths[size]} max-h-[calc(100vh-1.5rem)] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-h-[calc(100vh-3rem)] sm:max-h-[calc(100dvh-3rem)]`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-slate-50/65 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-slate-900">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={typeof onClose !== 'function'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all hover:border-slate-200 hover:bg-white hover:text-slate-700 focus-visible:outline-none"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center border-t border-slate-200/80 bg-white px-5 py-4 shadow-[0_-10px_24px_rgba(15,23,42,0.05)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
