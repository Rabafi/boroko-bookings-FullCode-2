# Boroko Manager PWA

The Manager PWA is the mobile operations surface for lodge managers and admins. It is designed for dashboard visibility, alerts, approvals, reports, maintenance, inventory checks, and light operational actions.

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
- High-risk booking, payment, quotation, conference, and financial mutations are blocked from the PWA and must be handled in the Front Desk desktop app.
- Offline queue health shown in the PWA is device-local only. It does not replace the desktop System Health panel.
- Keep service-role keys out of this app. It must use only public browser-safe environment values.

## Release Checklist

- Lint and build pass.
- Login works for an enabled manager user.
- Dashboard, alerts, bookings, money, control, and more screens load without console errors.
- The service worker cache is refreshed after deploy.
- The production site points at the intended Supabase project.
