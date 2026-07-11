# Boroko Product Workspace

This repository is the single Boroko platform workspace. It owns one shared Supabase migration history and several customer-facing product boundaries.

## Products

| Folder | Product | Customer experience | Current implementation state |
|---|---|---|---|
| `apps/lodge-camp` | Boroko Lodge & Camp | Accommodation-first desktop application | Existing product, staged for physical extraction from the shared desktop foundation |
| `apps/hotel` | Boroko Hotel | Hotel-grade PMS application | Enterprise hotel capability, staged for physical extraction |
| `apps/hospitality-pos` | Boroko Restaurant & Bar POS | Restaurant + Bar or Bar Only configuration | Restaurant-only capability, staged for physical extraction |

Each product folder is a runnable npm workspace with its own Electron packaging identity. The runtime source is intentionally shared rather than copied: physical installer separation must not fork the financial, inventory, offline, or Supabase contract.

## Run and package a product

Run one product in development:

```powershell
npm run dev --workspace=@boroko/lodge-camp
npm run dev --workspace=@boroko/hotel
npm run dev --workspace=@boroko/hospitality-pos
```

Build or create an installer for one product:

```powershell
npm run build --workspace=@boroko/hotel
npm run dist --workspace=@boroko/hospitality-pos
```

Each product has a distinct Windows application ID, display name, shortcut name, installer artifact name, and user-data directory. This prevents a Hotel installer from overwriting a Lodge & Camp installation.

All three products publish release assets to the shared `Rabafi/boroko-bookings-releases` GitHub Releases repository. Use `npm run dist:publish --workspace=@boroko/<product>` only for an intentional versioned release; it creates or updates a public GitHub Release.

## Shared backend rule

`supabase/` stays at the repository root. Every migration, RLS policy, RPC, audit rule, idempotency rule, and deployment check remains central. A future product must never create a second local financial truth just to become a separate installer.

## Extraction order

1. Preserve and test the shared desktop foundation.
2. Build each product through its own workspace and installer identity.
3. Complete product-specific onboarding copy and feature constraints.
4. Move reusable UI, offline, POS, and configuration code into `packages/` only after two products actually consume it.

The local-only `bar-pos/` prototype was removed. Boroko Restaurant & Bar POS is built only from the shared, authoritative POS, stock, refund, cash-up, audit, and offline-replay contracts.
