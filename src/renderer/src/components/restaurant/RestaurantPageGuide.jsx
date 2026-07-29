import { ArrowRight, HelpCircle } from 'lucide-react'

export function HelpTip({ label, children }) {
  return <span className="group relative inline-flex align-middle" tabIndex="0" aria-label={label}>
    <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#c9aa97]/70 bg-white/50 text-[#76505b] transition group-hover:border-[#b9784f] group-hover:bg-white group-hover:text-[#9d4c34] group-focus-within:ring-4 group-focus-within:ring-[#d88b50]/20">
      <HelpCircle size={16} />
    </span>
    <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 rounded-xl bg-[#2f2129] px-3 py-2.5 text-xs font-normal leading-relaxed text-white shadow-xl group-hover:block group-focus-within:block">{children}</span>
  </span>
}

export default function RestaurantPageGuide({ title, description, nextStep, help }) {
  return <aside aria-label={`${title} guidance`} className="mb-5 overflow-visible rounded-[20px] border border-[#d9c7bc] bg-[linear-gradient(105deg,rgba(255,250,244,.78),rgba(239,223,213,.82))] px-4 py-3.5 shadow-[0_10px_26px_rgba(71,42,52,.08)] backdrop-blur-sm">
    <div className="flex items-start gap-3.5">
      <div className="mt-1 h-9 w-1 shrink-0 rounded-full bg-[linear-gradient(#e89b55,#a84f38)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="text-sm font-black tracking-tight text-[#34242d]">{title}</p><p className="text-sm leading-relaxed text-[#765f68]">{description}</p></div>
        {nextStep && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-[#8f4936]"><ArrowRight size={14} aria-hidden="true" />Next move: {nextStep}</p>}
      </div>
      {help && <HelpTip label={`Help for ${title}`}>{help}</HelpTip>}
    </div>
  </aside>
}
