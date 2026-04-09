import { InboxIcon, Search } from 'lucide-react'

/**
 * P3-4: Empty state component for consistent messaging
 * Shows when there's no data to display
 */
export function EmptyState({
  icon: Icon = InboxIcon,
  title = 'Nothing here yet',
  description = 'Try adjusting your filters or search criteria',
  action,
  actionLabel = 'Create New'
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <Icon className="w-12 h-12 text-slate-300 mb-4" />
      <h3 className="text-lg font-semibold text-slate-700 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 mb-6 text-center max-w-sm">{description}</p>
      {action && (
        <button
          onClick={action}
          className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/**
 * Search empty state - when search yields no results
 */
export function SearchEmptyState({ query, onClear }) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={`No results for "${query}". Try a different search.`}
      action={onClear}
      actionLabel="Clear Search"
    />
  )
}
