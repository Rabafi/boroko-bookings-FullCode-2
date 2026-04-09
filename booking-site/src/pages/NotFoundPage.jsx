export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="surface-card max-w-md rounded-[32px] p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-soft)] text-3xl">🏕️</div>
        <h1 className="font-display text-3xl text-[var(--text)]">Booking page not found</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          The booking link you opened does not exist or is no longer active. Please check the link or contact the property directly.
        </p>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Reservation page
        </p>
      </div>
    </div>
  )
}
