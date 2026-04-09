/**
 * P3-11: Badge component for status and category labels
 * Provides consistent styling for tags and badges
 */
export function Badge({ children, variant = 'default', size = 'md', className = '' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-800',
    primary: 'bg-blue-100 text-blue-800',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-sky-100 text-sky-800'
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base'
  }

  return (
    <span className={`inline-block font-medium rounded-full ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  )
}

/**
 * Removable tag
 */
export function Tag({ children, onRemove, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    primary: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
    success: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
    warning: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
    danger: 'bg-red-100 text-red-800 hover:bg-red-200'
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-full transition-colors ${variants[variant]}`}>
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 hover:opacity-70"
          title="Remove"
        >
          ✕
        </button>
      )}
    </div>
  )
}
