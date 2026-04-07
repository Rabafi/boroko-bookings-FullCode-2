export default function LodgeHeader({ lodge }) {
  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
        {lodge.logo ? (
          <img
            src={lodge.logo}
            alt={lodge.lodge_name}
            className="h-12 w-12 object-contain rounded-lg"
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-amber-100 flex items-center justify-center">
            <span className="text-amber-700 font-bold text-xl">
              {(lodge.lodge_name || '?')[0].toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-stone-900 leading-tight">
            {lodge.lodge_name}
          </h1>
          {(lodge.city || lodge.country) && (
            <p className="text-sm text-stone-500">
              {[lodge.city, lodge.country].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>
    </header>
  )
}
