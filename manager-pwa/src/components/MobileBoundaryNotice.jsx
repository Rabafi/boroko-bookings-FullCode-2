export default function MobileBoundaryNotice({ compact = false, children }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900/65 ${compact ? 'px-3 py-2' : 'px-3 py-3'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">View and request</p>
          <p className={`${compact ? 'mt-0.5 text-xs' : 'mt-1 text-sm'} text-gray-400`}>
            {children || 'Managers can review details and send requests here. Front desk completes record changes on desktop.'}
          </p>
        </div>
      </div>
    </div>
  )
}
