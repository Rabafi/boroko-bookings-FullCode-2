# Boroko Manager PWA

The Manager PWA is the mobile operations surface for lodge managers and admins. It provides dashboards, bookings visibility, alerts, reports, POS reporting, maintenance, inventory, expenses, day-use, conference, quotation, guest intelligence, audit visibility, and support inbox workflows.

## Local Checks

Run from the repository root:

- `npm run manager:install`
- `npm run manager:lint`
- `npm run manager:build`

Or run inside this folder:

- `npm ci`
- `npm run lint`
- `npm run build`

## Production Notes

- The app uses Supabase Auth plus Boroko app-session validation.
- The PWA is not globally read-only. Approved operational changes use Supabase RPCs and capability checks.
- High-risk payment, refund, customer-credit allocation, booking-reschedule, and similar financial actions remain desktop-only unless a dedicated server-authorized PWA contract explicitly permits them.
- Some approved operational actions can be queued in the PWA's device-local queue. The queue is lodge-scoped browser `localStorage`, not IndexedDB or the desktop queue.
- High-risk mutation types are blocked while offline and unresolved queue items are surfaced after repeated failures. Pending local state is not authoritative financial state.
- Offline queue health shown in the PWA is device-local only. It does not replace the desktop System Health panel.
- Keep service-role keys out of this app. It must use only public browser-safe environment values.

## Release Checklist

- Lint and build pass.
- Login works for an enabled manager user.
- Dashboard, rooms, bookings, reports, alerts, money, quotations, invoices, expenses, audit, guests, staff, conference, day-use, inventory, POS reporting, inbox/control, and more screens load without console errors for authorized users.
- The service worker cache is refreshed after deploy.
- The production site points at the intended Supabase project.
