export default function EmptyState({ icon: Icon, title, message, action, secondary, embedded = false }) {
  return (
    <div className={`${embedded ? 'px-2 py-5' : 'rounded-2xl border border-gray-800 bg-gray-900 px-4 py-6'} text-center`}>
      {Icon && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-800 text-green-300">
          <Icon size={22} />
        </div>
      )}
      <p className="text-sm font-semibold text-white">{title}</p>
      {message && <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">{message}</p>}
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
