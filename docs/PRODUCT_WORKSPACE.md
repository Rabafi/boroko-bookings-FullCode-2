# Boroko Product Workspace

This repository is the single Boroko platform workspace. It owns one shared Supabase migration history and several customer-facing product boundaries.

## Products

| Folder | Product | Customer experience | Current implementation state |
|---|---|---|---|
| `apps/lodge-camp` | Boroko Lodge & Camp | Accommodation-first desktop application | Existing product, staged for physical extraction from the shared desktop foundation |
| `apps/hotel` | Boroko Hotel | Hotel-grade PMS application | Enterprise hotel capability, staged for physical extraction |
| `apps/hospitality-pos` | Boroko Restaurant & Bar POS | Restaurant + Bar or Bar Only configuration | Restaurant-only capability, staged for physical extraction |

The folders are product and release boundaries. They are not evidence that every product has already been copied into an independent codebase.

## Shared backend rule

`supabase/` stays at the repository root. Every migration, RLS policy, RPC, audit rule, idempotency rule, and deployment check remains central. A future product must never create a second local financial truth just to become a separate installer.

## Extraction order

1. Preserve and test the shared desktop foundation.
2. Extract the Lodge & Camp entry point and release identity.
3. Extract the Hotel entry point and release identity.
4. Extract the Hospitality POS entry point and its Restaurant + Bar / Bar Only onboarding modes.
5. Move reusable UI, offline, POS, and configuration code into `packages/` only after two products actually consume it.

The local-only `bar-pos/` prototype is intentionally not a sellable product boundary. It remains a prototype until its sales, stock, refunds, permissions, cash-up, and audit flows use the same authoritative RPC contracts as the platform.
