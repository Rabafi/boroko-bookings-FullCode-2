# Boroko Bar POS

A simple, offline-first point of sale for bars, pubs, and shebeens in Botswana.

## Features

- **Quick Sell Terminal** — categories for beers, spirits, cocktails, shots. Two taps to sell.
- **Payment Methods** — cash, card, Orange Money, MyZaka, SMEGA, bank transfer
- **Stock Tracking** — auto-deduct on sale, low-stock alerts, reorder levels
- **Staff Clock-In/Out** — track who worked when
- **Cash Up** — float, expected vs counted, variance calculated automatically
- **Fully Offline** — no internet connection needed. All data stored locally.

## Development

```bash
npm install
npm run dev      # dev mode with hot reload
npm run build    # production build
npm run dist     # build + package installer
```

## Default login

- Email: `admin@bar.local` / Password: `admin`
- Email: `cashier@bar.local` / Password: `cashier`

## Tech stack

- Electron 28
- React 18
- Tailwind CSS
- Local JSONL storage (no database server required)
