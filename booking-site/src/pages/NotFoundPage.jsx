export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-4">🏕️</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Lodge not found</h1>
        <p className="text-stone-500 text-sm mb-6">
          The booking page you're looking for doesn't exist or is no longer active.
          Check your link or contact the property directly.
        </p>
        <p className="text-xs text-stone-400">Powered by Boroko Bookings</p>
      </div>
    </div>
  )
}
