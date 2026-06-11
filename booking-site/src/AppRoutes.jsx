import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'

const LodgePage = lazy(() => import('./pages/LodgePage.jsx'))
const BookingPage = lazy(() => import('./pages/BookingPage.jsx'))
const SuccessPage = lazy(() => import('./pages/SuccessPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--muted)] shadow-sm">
        Loading page…
      </div>
    </div>
  )
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        {/* Lodge home: browse rooms and pick dates */}
        <Route path="/:slug" element={<LodgePage />} />

        {/* Booking form: guest details for a specific room */}
        <Route path="/:slug/book" element={<BookingPage />} />

        {/* Success: booking reference confirmation */}
        <Route path="/:slug/success" element={<SuccessPage />} />

        {/* Root — nothing to show without a slug */}
        <Route path="/" element={<NotFoundPage />} />

        {/* Catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
