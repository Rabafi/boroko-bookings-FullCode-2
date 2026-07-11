import { HelpCircle } from 'lucide-react'

export function HelpTip({ label, children }) {
  return <span className="group relative inline-flex align-middle" tabIndex="0" aria-label={label}>
    <HelpCircle size={15} className="cursor-help text-slate-400 transition group-hover:text-slate-700" />
    <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-64 -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-xl group-hover:block group-focus:block">{children}</span>
  </span>
}

export default function RestaurantPageGuide({ title, description, nextStep, help }) {
  return <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-900">{title}</p><p className="mt-0.5 text-sm leading-relaxed text-slate-600">{description}</p>{nextStep && <p className="mt-2 text-xs font-semibold text-emerald-800">Next: {nextStep}</p>}</div>
      {help && <HelpTip label={`Help for ${title}`}>{help}</HelpTip>}
    </div>
  </div>
}
