import { X } from 'lucide-react'

export function Modal({ title, onClose, children, size = 'md' }) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div
        className={`w-full ${widths[size]} max-h-[92vh] overflow-hidden rounded-[24px] border border-white/70 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur flex flex-col`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 bg-slate-50/65 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-slate-900">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all hover:border-slate-200 hover:bg-white hover:text-slate-700 focus-visible:outline-none"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
