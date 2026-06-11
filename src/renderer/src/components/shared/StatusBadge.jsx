export function StatusBadge({ status }) {
  const styles = {
    confirmed: 'border-blue-200 bg-blue-50 text-blue-700',
    checked_in: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    checked_out: 'border-slate-200 bg-slate-100 text-slate-600',
    cancelled: 'border-red-200 bg-red-50 text-red-700',
    available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    occupied: 'border-orange-200 bg-orange-50 text-orange-700',
    maintenance: 'border-amber-200 bg-amber-50 text-amber-700',
    reserved: 'border-indigo-200 bg-indigo-50 text-indigo-700'
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize tracking-[0.01em] ${
        styles[status] || 'border-slate-200 bg-slate-100 text-slate-600'
      }`}
    >
      {status?.replace(/_/g, ' ')}
    </span>
  )
}
