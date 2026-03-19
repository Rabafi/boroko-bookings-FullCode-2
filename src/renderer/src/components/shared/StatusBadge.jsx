export function StatusBadge({ status }) {
  const styles = {
    confirmed: 'bg-blue-100 text-blue-700',
    checked_in: 'bg-green-100 text-green-700',
    checked_out: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-600',
    available: 'bg-emerald-100 text-emerald-700',
    occupied: 'bg-orange-100 text-orange-700',
    maintenance: 'bg-yellow-100 text-yellow-700',
    reserved: 'bg-indigo-100 text-indigo-700'
  }
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
        styles[status] || 'bg-gray-100 text-gray-600'
      }`}
    >
      {status?.replace(/_/g, ' ')}
    </span>
  )
}
