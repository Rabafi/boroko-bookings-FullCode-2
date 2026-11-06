/** @param {{ compact?: boolean, children?: import('react').ReactNode, productFamily?: string|null, hospitalityMode?: unknown }} props */
export default function MobileBoundaryNotice({ compact = false, children, productFamily = null, hospitalityMode = null }) {
  const barOnly = productFamily === 'hospitality_pos' && String(hospitalityMode || '').toLowerCase() === 'bar_only'
  const defaultCopy = barOnly
    ? 'Review the latest verified Bar records here. Trading changes are made on the Bar computer.'
    : productFamily === 'hospitality_pos'
      ? 'Managers can review details and send requests here. The restaurant team completes record changes in the desktop app.'
      : 'Managers can review details and send requests here. Front desk completes record changes on desktop.'
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900/65 ${compact ? 'px-3 py-2' : 'px-3 py-3'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">View and request</p>
          <p className={`${compact ? 'mt-0.5 text-xs' : 'mt-1 text-sm'} text-gray-400`}>
            {children || defaultCopy}
          </p>
        </div>
      </div>
    </div>
  )
}
