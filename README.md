# Boroko Bookings System

A full booking management system with desktop (Electron), web dashboard (React), and backend (Supabase).

## Architecture

- Electron App → Main booking system
- React Renderer → UI layer
- Manager PWA → Admin dashboard
- Supabase → Backend & functions

## Features

- Booking management
- Admin dashboard
- Reports & analytics
- Push notifications
- Offline-ready PWA

## Project Structure

- /src → Electron + main app
- /manager-pwa → Progressive Web App
- /supabase → backend functions

## Setup

npm install  
npm run dev

## Critical Release Gate

Before shipping changes that touch offline queues, bookings, quotations, conference, day bookings, POS, or sync plumbing, this repo now requires:

- `npm run test:offline-queue-critical`
- `npm run build`

The same gate now runs automatically in GitHub Actions on every push and pull request through `.github/workflows/offline-queue-critical.yml`.

## Desktop Release Publish

Desktop releases can now be published from GitHub Actions through [publish-desktop-release.yml](</C:/Users/Botswapelo Studios/Documents/Work/Boroko Bookings/.github/workflows/publish-desktop-release.yml>).

Before using it once, add a repository secret named `BOROKO_RELEASES_TOKEN` in the code repo:

- create a GitHub personal access token with `repo` access to `Rabafi/boroko-bookings-releases`
- save it in `Settings` -> `Secrets and variables` -> `Actions`

Release flow:

1. Push the commit you want to release.
2. Confirm `Offline Queue Critical` is green for that commit.
3. Open `Actions` -> `Publish Desktop Release` -> `Run workflow`.
4. Choose `latest` or `beta`, and whether the GitHub release should stay draft.
5. The workflow will run the offline queue regression suite, build the Windows installer, and upload the `.exe`, `.blockmap`, and `.yml` assets to `Rabafi/boroko-bookings-releases`.
