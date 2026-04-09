import { X } from 'lucide-react'

export function Modal({ title, onClose, children, size = 'md' }) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm">
      <div
        className={`w-full ${widths[size]} max-h-[90vh] overflow-hidden rounded-[20px] border border-slate-200/70 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur flex flex-col`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-900">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>
      </div>
    </div>
  )
}
