/**
 * P3-6: Loading and skeleton state components
 * Provides consistent loading feedback
 */

/**
 * Skeleton loader - placeholder for content
 */
export function SkeletonLoader({ width = 'w-full', height = 'h-4', rounded = 'rounded' }) {
  return (
    <div className={`${width} ${height} ${rounded} bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse`} />
  )
}

/**
 * Table skeleton - placeholder rows
 */
export function TableSkeleton({ rows = 5, columns = 4 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 bg-slate-50 rounded-lg">
          {Array.from({ length: columns }).map((_, j) => (
            <SkeletonLoader key={j} width={j === 0 ? 'w-24' : 'flex-1'} height="h-4" />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Card skeleton - placeholder for a card
 */
export function CardSkeleton() {
  return (
    <div className="p-4 bg-white rounded-lg border border-slate-200 space-y-4">
      <SkeletonLoader height="h-6" width="w-1/3" />
      <SkeletonLoader height="h-4" width="w-full" />
      <SkeletonLoader height="h-4" width="w-5/6" />
      <SkeletonLoader height="h-10" width="w-1/2" rounded="rounded-lg" />
    </div>
  )
}

/**
 * Loading spinner
 */
export function LoadingSpinner({ size = 'md', message = 'Loading...' }) {
  const sizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  }

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className={`${sizes[size]} animate-spin rounded-full border-2 border-slate-300 border-t-blue-600`} />
      {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
    </div>
  )
}

/**
 * Full-page loader
 */
export function PageLoader({ message = 'Loading workspace...' }) {
  return (
    <div className="flex min-h-[400px] h-full items-center justify-center p-6">
      <div className="bb-card flex min-w-[220px] flex-col items-center gap-4 px-8 py-7 text-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Loading workspace</p>
          <p className="mt-1 text-xs text-slate-500">{message}</p>
        </div>
      </div>
    </div>
  )
}
