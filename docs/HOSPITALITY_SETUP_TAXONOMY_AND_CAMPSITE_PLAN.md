# Hospitality Setup Taxonomy and Campsite Accommodation Plan

Last reviewed: 2026-07-08

This document defines how Boroko Bookings should simplify first-time setup into three customer-facing hospitality categories while preserving the more detailed internal property model needed for navigation, entitlements, reporting, public booking, and future Enterprise growth.

It is an implementation plan for future agents. It is not a release note and does not prove that any item is deployed.

## Executive Decision

The setup wizard should present only three primary choices:

1. **Lodges, Camps & Guesthouses**
2. **Hotels, Resorts & Motels**
3. **Restaurants**

Do not ask a new customer to choose among every internal variant such as lodge, camp, guest house, bed and breakfast, hotel, resort, motel, apartment hotel, hostel, or serviced apartments on the first screen.

The first setup choice should answer: "What operating model should Boroko start with?"

The detailed internal property type should still exist because it drives:

- default modules;
- labels and navigation;
- capacity assumptions;
- Enterprise add-on eligibility;
- public booking defaults;
- future migration-safe reporting;
- sales packaging;
- support diagnostics.

The user-facing group should be stored separately from the internal property type. Do not collapse all existing property types into only three database values.

## Current Repo Starting Point

The repository already contains useful foundations:

- `src/shared/propertyTypes.js` defines internal types including `guest_house`, `bnb`, `lodge`, `camp`, `motel`, `hotel`, `resort`, `restaurant`, `apartment_hotel`, `hostel`, and `serviced_apartments`.
- `buildOperatingProfile()` already returns an operating profile with `property_type`, `operation_style`, enabled/relevant/hidden modules, subscription plan, Enterprise add-ons, and capacity limits.
- `src/renderer/src/components/Setup.jsx` already has a property type step and operating questions.
- Public booking already supports single-room, multi-room, and full-lodge accommodation requests through the public booking flow.
- Day-use and event/venue offers can be displayed publicly but are still contact/inquiry paths unless dedicated public RPCs are opened.
- Restaurant-only mode already has a separate planning document at `docs/RESTAURANT_POS_PRODUCT_PLAN.md`.
- Enterprise hotel/resort capability is already layered through module visibility, property type, add-ons, and subscription gating.

The missing product capability for this plan is **campsite accommodation**: a camp may sell pitches/sites without room numbers or room housekeeping, and some camps sell both rooms/tents and campsites.

## Product Principle

Keep setup simple for the customer, keep the model expressive for the system.

Customer-facing category:

- simple;
- sales-friendly;
- used by first-run setup and marketing forms;
- no more than three options.

Internal property type:

- detailed;
- migration-safe;
- used by code and module gating;
- can still distinguish lodge, camp, guest house, hotel, resort, motel, restaurant, and future variants.

Operating profile:

- answers what the business actually does;
- can include accommodation mix, food and beverage, events, day visitors, online booking, corporate clients, multiple properties, campsites, rate complexity, and POS outlets;
- should be editable after setup.

## Proposed Data Model Vocabulary

### Customer-Facing Setup Groups

Add a shared catalog, preferably in `src/shared/propertyTypes.js` or a small companion file such as `src/shared/setupBusinessGroups.js`.

Recommended keys:

```js
export const SETUP_BUSINESS_GROUPS = {
  lodge_camp_guesthouse: 'lodge_camp_guesthouse',
  hotel_resort_motel: 'hotel_resort_motel',
  restaurant: 'restaurant'
}
```

Recommended labels:

```js
{
  lodge_camp_guesthouse: 'Lodges, Camps & Guesthouses',
  hotel_resort_motel: 'Hotels, Resorts & Motels',
  restaurant: 'Restaurants'
}
```

Recommended descriptions:

```js
{
  lodge_camp_guesthouse: 'Smaller accommodation businesses such as lodges, camps, guesthouses, B&Bs, Airbnbs, farm stays, chalets, cabins, self-catering units, boutique stays, backpackers, and campsites.',
  hotel_resort_motel: 'Larger room-based properties such as hotels, resorts, motels, apartment hotels, serviced apartments, larger guest properties, and multi-outlet properties with many rooms, up to the current Enterprise accommodation limit.',
  restaurant: 'POS, tables, orders, stock, staff, cash-up, expenses, and sales reporting without room-booking workflows.'
}
```

