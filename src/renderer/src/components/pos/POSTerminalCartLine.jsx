import { memo } from 'react'

const POS_MOD_COMPACT_THRESHOLD = 20

const POSTerminalCartLine = memo(function POSTerminalCartLine({
  item,
  idx,
  currency,
  fmt,
  touchMode,
  qtyButtonClass,
  qtyButtonPlusClass,
  isSelected,
  totalLines,
  onIncrement,
  onDecrement,
  onSetQty,
  onOpenModifiers,
  onSelect
}) {
  const isCompact = totalLines >= POS_MOD_COMPACT_THRESHOLD
  const modifierNames = (item.modifiers || []).map((m) => m.name).filter(Boolean)
  const hasNotes = Boolean(item.item_notes)
  const hasModifiers = modifierNames.length > 0 || hasNotes

  return (
    <div
      onClick={() => onSelect(idx)}
      className={`rounded-xl border bg-white transition-colors cursor-pointer ${
        isSelected ? 'border-blue-300 ring-1 ring-blue-200 bg-blue-50/30' : 'border-slate-100'
      } ${isCompact ? 'px-2 py-1' : touchMode ? 'p-2.5' : 'p-1.5'}`}
    >
      <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] ${isCompact ? 'gap-1.5' : 'gap-2'}`}>
        <span className={`flex items-center justify-center ${isCompact ? 'w-5 text-[10px]' : 'w-6 text-xs'} font-bold text-slate-400 shrink-0`}>
          {idx + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`truncate text-slate-800 ${isCompact ? 'text-xs' : touchMode ? 'text-[15px] font-medium' : 'text-sm'}`}>{item.item_name}</p>
          <p className={`${isCompact ? 'text-[10px]' : touchMode ? 'text-xs' : 'text-xs'} text-slate-400`}>{currency} {fmt(item.unit_price)} ea</p>
          {hasModifiers && (
            <div className={`mt-0.5 flex flex-wrap gap-1 ${isCompact ? 'max-h-4 overflow-hidden' : ''}`}>
              {modifierNames.slice(0, isCompact ? 2 : undefined).map((name) => (
                <span key={name} className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{name}</span>
              ))}
              {modifierNames.length > (isCompact ? 2 : 0) && (
                <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  +{modifierNames.length - (isCompact ? 2 : 0)}
                </span>
              )}
              {hasNotes && (
                <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 max-w-[100px] truncate" title={item.item_notes}>
                  {isCompact ? item.item_notes.slice(0, 12) + (item.item_notes.length > 12 ? '...' : '') : `📝 ${item.item_notes}`}
                </span>
              )}
            </div>
          )}
        </div>
        <span className={`${isCompact ? 'text-xs' : touchMode ? 'text-sm' : 'text-xs'} shrink-0 text-right font-semibold text-slate-800`}>
          {currency} {fmt(item.quantity * item.unit_price)}
        </span>
      </div>
      <div className={`mt-1 flex items-center justify-between ${isCompact ? 'gap-1' : touchMode ? 'gap-1.5' : 'gap-1'}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenModifiers(idx) }}
          className={isCompact
            ? 'rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-200'
            : 'rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200'}
        >
          {hasModifiers ? 'Mods' : 'Mod'}
        </button>
        <div className={`flex items-center ${touchMode ? 'gap-1.5' : 'gap-1'}`}>
          <button
            onClick={(e) => { e.stopPropagation(); onDecrement(idx) }}
            className={touchMode ? qtyButtonClass : 'flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600'}
          >−</button>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={item.quantity}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetQty(idx, e.target.value)}
            className={`input px-2 text-center font-medium ${isCompact ? 'w-10 py-0.5 text-[11px]' : touchMode ? 'w-14 py-1.5 text-sm' : 'w-12 py-1 text-xs'}`}
            aria-label={`Quantity for ${item.item_name}`}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onIncrement(idx) }}
            className={touchMode ? qtyButtonPlusClass : 'flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-sm font-bold text-slate-600 hover:bg-green-50 hover:text-green-600'}
          >+</button>
        </div>
      </div>
    </div>
  )
})

export default POSTerminalCartLine
