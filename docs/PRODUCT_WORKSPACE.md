# Tsa Bonno HospitalityOS Product Workspace

This repository is the single Tsa Bonno HospitalityOS workspace. It owns one shared Supabase migration history and several customer-facing product boundaries.

## Products

| Folder | Product | Customer experience | Current implementation state |
|---|---|---|---|
| `apps/lodge-camp` | Tsa Bonno LodgingOS | Accommodation-first desktop application | Existing product, staged for physical extraction from the shared desktop foundation |
| `apps/hotel` | Tsa Bonno HotelOS | Separate hotel-grade PMS application | Hotel product package; legacy Enterprise entitlement key retained internally |
| `apps/hospitality-pos` | Tsa Bonno Restaurant & Bar POS | Restaurant + Bar or Bar Only configuration | Restaurant-only capability, staged for physical extraction |

Each product folder is a runnable npm workspace with its own Electron packaging identity. The runtime source is intentionally shared rather than copied: physical installer separation must not fork the financial, inventory, offline, or Supabase contract.

## Run and package a product

Run one product in development:

```powershell
npm run dev:lodging
npm run dev:hotel
npm run dev:restaurant-bar
```

These explicit launch commands are preferred because each one passes a fixed product identity into the fail-closed Electron launcher. A missing or invalid product identity stops with an error; it cannot silently fall back to LodgingOS.

Build or create an installer for one product:

```powershell
npm run build --workspace=@tsa-bonno/hotel-os
npm run dist --workspace=@tsa-bonno/restaurant-bar-pos
```

LodgingOS deliberately retains the former application's Windows application ID, updater feed, and user-data directory as compatibility identities. Its customer-facing installer name is Tsa Bonno LodgingOS, and upgrades update existing customer installations in place. HotelOS and Restaurant & Bar POS have distinct identities, which prevents either from overwriting a LodgingOS installation.

Each product has its own public GitHub Releases update feed. This is required because the Windows updater reads a single `latest.yml` feed and must never receive another product's installer:

| Product | Update feed |
|---|---|
| Tsa Bonno LodgingOS (existing customers) | `Rabafi/boroko-bookings-releases` |
| Tsa Bonno HotelOS | `Rabafi/boroko-hotel-releases` |
| Tsa Bonno Restaurant & Bar POS | `Rabafi/boroko-hospitality-pos-releases` |

Use `npm run dist:publish --workspace=@tsa-bonno/lodging-os` to update live LodgingOS customers. HotelOS and Restaurant & Bar POS publish only through their own workspace commands. The root `release:*` scripts remain an equivalent legacy-compatible LodgingOS release path. Public updater repositories retain their compatibility slugs, but the private workspace package scope is `@tsa-bonno/*`.

## Shared backend rule

`supabase/` stays at the repository root. Every migration, RLS policy, RPC, audit rule, idempotency rule, and deployment check remains central. A future product must never create a second local financial truth just to become a separate installer.

## Extraction order

1. Preserve and test the shared desktop foundation.
2. Build each product through its own workspace and installer identity.
3. Complete product-specific onboarding copy and feature constraints.
4. Move reusable UI, offline, POS, and configuration code into `packages/` only after two products actually consume it.

The local-only `bar-pos/` prototype was removed. Tsa Bonno Restaurant & Bar POS is built only from the shared, authoritative POS, stock, refund, cash-up, audit, and offline-replay contracts.
