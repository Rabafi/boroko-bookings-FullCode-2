import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppRoutes from '../AppRoutes.jsx'

vi.mock('../pages/LodgePage.jsx', () => ({
  default: () => <div data-testid="lodge-page">LodgePage</div>
}))

vi.mock('../pages/BookingPage.jsx', () => ({
  default: () => <div data-testid="booking-page">BookingPage</div>
}))

vi.mock('../pages/SuccessPage.jsx', () => ({
  default: () => <div data-testid="success-page">SuccessPage</div>
}))

vi.mock('../pages/NotFoundPage.jsx', () => ({
  default: () => <div data-testid="not-found-page">NotFoundPage</div>
}))

describe('App routing', () => {
  it('renders LodgePage for /:slug', async () => {
    render(
      <MemoryRouter initialEntries={['/my-lodge']}>
        <AppRoutes />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('lodge-page')).toBeInTheDocument())
  })

  it('renders BookingPage for /:slug/book', async () => {
    render(
      <MemoryRouter initialEntries={['/my-lodge/book']}>
        <AppRoutes />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('booking-page')).toBeInTheDocument())
  })

  it('renders SuccessPage for /:slug/success', async () => {
    render(
      <MemoryRouter initialEntries={['/my-lodge/success']}>
        <AppRoutes />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('success-page')).toBeInTheDocument())
  })

  it('renders NotFoundPage for /', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('not-found-page')).toBeInTheDocument())
  })

  it('renders NotFoundPage for unknown routes', async () => {
    render(
      <MemoryRouter initialEntries={['/unknown/route']}>
        <AppRoutes />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('not-found-page')).toBeInTheDocument())
  })
})
