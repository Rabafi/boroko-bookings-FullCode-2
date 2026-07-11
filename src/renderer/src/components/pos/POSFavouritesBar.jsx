import { memo } from 'react'
import { Star } from 'lucide-react'

const POSFavouritesBar = memo(function POSFavouritesBar({
  favouriteItems,
  currency,
  fmt,
  touchMode,
  getCrossOutletName,
  getInventoryAvailableUnits,
  inventoryById,
  isOrderableMenuItem,
  onAdd,
  onToggleFavourite
}) {
  if (favouriteItems.length === 0) return null

  return (
    <div className="bb-card p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-amber-600">
          <Star size={13} className="fill-amber-400 text-amber-400" /> Favourites
        </h3>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
          {favouriteItems.length} pinned
        </span>
      </div>
      <div className={`flex gap-2 overflow-x-auto pb-1 ${touchMode ? 'min-h-[5.5rem]' : 'min-h-[4.5rem]'}`}>
        {favouriteItems.map((item) => {
          const crossOutlet = getCrossOutletName(item)
          const availableUnits = getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty)
          const soldOut = !isOrderableMenuItem(item, inventoryById)
          return (
            <div
              key={`fav-${item.id}`}
              className={`relative shrink-0 ${touchMode ? 'min-w-[6rem]' : 'min-w-[5rem]'} rounded-xl border border-amber-100 bg-amber-50/60 p-2 transition-all ${soldOut ? 'cursor-not-allowed opacity-50' : 'hover:border-amber-300 hover:bg-amber-50'}`}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavourite(item.id) }}
                className="absolute right-1 top-1 rounded p-0.5 text-amber-400 hover:text-amber-600"
                title="Remove from favourites"
              >
                <Star size={12} className="fill-amber-400" />
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
                <p className={`truncate font-medium text-slate-800 ${touchMode ? 'text-xs' : 'text-[11px] pr-3'}`}>{item.name}</p>
                <p className={`mt-0.5 font-semibold text-green-700 ${touchMode ? 'text-xs' : 'text-[11px]'}`}>
                  {currency} {fmt(item.price)}
                </p>
                {soldOut && <p className="mt-0.5 text-[10px] text-red-500">Sold out</p>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
})

export default POSFavouritesBar