Recommended short helper text for setup cards:

```js
{
  lodge_camp_guesthouse: 'Best for smaller stays: Airbnbs, B&Bs, guesthouses, lodges, camps, cabins, chalets, and campsites.',
  hotel_resort_motel: 'Best for bigger room-based properties with many rooms, front desk workflows, room types, folios, outlets, and hotel-style operations.',
  restaurant: 'Best for food and beverage businesses that need POS, tables, orders, stock, cash-up, staff, and reports.'
}
```

Recommended hover/popover copy:

```js
{
  lodge_camp_guesthouse: 'Choose this for smaller accommodation businesses: guesthouses, Airbnbs, B&Bs, lodges, camps, farm stays, cabins, chalets, self-catering units, backpackers, tented camps, and properties with campsites. You can still enable POS, day visitors, events, full-property bookings, and public booking later.',
  hotel_resort_motel: 'Choose this for larger properties with many rooms or more formal hotel operations: hotels, resorts, motels, apartment hotels, serviced apartments, larger guest properties, and properties that need room types, folios, rate plans, housekeeping teams, multiple outlets, corporate accounts, or Enterprise PMS tools.',
  restaurant: 'Choose this when you do not sell accommodation and mainly need restaurant POS, tables, menus, orders, kitchen/bar preparation, stock, staff, cash-up, expenses, and sales reporting.'
}
```

The helper text should be visible enough that a non-technical owner understands the choice without hovering. The longer explanatory copy can live behind an info icon, tooltip, or popover, but it must also be accessible on touch devices.

### Internal Property Type Mapping

The first setup selection should set a default internal property type, but it should not prevent refinement later.

Recommended default mapping:

| Setup group | Default internal `property_type` | Optional refinement values |
|---|---|---|
| `lodge_camp_guesthouse` | `lodge` | `lodge`, `camp`, `guest_house`, `bnb` |
| `hotel_resort_motel` | `hotel` | `hotel`, `resort`, `motel`, later `apartment_hotel`, `hostel`, `serviced_apartments` |
| `restaurant` | `restaurant` | `restaurant` |

Do not show the refinement values as the first decision. If refinement is needed, ask a later lightweight question such as "Which description fits best?" after the customer has already chosen the broad group.

### Operating Profile Fields

Extend the operating profile concept with explicit answers rather than relying only on `property_type`.

Recommended fields:

```js
{
  setup_business_group: 'lodge_camp_guesthouse',
  property_type: 'camp',
  accommodation_mix: {
    rooms_or_units: true,
    campsites: true,
    whole_property_exclusive_use: false
  },
  campsite_profile: {
    enabled: true,
    has_numbered_sites: true,
    has_powered_sites: true,
    has_unpowered_sites: true,
    supports_per_person_pricing: true,
    supports_per_site_pricing: true,
    supports_vehicle_or_tent_limits: true
  },
  operations: {
    food_beverage: true,
    pos_outlets: true,
    day_visitors_pool: true,
    events_conferences: true,
    public_booking_page: true,
    room_supplies: true,
    corporate_clients: false,
    hotel_rates: false,
    room_types_feature: true,
    online_payments: false,
    multi_property_interest: false
  }
}
```

The exact shape can be adjusted, but avoid burying campsites in a generic notes field. Campsites affect availability, pricing, public booking, reporting, and offline replay.

## First-Run Setup UX

### Step 1: Choose Business Category

Replace the current long property type grid in `src/renderer/src/components/Setup.jsx` with three cards:

- Lodges, Camps & Guesthouses
- Hotels, Resorts & Motels
- Restaurants

Each card should include a short helper line and a help affordance for the longer examples. Do not rely on CSS hover only; mobile and tablet users need to be able to tap the help icon/popover.

Recommended visible helper copy:

- Lodges, Camps & Guesthouses: "Smaller stays: Airbnbs, B&Bs, guesthouses, lodges, camps, cabins, chalets, and campsites."
- Hotels, Resorts & Motels: "Bigger room-based properties with many rooms, front desk workflows, room types, folios, outlets, and hotel-style operations."
- Restaurants: "Food and beverage businesses that need POS, tables, orders, stock, cash-up, staff, and reports."

Each card should set:

- `form.setup_business_group`;
- a default `form.property_type`;
- `form.business_type` for existing compatibility.

