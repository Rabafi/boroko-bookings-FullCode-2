import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LodgePage from './pages/LodgePage.jsx'
import BookingPage from './pages/BookingPage.jsx'
import SuccessPage from './pages/SuccessPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  )
}
