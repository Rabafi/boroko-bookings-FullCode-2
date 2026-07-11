import { memo } from 'react'
import { Star, Scan, Flame, Leaf, Clock } from 'lucide-react'

const POSTerminalProductCard = memo(function POSTerminalProductCard({
  item,
  currency,
  fmt,
  touchMode,
  touchItemCardClass,
  soldOut,
  crossOutlet,
  availableUnits,
  isFav,
  isPopular,
  dietaryFlags,
  prepTime,
  onAdd,
  onToggleFavourite
}) {
  return (
    <div
      className={`${touchItemCardClass} relative ${soldOut ? 'cursor-not-allowed opacity-60' : touchMode ? 'hover:ring-2 hover:ring-green-300' : 'hover:-translate-y-[1px] hover:ring-2 hover:ring-green-400'}`}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleFavourite(item.id) }}
        className={`absolute ${touchMode ? 'right-1.5 top-1.5' : 'right-1 top-1'} rounded p-0.5 transition-colors ${isFav ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-amber-400'}`}
        title={isFav ? 'Remove from favourites' : 'Add to favourites'}
      >
        <Star size={touchMode ? 14 : 12} className={isFav ? 'fill-amber-400' : ''} />
      </button>
      <button
        type="button"
        disabled={soldOut || !!crossOutlet}
        onClick={() => {
          if (crossOutlet) { alert(`"${item.name}" belongs to ${crossOutlet}. Switch outlets to add it.`); return }
          if (soldOut) { alert(`"${item.name}" is sold out on the latest synced stock.`); return }
          onAdd(item)
        }}
        className="block w-full text-left"
      >
        <p className={`truncate font-medium text-slate-800 ${touchMode ? 'text-sm' : 'text-xs'}`}>{item.name}</p>
        <p className={`mt-0.5 text-green-700 font-semibold ${touchMode ? 'text-sm' : 'text-xs'}`}>
          {currency} {fmt(item.price)}
        </p>
      </button>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {isPopular && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
            <Flame size={9} className="fill-orange-400" /> Popular
          </span>
        )}
        {dietaryFlags.includes('vegetarian') && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700">
            <Leaf size={9} /> V
          </span>
        )}
        {dietaryFlags.includes('vegan') && (
          <span className="inline-flex items-center rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold text-teal-700">
            VG
          </span>
        )}
        {dietaryFlags.includes('gluten-free') && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
            GF
          </span>
        )}
        {prepTime > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-400">
            <Clock size={8} /> {prepTime}m
          </span>
        )}
      </div>
      {Number.isFinite(availableUnits) && (
        <p className={`mt-0.5 ${touchMode ? 'text-xs' : 'text-[11px]'} ${soldOut ? 'text-red-600' : availableUnits <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
          {soldOut ? 'Sold out' : `${availableUnits} left`}
        </p>
      )}
      {item.barcode && !touchMode && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
          <Scan size={10} /> {item.barcode}
        </p>
      )}
    </div>
  )
})

export default POSTerminalProductCard