Suggested compatibility:

- `lodge_camp_guesthouse` -> `business_type: 'lodge'`, `property_type: 'lodge'`
- `hotel_resort_motel` -> `business_type: 'lodge'`, `property_type: 'hotel'`
- `restaurant` -> `business_type: 'restaurant'`, `property_type: 'restaurant'`

Do not rename every lodge concept in the database in this phase. The existing schema uses `lodge_id` as the tenant/property anchor. Treat "lodge" in schema names as legacy tenant terminology, not customer-facing copy.

### Step 2: Focused Operating Questions

The operating questions should branch by setup group.

For **Lodges, Camps & Guesthouses**, ask:

- Do you offer rooms, chalets, tents, or units?
- Do you offer campsites?
- Do you offer both accommodation units and campsites?
- Do you accept day visitors, pool access, or activities?
- Do you sell food, drinks, or shop items?
- Do you host events, retreats, conferences, or full-property bookings?
- Do you want guests to request bookings online?

For **Hotels, Resorts & Motels**, ask:

- Do you need room types and rate plans?
- Do you use folios or room charges?
- Do you have more than one outlet, such as restaurant, bar, spa, shop, or activity desk?
- Do you serve corporate accounts or group bookings?
- Do you need channel manager/OTA readiness?
- Do you need online payments?
- Do you manage more than one property?

For **Restaurants**, ask:

- Do you use tables?
- Do you need takeaway or delivery tracking?
- Do you need kitchen/bar preparation views?
- Do you track stock or recipes?
- Do you manage cash drawers and shifts?
- Do you have more than one outlet?

Do not show hotel-only questions to restaurant-only customers. Do not show restaurant-only language to lodges unless they said they sell food/drinks.

### Step 3: Optional Refinement

For `lodge_camp_guesthouse`, a simple refinement may be useful:

- Lodge
- Camp
- Guesthouse / B&B
- Airbnb / short-stay unit
- Self-catering units / chalets / cabins
- Backpackers / hostel-style small property
- Not sure, use recommended defaults

For `hotel_resort_motel`:

- Hotel
- Resort
- Motel
- Apartment hotel / serviced apartments
- Larger guest property
- Not sure, use recommended defaults

This refinement should be optional and low pressure. If the user skips it, keep the default internal type selected by the setup group.

## Campsite Accommodation Model

### Why Campsites Need First-Class Support

Campsites are not always rooms:

- one campsite can hold several people;
- pricing may be per site, per person, per tent, per vehicle, or a combination;
- occupancy is capacity-based, not always one booking per physical room;
- sites may be powered/unpowered;
- bathroom/facility access may matter;
- housekeeping may not apply, but cleaning/maintenance can still apply;
- public booking should say "campsites", not "rooms";
- reports should not mix campsite nights with room nights without labels.

Trying to fake campsites as rooms is acceptable only as a temporary compatibility bridge. The long-term model should represent them explicitly.

### Minimal Phase 1 Approach

Implement campsites with the smallest safe addition:

1. Add an `accommodation_kind` field to room-like inventory:
   - `room`
   - `unit`
   - `tent`
   - `campsite`

2. Keep using the existing `rooms` table initially, but allow campsite-specific fields:
   - `accommodation_kind`
   - `capacity_adults`
   - `capacity_children`
   - `max_tents`
   - `max_vehicles`
   - `is_powered`
   - `site_surface`
   - `shared_facilities`

3. Update UI copy so campsite inventory appears as "Sites" or "Accommodation" where appropriate, not always "Rooms".

4. Update public booking to show campsite cards separately from room cards when a property has campsite offers enabled.

5. Preserve existing booking conflict behavior by treating one campsite record like one reservable unit for Phase 1.

This gives camps a working booking path without creating a full capacity-allocation engine immediately.

### Phase 2 Campsite Capacity Engine

If the product needs true campsite capacity later, add a separate campsite inventory model:

- `campsite_areas`
- `campsites`
- `campsite_rate_plans`
- `campsite_bookings` or a generalized `accommodation_allocations`

Only do this after Phase 1 proves the demand. A separate capacity engine has more blast radius because it touches availability, public booking, invoices, reports, offline replay, and conflict checks.

### Recommended Phase 1 Database Migration

Create a migration such as:

```text
supabase/migrations/YYYYMMDDHHMMSS_accommodation_kind_and_campsite_fields.sql
```

