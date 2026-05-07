import { ArrowRight, X } from 'lucide-react'

export function ContextDrawer({ open, title, subtitle, children, actions = [], onClose }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white/96 shadow-[-24px_0_80px_rgba(15,23,42,0.22)]" onClick={(event) => event.stopPropagation()}>
        <header className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700/75">Details</p>
              <h2 className="mt-1 truncate text-lg font-bold tracking-[-0.03em] text-slate-900">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {actions.length > 0 && (
          <footer className="border-t border-slate-200 bg-slate-50/90 px-5 py-4">
            <div className="grid gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={action.primary ? 'btn-primary justify-between' : 'btn-secondary justify-between'}
                >
                  {action.label}
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </footer>
        )}
      </aside>
    </div>
  )
}
