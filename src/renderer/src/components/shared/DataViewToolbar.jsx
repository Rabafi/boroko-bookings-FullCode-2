// @ts-check
import { Columns3, Rows3, SlidersHorizontal } from 'lucide-react'

/**
 * @param {{
 *   title?: string;
 *   subtitle?: string;
 *   density?: 'compact' | 'comfortable';
 *   onDensityChange?: (density: 'compact' | 'comfortable') => void;
 *   views?: Array<{ value: string; label: string }>;
 *   activeView?: string;
 *   onViewChange?: (value: string) => void;
 *   rightSlot?: import('react').ReactNode;
 * }} props
 */
export function DataViewToolbar({
  title,
  subtitle,
  density = 'comfortable',
  onDensityChange,
  views = [],
  activeView,
  onViewChange,
  rightSlot
}) {
  return (
    <div className="bb-data-toolbar">
      <div className="min-w-0">
        {title && <h2 className="bb-section-title">{title}</h2>}
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {views.length > 0 && (
          <div className="bb-segmented-control" aria-label="Saved views">
            {views.map((view) => (
              <button
                key={view.value}
                type="button"
                onClick={() => onViewChange?.(view.value)}
                className={activeView === view.value ? 'is-active' : ''}
              >
                {view.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => onDensityChange?.(density === 'compact' ? 'comfortable' : 'compact')} className="bb-toolbar-button">
          <Rows3 size={15} />
          {density === 'compact' ? 'Compact' : 'Comfort'}
        </button>
        <button type="button" className="bb-toolbar-button" title="Column presets are visual-only in this pass">
          <Columns3 size={15} />
          Columns
        </button>
        <button type="button" className="bb-toolbar-button" title="Filters">
          <SlidersHorizontal size={15} />
          Filters
        </button>
        {rightSlot}
      </div>
    </div>
  )
}