Recommended changes:

- add `rooms.accommodation_kind text not null default 'room'`;
- add a check constraint for allowed values;
- add campsite capacity columns with safe null defaults;
- add indexes on `(lodge_id, accommodation_kind, status)` and any public availability query path;
- update `create_room` and `update_room` RPCs to accept the fields;
- validate `accommodation_kind` server-side;
- keep old clients working when they do not send `accommodation_kind`;
- ensure plan room limits count campsite records intentionally, or introduce a neutral "reservable units" usage label.

Important: if plan limits remain named "rooms" in subscription code, decide whether campsites count against that limit. The product recommendation is to count them as accommodation inventory for now, but display it as "rooms/sites" or "accommodation units" for camp properties.

### Public Booking Changes

Update booking site surfaces:

- `booking-site/src/pages/LodgePage.jsx`
- `booking-site/src/pages/BookingPage.jsx`
- `booking-site/src/pages/SuccessPage.jsx`
- any `GuestBookingView`/guest portal components if they display accommodation labels.

Required behavior:

- if the offer includes only rooms, current copy remains room/stay focused;
- if it includes only campsites, use "campsites" and "site" copy;
- if it includes both, separate "Rooms & Units" from "Campsites";
- submit campsite selection through the same server-validated public booking RPC where possible;
- never trust public-site calculated availability or price;
- keep multi-selection and group invoice behavior compatible if several sites/units are requested together.

The public booking RPC must validate:

- selected site belongs to the property;
- selected site has `accommodation_kind = 'campsite'` when campsite-specific flow is used;
- date overlap rules;
- capacity rules;
- server-side price;
- idempotency for repeat submission.

### Desktop Changes

Update these likely targets:

- `src/renderer/src/components/Setup.jsx`
- `src/shared/propertyTypes.js`
- `src/shared/moduleCatalog.js`
- `src/main/domains/settings.js`
- `src/main/domains/rooms.js`
- `src/renderer/src/components/Rooms.jsx`
- `src/renderer/src/components/Bookings.jsx`
- `src/renderer/src/components/Quotations.jsx`
- `src/main/domains/bookings.js`
- `src/main/domains/sync/` or wherever queued `create_room`, `update_room`, and booking operations are allowlisted
- tests under `tests/`

Required desktop behavior:

- setup saves the three-option group and detailed operating profile;
- room setup can create "Room / Unit / Tent / Campsite" inventory;
- booking flow can select a campsite as accommodation;
- invoices/receipts label campsites clearly;
- availability and conflict checks still go through server RPCs;
- offline queue preserves the same RPC name, payload, and stable idempotency key;
- offline campsite bookings stay pending estimates until replay succeeds.

### Manager PWA Changes

The Manager PWA should not need full campsite setup in the first phase, but it should not display confusing labels.

Likely targets:

- `manager-pwa/src/lib/api.js`
- `manager-pwa/src/pages/Dashboard.jsx`
- `manager-pwa/src/pages/Reports.jsx`
- any room/booking display component.

Required behavior:

- dashboards label accommodation units appropriately for camp properties;
- booking detail can display campsite/site instead of room;
- reporting does not silently merge room nights and site nights without a visible label;
- no high-risk financial mutation is added to the PWA just because campsites are introduced.

### Legacy POS Impact

Legacy POS should usually be unaffected by campsite booking inventory. Still verify:

- booking-linked room charges do not assume every accommodation label is a room;
- folio/booking charge displays can tolerate campsite bookings;
- POS catalog snapshots are not touched unless restaurant/POS setup changes are introduced.

Do not make Legacy POS depend on new campsite tables unless there is a direct POS requirement.

## Hotel, Resort, and Motel Requirements

Hotels, resorts, and motels should share the second setup group because they mostly need the same PMS foundation:

- front desk;
- room types;
- physical rooms;
- rates;
- folios;
- housekeeping;
- maintenance;
- booking payments;
- reports;
- staff roles;
- public booking;
- guest messages;
- optional online payments;
- optional channel manager;
- optional corporate accounts.

### What Resorts May Need Beyond Hotels

Resorts may need more breadth, not necessarily a totally different core:

- multiple outlets: restaurants, bars, spa, shop, activities desk;
- packages that bundle room, meals, activities, transfers, spa, or venue access;
- day visitor and pool/day-use workflows;
- activity scheduling;
- event/venue operations;
- multi-property or campus-style navigation;
- more advanced revenue reporting by outlet and package;
- guest itinerary view;
- deposits and cancellation policies by package or activity;
- role permissions across departments.

Many of these already exist as foundations or Enterprise add-ons in Boroko. The setup group should default resorts toward:

- POS/multi-outlet interest;
- events/day-use interest;
- rate plans;
- guest messaging/portal;
- revenue manager;
- operations compliance if Enterprise.

Do not create a separate "Resort Mode" top-level product unless resort workflows become sufficiently different from hotel workflows in daily navigation.

### What Motels May Need Beyond Hotels

Motels may need a faster, simpler front desk:

- quick check-in/check-out;
- drive-up room assignment;
- short-stay/day-use options;
- lighter housekeeping board;
- simple rates;
- fewer Enterprise add-ons by default;
- optional restaurant/POS usually off unless selected.

The internal type `motel` should remain useful for defaults and copy, but the customer-facing setup group should still be Hotels, Resorts & Motels.

## Lodge, Camp, and Guesthouse Requirements

This group should be broad but not bloated.

Default modules:

- bookings;
- rooms/units/sites;
- guests;
- invoices;
- housekeeping where rooms/units exist;
- maintenance;
- expenses;
- reports;
- optional POS;
- optional inventory;
- optional day-use;
- optional events;
- optional public booking;
- optional full-property bookings.

Capabilities to satisfy this segment:

- simple room/unit setup;
- campsite setup;
- multi-room/multi-unit bookings;
- full-lodge/camp exclusive use;
- event/retreat support;
- customer credit and deposits;
- offline booking and payment safety;
- manager visibility;
- flexible public offers;
- simple guest-facing quote/request flow.

Use operating questions to unlock complexity gradually. A four-room guesthouse should not see resort machinery. A safari camp with rooms plus powered sites should be able to enable campsites without pretending to be a hotel.

## Restaurant Requirements

Restaurants remain the third setup choice and should be treated as a focused product:

- POS;
- tables;
- menus;
- orders;
- kitchen/bar prep;
- inventory/stock;
- recipe costing later;
- cash-up;
- staff;
- expenses;
- reports;
- loyalty/customer accounts later;
- delivery/takeaway later.

Restaurant mode should not show booking, room, housekeeping, or hotel language by default. Refer to `docs/RESTAURANT_POS_PRODUCT_PLAN.md` for the restaurant-specific implementation roadmap.

## Technical Implementation Phases

### Phase 1: Three-Option Setup Without Campsite Booking

Goal: reduce customer choice overload with minimal risk.

Tasks:

1. Add setup group constants and helpers.
2. Update `Setup.jsx` to show three cards.
3. Save `setup_business_group` in settings/operating profile.
4. Map setup group to default internal `property_type`.
5. Branch operating questions by setup group.
6. Preserve backward compatibility for existing settings without `setup_business_group`.
7. Add tests for mapping and setup defaults.

Acceptance:

- new setup only shows three primary choices;
- restaurants start in restaurant-only mode;
- hotels/resorts/motels start with hotel-style defaults;
- lodges/camps/guesthouses start with lodge-style defaults;
- existing properties still load and keep their current internal property type.

### Phase 2: Campsite Inventory Foundation

Goal: allow camps to configure campsite inventory safely.

Tasks:

1. Add migration for `rooms.accommodation_kind` and campsite fields.
2. Update room create/update RPCs and domain code.
3. Update Rooms UI copy and fields.
4. Add labels for "accommodation units" where property type is camp/lodge with campsites enabled.
5. Add regression tests for SQL, domain payloads, UI field presence, and backward compatibility.

Acceptance:

- existing rooms remain `accommodation_kind = 'room'`;
- campsites can be created as reservable inventory;
- campsite fields are optional unless kind is `campsite`;
- server rejects invalid kind/capacity combinations;
- old clients without the field still work.

### Phase 3: Campsite Booking and Public Request Flow

Goal: let staff and guests book/request campsites.

Tasks:

1. Update availability RPCs to include/segment campsites.
2. Update desktop booking flow to select campsite inventory.
3. Update public booking site to display campsite cards and submit selected site lines.
4. Update confirmation and success views.
5. Update quotations to support campsite lines.
6. Verify group invoice behavior for multiple sites/units.
7. Add tests for conflict checks and public submission payloads.

Acceptance:

- campsite dates cannot double-book the same site;
- public booking copy says campsite/site where appropriate;
- booking records remain financially compatible with existing ledgers;
- offline replay uses the same authoritative booking RPC contract;
- reports can distinguish room/unit/site bookings.

### Phase 4: Reporting, Labels, and Plan Limits

Goal: make the product honest and polished after campsites exist.

Tasks:

1. Update dashboards to show rooms/sites/accommodation units based on operating profile.
2. Update usage cards so room limits do not confuse camp operators.
3. Update reports to segment:
   - room nights;
   - unit nights;
   - campsite nights;
   - full-property bookings;
   - day-use/event bookings where applicable.
4. Update Manager PWA labels.
5. Update release/docs state after verification.

Acceptance:

- no customer-facing campsite flow says "room" where that would be misleading;
- financial totals remain authoritative and unchanged in principle;
- operational counts are labelled correctly;
- tests cover label mapping and report segmentation.

## Server-Side Rules

All new campsite booking behavior must follow existing Boroko financial rules:

- financial mutations use authoritative RPCs;
- do not write `bookings.amount_paid` directly from any client;
- do not author `payment_status` in React, Electron renderer code, public site code, or offline estimates;
- all booking charges, payments, refunds, customer credit, and POS charges remain audited ledger effects;
- retries preserve stable idempotency keys;
- ambiguous timeouts must not generate new operation keys;
- public booking requests never trust client-calculated price, availability, or payment state;
- RLS and RPC validation enforce lodge/property isolation.

## Testing Plan

Add or update focused tests before broad builds:

- `tests/enterprise-foundation.test.mjs` for property type/setup helpers if the shared catalog lives there.
- New test file such as `tests/setup-business-groups.test.mjs`.
- New test file such as `tests/campsite-accommodation.test.mjs` for migration/domain/UI contract checks.
- Existing public booking regression tests for campsite display/submission.
- Existing offline queue regression tests if booking payload shape changes.
- Existing subscription usage tests if room/site limits are renamed or reinterpreted.
- Restaurant mode tests to ensure the three-option setup does not reintroduce hotel/accommodation language into restaurant mode.

Minimum command set after implementation:

```powershell
node .\tests\setup-business-groups.test.mjs
node .\tests\campsite-accommodation.test.mjs
npm test
npm run test:enterprise
npm run build
npm run manager:build
npm --prefix booking-site run test:run
npm --prefix booking-site run build
```

If a migration is added and deployment state matters, run the checked-in migration push wrapper:

```powershell
npm run db:push
```

Then rerun it until it reports that the remote database is up to date. Do not infer production deployment from migration files alone.

## Rollout Guidance

Recommended order:

1. Ship the three-option setup simplification first.
2. Add campsite inventory fields behind operating-profile flags.
3. Enable staff-side campsite bookings.
4. Enable public campsite requests.
5. Polish reporting labels and package/marketing copy.

Avoid bundling this with a broad Enterprise hotel rebuild. The taxonomy change is a UX simplification. Campsite booking is a contained accommodation expansion. Keep both focused.

## Non-Goals

This plan does not require:

- renaming every `lodge_id` column;
- replacing the existing `rooms` table immediately;
- building a full campsite capacity engine in phase 1;
- making the public booking site accept final online payments for campsites unless the payment gateway scope is explicitly active;
- changing Legacy POS release behavior;
- creating a fourth top-level setup option for camps;
- showing all internal property types during first-run setup.

## Agent Checklist

Before editing:

- read `AGENTS.md`;
- read `PROJECT_STATE.md`;
- read `docs/ARCHITECTURE.md`;
- inspect `git status --short`;
- preserve unrelated worktree changes;
- inspect current `src/shared/propertyTypes.js`, `Setup.jsx`, room RPC migrations, public booking pages, and tests.

During implementation:

- keep the first setup choice to exactly three options;
- preserve internal property type detail;
- keep restaurant mode clean of accommodation language;
- keep campsite financial effects on existing authoritative RPC/ledger paths;
- label local/offline values as pending estimates;
- update tests near the changed contracts.

After implementation:

- run the real package scripts from `package.json`;
- update `PROJECT_STATE.md` if architecture, active risks, deployment assumptions, or release state materially changed;
- state exactly what was verified and what was not deployed.
