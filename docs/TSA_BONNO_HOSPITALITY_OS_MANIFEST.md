# TSA Bonno Hospitality OS Manifest

Last reviewed: 2026-07-03

This document is the technical implementation manifest for evolving the current Boroko Bookings codebase into TSA Bonno: a hospitality operating system that remains simple for small properties while supporting Enterprise hotel operations.

This is not a release note and not a marketing plan. It is a guardrail document for implementation agents, reviewers, and release verifiers.

## 1. Brand and Product Direction

### 1.1 Naming

The forward product name is **TSA Bonno**.

The current repository, historical code, release artifacts, and many user-facing strings may still refer to **Boroko Bookings** during the transition. Do not perform a broad rename as part of the Enterprise tier foundation unless explicitly requested. Renaming executable names, package identifiers, update channels, public URLs, database identifiers, or release metadata can break deployed clients.

Implementation rule:

- Use **TSA Bonno** in new strategy and planning documents.
- Preserve **Boroko Bookings** in existing code paths until a dedicated brand migration task exists.
- Do not rename app IDs, updater metadata, domains, Supabase schemas, package names, or installer names during Enterprise feature work.
- Any future brand migration must include desktop updater compatibility, public booking URLs, support docs, release artifacts, and customer communication.

### 1.2 Product Promise

TSA Bonno must feel simple to a six-room guest house and powerful to a 120-room hotel.

The product must not become cluttered for Starter, Standard, or Pro clients. Enterprise capability must be introduced through property-aware setup, module-aware navigation, subscription entitlements, and Enterprise add-ons.

### 1.3 Current Lineage

The current app is a financial-grade hospitality operations system with:

- desktop Electron front desk;
- Manager PWA;
- Legacy POS;
- public booking site;
- Command Central;
- Supabase RPCs, RLS, audit tables, and ledgers.

Enterprise work must build on this system. It must not replace it with a second business model.

## 2. Strategic Direction

### 2.1 Recommended Development Direction

Enterprise work should happen on a separate branch from the currently functioning client line.

Recommended branch pattern:

- `main` remains the protected client/release line.
- Enterprise foundation work happens on a feature branch such as `codex/tsa-bonno-enterprise-foundation`.
- High-risk hotel modules should be split into smaller branches or commits and merged only after focused verification.
- No Enterprise code should change current Starter, Standard, or Pro behavior unless the change is explicitly part of the foundation and has regression coverage.

### 2.2 Why A Branch Is Required

Clients are using the current app. Enterprise work touches:

- subscription limits;
- setup flow;
- navigation visibility;
- booking concepts;
- room inventory;
- folios;
- public booking boundaries;
- future payment flows;
- reporting and night audit.

These are high-blast-radius areas. A separate branch makes it possible to verify the work without destabilizing the operating product.

### 2.3 Release Gating

Enterprise features must be inert until enabled by plan, property type, module entitlement, add-on, and role capability.

No Enterprise feature is considered production-ready because it exists in the repository. A feature is operational only when:

- migrations are applied to the intended Supabase project;
- all affected client surfaces are built and deployed;
- entitlement logic hides or locks it correctly for other plans;
- focused regression tests pass;
- release smoke checks pass on the packaged desktop app where relevant;
- `PROJECT_STATE.md` accurately distinguishes repository implementation, deployment, and release status.

### 2.4 Development Preview Rule

Development and QA need a way to see Enterprise work before a real paid entitlement exists.

Required behavior:

- Customer-facing Enterprise Preview Mode is not part of the product. Add-on testing and enablement belongs in Command Central, where Boroko admins can activate or deactivate grouped add-on bundles for a client account.
- Preview Mode must be visibly labelled in the app.
- Preview Mode must never grant server-side authority, bypass RLS, bypass RPC role checks, or confirm paid add-ons.
- Preview Mode may bypass renderer `UpgradeWall` screens for Enterprise UI so builders can inspect routes.
- Preview Mode must not bypass Pro-only or lower-tier gates unless explicitly designed for test fixtures.
- Add-on placeholders and planned modules may be visible in Preview Mode, but must say whether they are active, requestable, or planned.
- Real production activation must still come from subscription/add-on entitlement state controlled by Command Central or the backend.

Implementation agents must not use Preview Mode as proof that an entitlement, migration, or commercial activation works.

## 3. Non-Negotiable System Rules

### 3.1 Financial Rules

These rules apply to all tiers and all Enterprise work:

1. Financial mutations must use authoritative Supabase RPCs.
2. Never write `bookings.amount_paid` directly from a client.
3. Never author `payment_status` in React, Electron renderer code, or offline estimates.
4. Payments are delta-based ledger entries.
5. Authoritative totals, balances, and settlement states come from the database.
6. Offline replay must call the same RPC contract used online.
7. Offline replay must preserve stable operation IDs and idempotency keys.
8. Never replace an ambiguous timeout with a new idempotency key.
9. POS orders, returns, voids, cash-up, booking charges, refunds, customer credit, folio postings, and inventory movements must be atomic and auditable.
10. Local cache values may be shown as pending estimates but must not silently become financial truth.
11. Payment gateway browser redirects are not proof of payment.
12. Only verified server-side payment webhooks may confirm online payment.
13. TSA Bonno must not become merchant of record for Enterprise client payment gateways unless a future legal/product decision explicitly changes that.

### 3.2 Database and Concurrency Rules

1. Prefer one atomic RPC over client-side read-modify-write sequences.
2. Lock affected rows where concurrent mutation can change the answer.
3. Enforce lodge, property, outlet, actor, role, capability, and ownership server-side.
4. Validate idempotency-key reuse against the original operation payload.
5. Preserve audit before/after context for financially meaningful changes.
6. Treat migration files as repository intent, not proof of production deployment.
7. Verify linked schema when deployment state matters.
8. Do not expose service-role credentials to renderers, PWAs, POS clients, or public sites.
9. Do not add client-side "fixes" that bypass RLS or RPC validation.
10. Do not rely on visible UI buttons as permission enforcement.

### 3.3 Offline and Sync Rules

1. Queue operations, not alternate business rules.
2. Store RPC name, payload, stable operation ID or idempotency key, dependencies, retry state, and failure details.
3. Replay must not duplicate financial, inventory, folio, or room-availability effects.
4. Failed financial work must not be silently discarded.
5. Pending local estimates must be visibly different from server-confirmed records.
6. Preserve legacy queue compatibility when changing payload contracts.
7. Check the main desktop queue, Manager PWA device-local queue, and Legacy POS queue for affected operations.
8. Manager PWA offline work is limited and device-local; do not describe offline support as Electron-only.
9. Legacy POS queue and mesh behavior are separate from the desktop queue.
10. The local mesh is not an authoritative database.

### 3.4 Current App Preservation Rules

Enterprise implementation must not break:

- current direct booking flow;
- room availability conflict checks;
- booking payment and refund flows;
- customer credit and prepayment flows;
- booking reschedule behavior;
- public booking site single-room and multi-room requests;
- full-lodge public offer behavior;
- booking-site success page behavior;
- Manager PWA operational views;
- Legacy POS ordering, returns, cash-up, and queue replay;
- desktop offline queue replay;
- existing Starter, Standard, and Pro access expectations except for explicitly planned Pro cap changes.

Any implementation agent must run the relevant regression bundle before claiming done.

### 3.5 Guardrails for Every Workflow

Every feature and repair must include guardrails proportionate to its operational risk. Define the allowed actor, property/outlet scope, valid data and state transitions, retry/duplicate behavior, audit evidence, error presentation, and recovery path before calling the work complete. Stock, payments, bookings, availability, and destructive actions must use authoritative, atomic, fail-closed server contracts; UI visibility, confirmation dialogs, and client-side validation supplement those controls but never replace them. A focused regression must prove the guardrail that prevents the important failure mode.

### 3.6 Enterprise Depth Without Lower-Tier Clutter

Starter, Standard, and Pro are already valid products. Enterprise work must not turn those tiers into a hotel-PMS interface by default.

Default rule:

- Do not broaden Starter, Standard, or Pro screens unless the change is small, backward-compatible, and obviously improves the existing workflow.
- Put deep hotel workflows behind Enterprise plan, hotel-relevant property type, module visibility, feature flags, add-on entitlement, and role capability.
- Where a feature exists in lower tiers, keep the lower-tier version simple and familiar.
- Where Enterprise needs deeper capability for the same concept, build an Enterprise extension, Enterprise route, Enterprise panel, Enterprise mode, or conditional advanced section.
- Do not force small guest houses, BnBs, lodges, camps, or restaurants to see hotel-only terms, dense hotel controls, or add-on complexity.
- Do not remove lower-tier shortcuts just because Enterprise needs a more formal workflow.
- Do not make an Enterprise-only table, status, or field mandatory for lower-tier operation unless there is a safe fallback and regression coverage.

Examples:

- Rooms may keep simple `room_type` text for lower tiers while Enterprise can link rooms to structured `room_types`, floor/section, attributes, and hotel inventory metadata.
- Housekeeping may remain a simple clean/dirty workflow for lower tiers while Enterprise adds assignment, inspection, supervisor approval, linen, and SLA timers.
- Night Audit may remain a light reporting/close helper for lower tiers while Enterprise gets daily close, exception checks, folio posting, date locks, and audit packs.
- Maintenance may remain a ticket list for lower tiers while Enterprise adds out-of-order/out-of-service inventory blocking, downtime analytics, and room-readiness integration.
- Reports may remain simple summaries for lower tiers while Enterprise adds pace, pickup, debtor, channel/source, housekeeping productivity, and maintenance downtime reports.

If an implementation touches a shared screen, it must explicitly answer:

1. What stays unchanged for Starter, Standard, and Pro?
2. What appears only for Enterprise?
3. What appears only for hotel/motel/resort property types?
4. What is controlled by add-on entitlement?
5. What regression test proves lower-tier behavior remains clean?

## 4. Product Model

### 4.1 Separate Concepts

The system must separate four concepts:

1. Property type: what the client operates.
2. Subscription plan: what package the client pays for.
3. Operating modules: which operational areas are relevant and enabled.
4. Enterprise add-ons: which advanced paid modules are activated.

Do not collapse these into one field.

### 4.1.1 Customization Standard

Every Enterprise feature must be customizable by property without creating a different codebase per client.

Enterprise customization should be stored as configuration, not hard-coded branching, wherever practical.

Each major Enterprise module should define which of these are configurable:

- labels and terminology;
- visible modules;
- custom statuses;
- custom categories;
- required fields;
- approval rules;
- role permissions;
- document templates;
- message templates;
- fee policies;
- tax/VAT display rules;
- workflow steps;
- default filters and dashboard widgets;
- report columns;
- export formats;
- notification rules.

Customization must be scoped by `lodge_id` or future property/group identity. It must not leak between properties.

Customization must not bypass financial rules, RLS, RPC validation, audit, idempotency, or entitlement gates.

### 4.2 Property Type

Property type describes the business:

- `guest_house`
- `bnb`
- `lodge`
- `camp`
- `motel`
- `hotel`
- `resort`
- `restaurant`
- future: `apartment_hotel`, `hostel`, `serviced_apartments`

Property type should influence:

- setup copy;
- default modules;
- navigation relevance;
- upgrade prompts;
- hotel-only feature visibility;
- reporting labels;
- public booking configuration defaults.

Property type must not automatically grant paid features.

### 4.3 Subscription Plan

Subscription plan describes package entitlement:

- `Starter`
- `Standard`
- `Pro`
- `Enterprise`

Plan must influence:

- included modules;
- capacity limits;
- locked/visible states;
- upgrade route;
- add-on eligibility.

Plan must not decide business identity by itself. A small hotel could theoretically be configured incorrectly on Pro, but hotel-grade functionality must remain locked until Enterprise.

### 4.4 Operating Profile

Operating profile stores the practical shape of the business:

```js
{
  property_type: 'guest_house' | 'bnb' | 'lodge' | 'camp' | 'motel' | 'hotel' | 'resort' | 'restaurant',
  operation_style: 'simple' | 'managed' | 'commercial' | 'hotel' | 'group',
  enabled_modules: string[],
  relevant_modules: string[],
  hidden_modules: string[],
  subscription_plan: 'Starter' | 'Standard' | 'Pro' | 'Enterprise',
  enterprise_addons: string[],
  capacity_limits: {
    rooms: number | null,
    users: number | null,
    monthlyBookings: number | null,
    posOutlets: number | null,
    properties: number | null
  }
}
```

Backward compatibility:

- Existing `business_type = 'lodge'` maps to `property_type = 'lodge'`.
- Existing `business_type = 'restaurant'` maps to `property_type = 'restaurant'`.
- Missing property type must default safely to current behavior.
- Do not break existing settings rows.

## 5. Subscription Tier Model

### 5.1 Starter

Target:

- very small guest houses;
- small bed and breakfasts;
- simple accommodation businesses.

Positioning:

- Daily front-desk basics.

Recommended limits:

- 6 rooms;
- 2 users;
- 50 bookings/month;
- 2 grace bookings.

Included:

- dashboard;
- bookings;
- room board;
- rooms;
- guests;
- invoices and receipts;
- basic housekeeping;
- maintenance;
- settings.

Not included:

- reports;
- expenses;
- staff management;
- night audit;
- POS;
- inventory;
- room supplies;
- Manager PWA;
- public booking slug;
- custom website;
- online payments;
- hotel folios;
- advanced rates;
- corporate accounts;
- multi-property.

Visibility rule:

- Keep Starter clean.
- Show relevant locked upgrades only.
- Do not show hotel-only clutter.

### 5.2 Standard

Target:

- serious guest houses;
- managed guest houses;
- growing lodges;
- small properties needing owner control.

Positioning:

- Owner control and management discipline.

Recommended limits:

- 20 rooms;
- 5 users;
- 200 bookings/month;
- 5 grace bookings.

Included:

- everything in Starter;
- reports;
- expenses;
- staff management;
- role-based access;
- night audit;
- day-use / pool;
- conference / events;
- data import/export.

Not included:

- POS;
- inventory;
- room supplies;
- Manager PWA;
- public booking slug;
- custom website;
- online payments;
- hotel-only features.

### 5.3 Pro

Target:

- commercial lodges;
- boutique lodges;
- properties that sell food/drinks;
- properties needing owner mobile oversight;
- properties wanting a simple branded public booking page.

Positioning:

- Commercial suite for serious accommodation businesses.

Recommended limits:

- 30 rooms;
- 10 users;
- 500 bookings/month;
- 10 grace bookings.

Included:

- everything in Standard;
- POS;
- inventory;
- room supplies;
- Manager PWA;
- simple public booking slug;
- direct guest enquiries;
- booking request flow.

Important rule:

- Pro is no longer unlimited.
- Remove UI copy that says Pro has unlimited rooms, users, or bookings.
- Pro gets a simple public booking slug.
- Pro does not get online payment initially.
- Pro does not get a custom direct booking website.
- Pro does not get Enterprise hotel modules.

### 5.4 Enterprise

Target:

- motels;
- hotels;
- resorts;
- large lodges;
- high-volume properties;
- multi-department operations;
- future multi-property groups.

Positioning:

- Hotel-grade PMS and enterprise hospitality operations.

Recommended base limits:

- 100 rooms included;
- 25 users included;
- 1,500 to 2,000 bookings/month included;
- 50 grace bookings;
- optional paid capacity packs.

Enterprise base includes:

- everything in Starter;
- everything in Standard;
- everything in Pro;
- hotel/motel/resort property mode;
- room types;
- physical room inventory under room types;
- floors/wings/sections;
- hotel front-desk dashboard;
- arrivals/departures/in-house/no-show board;
- room move workflow;
- early check-in / late checkout workflow;
- basic folio model;
- advanced housekeeping board v1;
- hotel KPIs;
- Enterprise add-on catalog;
- priority support.

Enterprise add-ons should include:

- custom direct booking website;
- online payment gateway;
- advanced rate engine;
- channel manager;
- corporate/group billing;
- advanced housekeeping mobile;
- guest portal;
- multi-property dashboard.

## 6. Property Setup Flow

### 6.1 First Setup Step

The first setup step should ask:

> What do you operate?

Property cards:

1. Guest House
2. Bed & Breakfast
3. Lodge / Camp
4. Motel
5. Hotel
6. Resort
7. Restaurant / POS Only

### 6.2 Property Defaults

Guest House defaults:

- bookings;
- rooms;
- guests;
- invoices;
- basic housekeeping;
- maintenance.

Bed & Breakfast defaults:

- guest house defaults;
- breakfast indicator;
- future breakfast control.

Lodge / Camp defaults:

- bookings;
- rooms;
- guests;
- invoices;
- housekeeping;
- maintenance;
- day-use;
- events/conference;
- POS if food/drinks enabled;
- inventory if POS enabled.

Motel defaults:

- front-desk board;
- walk-ins;
- room status;
- payments;
- housekeeping turnover;
- arrivals/departures;
- no-shows;
- late checkout.

Hotel defaults:

- room types;
- physical room inventory;
- front-desk dashboard;
- folios;
- arrivals/departures;
- no-shows;
- advanced housekeeping;
- hotel KPIs;
- POS;
- corporate accounts;
- rate plans.

Resort defaults:

- hotel defaults;
- multiple outlets;
- events;
- day-use;
- guest services;
- activities;
- spa/wellness optional.

Restaurant / POS Only defaults:

- POS;
- inventory;
- outlets;
- cash-up;
- staff;
- expenses;
- reports.

### 6.3 Operating Questions

After property type selection, ask:

1. Do you sell food or drinks?
2. Do you host events, conferences, parties, or weddings?
3. Do you allow day visitors, pool use, or activities?
4. Do you want a public booking page?
5. Do you operate multiple POS outlets?
6. Do you manage room supplies such as toiletries, linen, and amenities?
7. Do you serve corporate clients?
8. Do you need company accounts or monthly statements?
9. Do you need hotel-style room types and rate plans?
10. Do you need online payment on your own website?
11. Do you manage multiple properties?

The answers should produce an operating profile, not unlock paid features automatically.

## 7. Module Catalog and Visibility

### 7.1 Central Catalog

Create a shared module catalog over time. It should become the single source for:

- module key;
- label;
- description;
- category;
- required plan;
- add-on key;
- allowed property types;
- visibility relevance;
- route list;
- role capabilities;
- upsell priority;
- rollout status.

Example:

```js
{
  key: 'advanced_rates',
  label: 'Advanced Rate Engine',
  description: 'Seasonal rates, corporate rates, package rates, promo codes, and stay restrictions.',
  category: 'revenue',
  requiredPlan: 'Enterprise',
  isAddon: true,
  addonKey: 'advanced_rates',
  allowedPropertyTypes: ['hotel', 'motel', 'resort', 'lodge'],
  visibility: 'hotel_only',
  upsellPriority: 80,
  routes: ['/rates'],
  capabilities: ['rates.view', 'rates.manage'],
  rolloutStatus: 'planned'
}
```

### 7.2 Three Visibility States

Every module resolves to one of:

1. Visible + unlocked.
2. Visible + locked.
3. Hidden.

Visible + unlocked requires:

- relevant property type;
- included by plan or add-on;
- allowed by role/capability;
- route implemented;
- no rollout block.

Visible + locked means:

- relevant to the property;
- not included in the current plan/add-on;
- safe to advertise as an upgrade.

Hidden means:

- not relevant to property type;
- hotel-only feature on small property;
- too advanced for current operation;
- route not ready;
- dangerous/confusing to expose.

### 7.3 Navigation Rule

Do not show every locked feature in the sidebar.

Sidebar should show:

- core unlocked modules;
- relevant locked modules only;
- no irrelevant hotel-only clutter.

Upgrade/Add Modules should show:

- broader recommended upgrades;
- Enterprise add-ons;
- hidden hotel options only where property type and plan context make sense.

Settings/Subscription should show:

- included;
- locked;
- available add-on;
- not relevant to your property type;
- planned/not yet available.

## 8. Enterprise Feature Scope

### 8.1 Foundation v1

Build first:

1. Add Enterprise plan.
2. Cap Pro usage limits.
3. Add Enterprise usage limits.
4. Add Enterprise metadata and upsell benefits.
5. Add property type constants.
6. Add operating profile model.
7. Add module catalog.
8. Add module visibility resolver.
9. Update setup to ask property type.
10. Update navigation to use property type and module visibility.
11. Update subscription panel to show Enterprise and Pro counters correctly.
12. Add tests for plan limits, property type mapping, and module visibility.
13. Update docs.

Do not build hotel folios, payment gateways, or custom websites in Foundation v1.

### 8.2 Hotel Core v1

Build after Foundation v1:

1. Hotel/motel/resort mode.
2. Room types.
3. Physical room inventory under room types.
4. Floors/wings/sections.
5. Room attributes.
6. Front-desk dashboard.
7. Arrivals/departures/in-house/no-show board.
8. Room move workflow.
9. Early check-in / late checkout workflow.
10. Advanced housekeeping board v1.
11. Hotel KPIs.

### 8.3 Finance and Folio v1

Build after Hotel Core v1 or in a tightly controlled parallel branch:

1. Basic folio model.
2. Folio ledger entries.
3. Room charges posted to folio.
4. POS charge-to-room/folio.
5. Split billing foundation.
6. Master invoice foundation.
7. Customer/company allocation rules.
8. Night-audit readiness checks.
9. Folio-related reporting.

Folio work is financial work and must be RPC-first, idempotent, audited, and covered by tests.

### 8.4 Enterprise Add-on Foundation

Build add-on infrastructure before building every add-on:

1. `enterprise_addons` config.
2. Add-on catalog.
3. Add-on entitlements.
4. Add-on quote/request UI.
5. Admin-side add-on activation.
6. Tests for Enterprise with and without add-ons.
7. Tests proving Pro cannot access Enterprise add-ons.

### 8.5 Command Central Control Plane

Enterprise work must update Command Central. Command Central is the owner/admin control plane for commercial activation, support visibility, and entitlement correction.

Command Central must eventually support:

1. Viewing every lodge/company subscription plan.
2. Viewing property type and operating profile.
3. Viewing selected/requested Enterprise add-ons.
4. Viewing generated upgrade quotations from desktop app requests.
5. Viewing generated upgrade quotations from the public website.
6. Converting a request/quotation into an invoice or payable pro-forma document.
7. Recording manual payment review status without pretending online payment was processed.
8. Activating or deactivating subscription plan entitlements.
9. Activating or deactivating Enterprise add-ons individually.
10. Seeing effective feature flags that result from plan + add-ons + overrides.
11. Auditing who changed plan/add-on entitlements, when, and why.
12. Sending an activation/update response back to the client app.
13. Searching/filtering pending upgrade requests, paid-awaiting-activation requests, and expired quotes.

Command Central must not:

- use service-role credentials in renderers;
- activate features from a public website request without admin review;
- treat an uploaded proof of payment as confirmed settlement unless the admin has reviewed it or a future verified payment gateway webhook confirms it;
- silently overwrite existing client entitlements without an audit trail.

### 8.6 In-App Upgrade and Add-on Request Flow

The desktop app must let existing clients request plan upgrades and add-ons from inside Settings/Subscription.

Required in-app flow:

1. App already knows lodge/company details from settings and entitlement state.
2. User opens Settings/Subscription.
3. User chooses target plan.
4. If target plan is Enterprise, user can select relevant add-ons.
5. App shows clear pricing/quote summary once pricing is configured.
6. App captures notes such as room count, property type, expected users, requested add-ons, website/domain needs, and implementation urgency.
7. App generates a quotation/pro-forma request document for the client to save.
8. App submits the same structured request to the backend/Command Central.
9. Command Central shows the request with selected plan and selected add-ons already parsed.
10. Admin may convert the request to an invoice/pro-forma, mark payment review state, and activate the plan/add-ons after manual approval.
11. Client app refreshes entitlement and unlocks only approved plan/add-on features.

The in-app request must be non-financial unless a future payment gateway is implemented. It must not mark a subscription paid, activate add-ons, or mutate payment state by itself.

### 8.7 Public Website Package Builder Flow

The public website should support a similar sales flow for new or existing prospects.

Required website flow:

1. Prospect selects a package: Starter, Standard, Pro, or Enterprise.
2. If Enterprise is selected, prospect selects property type and relevant add-ons.
3. Website captures company/property details, contact person, email, phone, country, property type, room count, expected users, add-ons, and notes.
4. Website generates a downloadable quotation/pro-forma request.
5. Website submits the same structured request to the backend/Command Central.
6. Command Central shows the request as a pending sales/upgrade request with all selected add-ons already parsed.
7. Admin reviews the request, converts it to invoice/pro-forma if needed, handles payment manually, then activates the plan/add-ons in Command Central.

The public website must not require online payment gateway work for this flow. Manual payment is allowed. Payment gateway integration remains a separate future add-on.

### 8.8 Quote, Invoice, and Activation Data Contract

Upgrade/add-on requests should use a structured contract, not free-text only.

Minimum request payload:

```js
{
  source: 'desktop_app' | 'public_website' | 'command_central',
  request_type: 'new_subscription' | 'plan_upgrade' | 'addon_request' | 'capacity_pack',
  lodge_id: string | null,
  existing_license_id: string | null,
  company_name: string,
  property_name: string,
  contact_name: string,
  contact_email: string,
  contact_phone: string,
  country: string,
  property_type: 'guest_house' | 'bnb' | 'lodge' | 'camp' | 'motel' | 'hotel' | 'resort' | 'restaurant',
  current_plan: 'Trial' | 'Starter' | 'Standard' | 'Pro' | 'Enterprise' | null,
  requested_plan: 'Starter' | 'Standard' | 'Pro' | 'Enterprise',
  requested_addons: string[],
  room_count: number | null,
  user_count: number | null,
  expected_monthly_bookings: number | null,
  pricing_snapshot: object | null,
  quote_number: string | null,
  quote_pdf_path_or_url: string | null,
  notes: string,
  status: 'draft' | 'submitted' | 'quoted' | 'invoice_sent' | 'payment_under_review' | 'approved' | 'activated' | 'rejected' | 'expired',
  submitted_at: string
}
```

Activation must be a separate admin action:

```js
{
  license_id: string,
  lodge_id: string,
  plan: 'Starter' | 'Standard' | 'Pro' | 'Enterprise',
  enterprise_addons: string[],
  effective_features: object,
  activated_by: string,
  activation_reason: string,
  related_request_id: string | null,
  related_invoice_id: string | null
}
```

No client-facing request may directly write the activation record. Activation must be server/admin controlled and audited.

## 9. Public Booking, Custom Website, and Payments

Product packaging rule:

- Customers should see this as **Direct Booking Website with Online Payments**, not as scattered technical add-ons.
- Boroko builds or configures the client website.
- Boroko connects the website to the property's payment provider.
- Guests book and pay online.
- The desktop app receives the booking and the verified payment confirmation.
- Payment links are a later operational tool for special invoices, balances, deposits, and folios; they should not lead the first customer-facing offer.
- Terms such as webhook, payment intent, and reconciliation are internal implementation concepts. Customer copy should say automatic payment confirmation and payment matching.

### 9.1 Tier Rules

Starter:

- no public booking slug;
- no custom website;
- no online payments.

Standard:

- no public booking slug;
- no custom website;
- no online payments.

Pro:

- simple branded public booking slug;
- public booking request flow;
- no online payment initially;
- no custom website;
- no custom domain;
- no payment gateway.

Enterprise:

- eligible for custom direct booking website add-on;
- eligible for advanced booking engine add-on;
- eligible for online payment gateway add-on.

### 9.2 Merchant Rule

Payments must go directly to the property.

The hotel owns:

- payment gateway account;
- merchant account;
- settlement bank account;
- refund responsibility;
- tax responsibility;
- chargeback responsibility.

TSA Bonno provides:

- website;
- booking engine;
- integration;
- webhook setup;
- support;
- synchronization into Supabase.

### 9.3 Payment Intent Flow

Do not immediately create a final paid booking from the browser.

Required flow:

1. Guest selects room/date.
2. Server checks availability.
3. Server calculates authoritative price/deposit.
4. Server creates `public_booking_intent`.
5. Guest is redirected to property payment checkout.
6. Payment gateway sends webhook.
7. Server verifies webhook signature.
8. Server confirms payment.
9. Server creates or confirms booking through authoritative RPC.
10. Server records payment against booking or folio.
11. App shows paid online booking received.
12. Guest receives confirmation email.

Critical rule:

- Browser success page is not proof of payment.
- Only verified gateway webhook confirms payment.

### 9.4 Provider Abstraction

Do not hardcode one country or one provider.

Payment provider config should support:

```js
{
  payment_provider: 'none' | 'dpo' | 'paygate' | 'paystack' | 'flutterwave' | 'stripe' | 'manual_adapter',
  country: 'BW' | 'ZA' | 'NA' | 'ZM' | 'ZW' | string,
  currency: 'BWP' | 'ZAR' | 'USD' | string,
  merchant_account_owner: 'property',
  mode: 'test' | 'live'
}
```

Secrets must never be exposed to:

- public website frontend;
- desktop renderer;
- Manager PWA;
- Legacy POS;
- logs;
- exported support bundles.

## 10. Enterprise Add-on Catalog

### 10.0 Add-on Boundaries and Suite Packaging

Enterprise add-ons should be treated as commercial modules with clear buyer-facing promises, not as one-to-one copies of every internal table, screen, or implementation layer.

The product rule for overlapping areas is:

- keep add-ons separate when the buyer-facing operational promise is different;
- share technical foundations where the data, permissions, workflow events, or reports naturally overlap;
- do not duplicate lower-tier features under a new name;
- do not merge distinct operational departments merely because they touch the same room, booking, guest, staff member, asset, folio, or report;
- bundle related add-ons into suites when useful for sales and implementation, while preserving individual activation keys internally.

Recommended suite packaging:

- **Enterprise Operations Suite**: Staff Operations & Workforce, Maintenance & Asset Management, Operations Compliance, Housekeeping Command Center, and related hotel role templates.
- **Events & Groups Suite**: Events & Venue Management, Group Operations, Corporate Accounts, Advanced Folios/Documents, and event/group reporting.
- **Revenue & Distribution Suite**: Rate Plans, Advanced Rate Engine, Revenue Manager, Channel Manager, Promo Codes, and Rate Calendar.
- **Guest Experience Suite**: Guest Portal, Guest Messaging, Guest CRM, Direct Booking Website, and Online Payments where enabled.

Suite packaging must not bypass individual feature gates. A bundle is a commercial shortcut; the effective access state must still resolve through plan, property type, add-on entitlement, module visibility, and role/capability checks.

### 10.1 Direct Booking, Custom Website, and Payments

Includes:

- custom direct booking website;
- advanced booking engine;
- online payment gateway;
- guest payment rules;
- abandoned payment recovery.

### 10.2 Advanced Rates and Revenue Management

Includes:

- seasonal rates;
- weekday/weekend rates;
- corporate rates;
- package rates;
- promo codes;
- stay restrictions;
- minimum/maximum stay;
- yield rules;
- rate audit.

### 10.3 Corporate, Groups, Folios, and B2B Billing

Includes:

- corporate accounts;
- group room blocks;
- master folio;
- guest folios;
- split billing;
- company statements;
- debtor aging;
- credit limits;
- event plus accommodation bundles.

### 10.4 Housekeeping, Rooms, Linen, and Property Operations

Includes:

- advanced housekeeping mobile;
- supervisor inspection;
- turnaround tracking;
- linen and laundry management;
- lost and found;
- minibar / room consumption;
- room supplies integration.

### 10.5 Guest Experience, Portal, and Concierge

Includes:

- guest portal;
- online check-in;
- guest preferences;
- guest requests;
- concierge tasks;
- post-stay automation;
- loyalty / guest recognition.

### 10.6 Staff, Departments, Handover, and Audit

Includes:

- department-based permissions;
- staff scheduling;
- attendance and clock-in/clock-out;
- task assignment;
- training and checklist completion;
- casual/temporary worker records;
- shift handover log;
- incident log;
- approval workflows;
- staff productivity.

### 10.7 Finance, Deposits, Vouchers, and Control

Includes:

- deposit and preauthorization management;
- gift vouchers;
- agent commission tracking;
- complimentary rooms;
- house-use rooms;
- financial controls;
- credit notes;
- overpayment to customer credit;
- unallocated payments.

### 10.8 Food, Beverage, Outlets, and Costing

Includes:

- multi-outlet POS Pro;
- restaurant/bar/pool bar/gift shop/spa outlets;
- room service;
- kitchen display;
- recipe and food costing;
- theoretical vs actual usage;
- breakfast control;
- banquet/event food and beverage.

### 10.9 Security, Facility, Visitors, and Emergency

Includes:

- property asset registry;
- equipment service history;
- warranty and inspection reminders;
- technician assignment;
- preventive maintenance;
- downtime analytics;
- key/card tracking;
- future door-lock integration;
- visitor register;
- vehicle register;
- emergency / evacuation list;
- facility checks;
- patrol logs.

### 10.10 Multi-Property, Groups, and Central Office

Includes:

- multi-property dashboard;
- shared guest profile;
- central reservations office;
- group-wide corporate accounts;
- multi-property website;
- consolidated reporting.

### 10.11 Events, Venues, Banquets, and Packages

Includes:

- wedding, conference, retreat, workshop, memorial, birthday, and private-dining workflows;
- venue availability;
- event package builder;
- banquet/event food and beverage;
- event timelines and run sheets;
- deposits, milestones, cancellation terms, and post-event settlement;
- supplier coordination;
- group-room linkage;
- event profitability and settlement reporting.

## 11. Edge Cases To Design and Test

This section is part of the implementation contract. Enterprise work should add focused tests as each area is built.

### 11.1 Booking and Room Availability

1. Guest extends stay while the room is already booked for another arrival.
2. Guest changes room mid-stay.
3. Guest books multiple rooms with different checkout dates.
4. Guest books multiple rooms under one lead guest.
5. Guest cancels one room inside a multi-room stay.
6. Room becomes out-of-order after it was booked online.
7. Room becomes out-of-service because of maintenance.
8. Walk-in booking is created during internet outage.
9. Public website shows room available but desktop has pending offline booking.
10. OTA/custom website booking arrives for a sold-out date.
11. No-show should release room or keep charge depending on policy.
12. Early check-in requested but room is still dirty.
13. Late checkout blocks same-day arrival.
14. Group room block release date passes with unsold rooms.
15. Overlapping manual room assignment during check-in.
16. Room type is available but no clean physical room is ready.
17. Guest wants accessible room but only standard room remains.
18. Guest changes dates after deposit was paid.
19. Guest changes room type after online payment.
20. Room rate changes after quotation but before confirmation.

### 11.2 Payment

1. Guest pays deposit, then changes dates.
2. Payment succeeds but booking confirmation fails.
3. Payment succeeds but webhook arrives late.
4. Browser shows success but webhook does not arrive.
5. Guest abandons payment.
6. Payment gateway times out.
7. Payment duplicated by guest retry.
8. Payment amount differs from booking intent amount.
9. Currency mismatch.
10. Deposit paid but booking later cancelled.
11. Refund requested while app is offline.
12. Refund approved only when online and manager PIN verified.
13. Partial refund with retained fee.
14. Overpayment should move to customer credit or folio credit.
15. Payment recorded against wrong booking/folio.
16. Corporate account pays later by bank transfer.
17. Card preauthorization is released but not captured.
18. Damage deposit is partially forfeited.
19. Chargeback reported after checkout.
20. Payment gateway provider disabled or credentials invalid.

### 11.3 Folio and Billing

1. Guest has personal folio and company folio.
2. Company pays room, guest pays extras.
3. POS charge posted to wrong room.
4. Guest checks out but unpaid POS charges remain.
5. Group has master invoice plus individual guest extras.
6. Guest asks to split invoice by date.
7. Guest asks to split invoice by department.
8. Company exceeds credit limit.
9. Credit account is suspended but staff tries to bill to company.
10. Complimentary room must not inflate revenue.
11. House-use room must count differently from sold room.
12. Tax setting changes after booking was quoted.
13. Exchange rate changes after quotation.
14. Refund creates negative folio balance.
15. Credit note issued after invoice.
16. Payment allocated across multiple room bookings.
17. One guest pays for two rooms.
18. Booking transferred from guest to company account.
19. Invoice must show legal company details.
20. Advance payment exists without booking dates.

### 11.4 Housekeeping

1. Housekeeper marks room clean but supervisor rejects it.
2. Guest refuses cleaning.
3. Do-not-disturb prevents cleaning before arrival.
4. Dirty room assigned to arriving guest.
5. Early check-in guest arrives before room is inspected.
6. Room is clean but maintenance issue blocks sale.
7. Linen missing from room.
8. Minibar item missing but guest disputes it.
9. Housekeeper reports maintenance issue during cleaning.
10. Room move requires cleaning of old room.
11. Late checkout delays cleaning queue.
12. Priority VIP arrival requires room first.
13. Same-day back-to-back booking with tight turnaround.
14. Cleaner assigned too many rooms.
15. Supervisor inspection not completed before check-in.
16. Lost item found after checkout.
17. Guest claims lost item that was not logged.
18. Laundry sent out but not returned.
19. Damaged linen charged to guest.
20. Room status conflicts across offline devices.

### 11.5 Staff and Permission

1. Receptionist tries to issue refund.
2. Cashier tries to void without supervisor PIN.
3. Staff tries to override rate without approval.
4. Manager approves discount after checkout.
5. Suspended user still logged in on another device.
6. Staff belongs to one department but accesses another.
7. Night auditor closes day with unresolved issues.
8. User changes role while app is offline.
9. Staff deletes or edits old booking without permission.
10. Admin changes subscription while device offline.
11. Department manager can approve only department actions.
12. Owner wants read-only reporting only.
13. Shift handover note edited after the fact.
14. Incident log requires manager-only visibility.
15. Audit log must show who approved what.
16. Staff uses shared login.
17. PIN compromised or reused.
18. Device lost/stolen with active session.
19. Legacy POS operator permissions mismatch desktop.
20. Role permissions must survive sync/replay.

### 11.6 Reporting and Night Audit

1. Night audit tries to close with unresolved payments.
2. Offline transactions pending during night audit.
3. POS cash-up not completed.
4. Refund pending approval.
5. Customer credit liability mismatch.
6. Booking is checked in but unpaid.
7. Guest checked out with open folio.
8. No-show not processed.
9. Out-of-order room excluded from available room count.
10. Complimentary room included/excluded depending report.
11. House-use room reported separately.
12. Revenue recognized on wrong date.
13. Cash movement differs from revenue.
14. Deposit collected before stay.
15. Refund after reporting period closed.
16. Report exported while cache stale.
17. Multi-property reports double count shared guest.
18. Group booking revenue allocated wrongly.
19. Tax/VAT report mismatch.
20. Audit close needs reversal/reopen workflow.

### 11.7 Public Website / Booking Engine

1. Guest starts booking but room is taken before payment.
2. Guest opens same booking in two tabs.
3. Guest pays from expired booking intent.
4. Guest enters invalid email/phone.
5. Guest submits booking while property is offline.
6. Guest books a room with stale price.
7. Website cannot reach Supabase.
8. Payment provider webhook retries.
9. Webhook signature invalid.
10. Success page loaded without payment.
11. Booking confirmation email fails.
12. Guest enters special request requiring approval.
13. Custom website domain SSL expires.
14. Payment gateway test mode left enabled.
15. Merchant credentials revoked.
16. Availability cache stale.
17. Public booking rate differs from desktop rate.
18. Search engine indexes wrong room/date URL.
19. Guest cancels from email link.
20. Booking intent cleanup job fails.

### 11.8 Multi-Property

1. Central office books wrong property.
2. Guest profile duplicated across properties.
3. Corporate account credit shared across properties.
4. Staff has access to one property only.
5. Manager views group dashboard but not property-level guest details.
6. Booking transferred between properties.
7. Payment made at Property A for Property B.
8. Shared guest blacklist must apply group-wide.
9. Property-specific tax settings differ.
10. Group report currency mismatch.
11. Offline property sync delay affects central view.
12. Same room number exists at multiple properties.
13. Multi-property website routes booking to wrong property.
14. Central reservation cancels property booking.
15. Property loses internet during central booking.
16. User switches property but cached data remains.
17. Cross-property report double counts inter-property transfer.
18. Corporate statement includes wrong property.
19. Owner wants consolidated and property-specific profit/loss.
20. Support ticket must identify correct property.

## 12. Implementation Phases

### 12.0 Enterprise World-Class Feature Matrix

This matrix compares the world-class Enterprise feature set against the current product line.

Status meanings:

- `Existing simple`: already exists in Starter/Standard/Pro or shared app, and lower tiers should remain simple.
- `Enterprise foundation`: started in the Enterprise branch but not mature enough to call world-class.
- `Missing`: not meaningfully built yet.
- `Add-on`: should require explicit Enterprise add-on activation.
- `Shared infrastructure`: may use existing lower-tier concepts, but deep behavior belongs in Enterprise.

Implementation rule:

- Build Enterprise depth without cluttering Starter, Standard, or Pro.
- Reuse shared data/contracts where sensible, but hide advanced controls unless Enterprise gates pass.
- Every feature below must include property-level customization where practical.

| # | Feature Area | Current State | Mega Plan Coverage | Build Direction |
|---|---|---|---|---|
| 1 | True hotel folio ledger | Existing simple booking charges and Enterprise folio foundation | Phase 5 | Build Enterprise folio ledger with folio lines, transfers, split billing, void/reversal audit, close/reopen rules, guest/company/master allocation, and folio documents. Lower tiers keep simple booking receipts/invoices. |
| 2 | Night audit | Existing light night-audit/reporting concepts | Phase 5, reporting edge cases | Build Enterprise daily close: room charge posting, arrivals/departures/no-show checks, open-balance checks, date locks, exceptions, audit pack, and rollback/manager override rules. Lower tiers keep lightweight reports. |
| 3 | Rate management | Simple room rates and Enterprise rate-plan foundation | Phase 4, Phase 8, Phase 10 | Build Enterprise rate calendar, seasons, weekday/weekend rules, occupancy rules, min stay, closed-to-arrival/departure, package rates, corporate rates, and approval/audit. Lower tiers keep simple room rate fields. |
| 4 | Corporate accounts/debtors | Enterprise foundation started | Phase 9 | Build credit limits, billing profiles, statements, debtor aging, payment allocation, suspension rules, contacts, tax details, and document templates. Add-on entitlement required. |
| 5 | Group bookings | Existing multi-room/group invoice model plus Enterprise group foundation | Phase 9 | Build group blocks, pickup/release, rooming lists, group check-in/out, group folio, group documents, and room allocation workflows. Keep existing multi-room bookings stable for lower tiers. |
| 6 | Housekeeping command center | Existing simple housekeeping plus Enterprise advanced board | Phase 4, Phase 10 | Build assignments, attendants, supervisor inspection, custom statuses, refused service, room readiness, linen integration, SLA timers, mobile view, and productivity reporting. Lower tiers keep simple clean/dirty flow. |
| 7 | Maintenance management | Existing maintenance tickets | Current app preservation plus operations | Build Enterprise out-of-order/out-of-service controls, room inventory blocking, downtime reports, preventive maintenance, escalation, attachments, and room history. Lower tiers keep simple tickets. |
| 8 | Channel manager foundation | Contract-backed foundation exists: workflow workspace, channel sync queue table/RPC, idempotency key requirement, and audit event path | Phase 8/10 direction | Continue from the add-on contract into channel mapping, source mapping, availability/rate sync queue, reservation import, conflict handling, and provider adapters. Do not fake live OTA integration. |
| 9 | Payment gateway/payment links | Payment foundation, manual commercial flow, payment-link request table/RPC, and controlled workflow workspace exist | Phase 8 | Continue into verified provider configs, server-side checkout, webhook verification, reconciliation, failed/expired payment handling, and provider status. Add-on entitlement required. Client requests must not mark money as paid. |
| 10 | Guest messaging | Contract-backed foundation exists: workflow workspace and guest-message storage contract | Phase 10 guest experience | Continue into template engine for email/WhatsApp/SMS-ready messages, pre-arrival, check-in, balance reminder, no-show, cancellation, post-stay, and custom triggers. Keep transport provider configurable. |
| 11 | Hotel command center | Enterprise Hotel Dashboard exists | Phase 4, Command Central control plane | Expand into operational command center: arrivals, departures, in-house, no-shows, dirty rooms, maintenance blocks, unpaid balances, VIPs, groups, tasks, alerts, and exceptions. |
| 12 | Multi-property management | Contract-backed add-on foundation exists: gated route/workspace and Enterprise workflow records/events | Phase 10 | Continue into property switcher, central dashboard, consolidated reports, cross-property permissions, shared corporate accounts, group-level settings, and property isolation. Add-on entitlement required. |
| 13 | Hotel roles and permissions | Shared role/capability model exists | Definition of done | Add hotel roles/capabilities: night auditor, housekeeping supervisor, housekeeper, revenue manager, GM, maintenance, finance/debtors, group sales. Do not infer permission from visible UI. |
| 14 | Advanced reporting | Existing reports, Enterprise KPI estimates, and report snapshot contract exist | Phase 5, Phase 10 | Continue into Enterprise reports: occupancy by room type, ADR/RevPAR, pickup, pace, channel/source, no-show/cancellation, debtor aging, housekeeping productivity, maintenance downtime, rate performance, and group pickup. |
| 15 | Guest profiles/CRM | Existing Guests screen/customer credit plus CRM notes contract and gated workspace exist | Phase 10 guest experience | Continue into Enterprise guest preferences, VIP tags, stay history, incidents, blacklist/watchlist controls, company affiliation, lifetime value, document history, and consent/preferences. Lower tiers keep simple guest records. |
| 16 | Document system | Receipts/PDFs, commercial PDFs, and Enterprise document contract exist | Phase 5/7 | Continue standardizing Enterprise documents: folio, tax invoice, pro-forma, quote, registration card, group contract, corporate statement, payment receipt, cancellation/no-show notice, and branded templates. |
| 17 | Check-in/check-out workflow | Existing booking status flow | Phase 4 edge cases | Build Enterprise arrival/departure workflows: checklist, ID/document capture, deposit check, room assignment, key/card notes, signatures, balance settlement, late checkout, and room status handoff. |
| 18 | No-show/cancellation workflow | Basic cancellation/refund support and no-show board foundation | Phase 4, edge cases | Build configurable no-show/cancellation policies, fee retention, deposit handling, room release, audit reasons, guest/customer-credit outcomes, and reporting. |
| 19 | Custom booking website add-on | Public booking site exists; marketing builder exists | Phase 8 | Build Enterprise custom website package: branded pages, room type pages, offers/packages, inquiry forms, quote request, optional payment links, domain/branding workflow, and Command Central activation. |
| 20 | Guest portal add-on | Contract-backed foundation exists: gated route/workspace and guest portal request table/RPC contract | Phase 10 | Continue into guest self-service portal: view booking, pay/request payment link, upload details, request changes, message property, view documents, and pre-arrival tasks. Add-on entitlement required. |
| 21 | Revenue manager add-on | Rate/KPI foundations plus revenue recommendation contract and gated workspace exist | Phase 10 advanced rates | Continue into demand calendar, pickup/pace insights, manual competitor notes, pricing recommendations, forecast, restrictions suggestions, and approval workflow. Add-on entitlement required. |
| 22 | Operations compliance add-ons | Linen/lost/incident/visitor/emergency foundations plus compliance workspace and shared Enterprise event contract exist | Phase 10 | Continue maturing linen/laundry, lost and found, incident log, visitor register, emergency list, shift handover, exports, privacy controls, retention rules, and manager-only visibility. |
| 23 | Staff operations/workforce add-on | Existing staff/admin foundations and hotel role templates exist, but no full workforce module | Future Enterprise add-on | Build staff scheduling, attendance, task assignment, shift handover, training checklists, casual worker tracking, and productivity reports. Add-on entitlement required when requestable. |
| 24 | Maintenance and asset management add-on | Existing maintenance tickets plus Enterprise maintenance foundation exist, but no full asset registry | Future Enterprise add-on | Build property asset registry, equipment service history, preventive schedules, warranties, technician/vendor workflows, downtime analytics, and cost reporting. Lower tiers keep simple tickets. Add-on entitlement required when requestable. |
| 25 | Events and venue management add-on | Events & Venues foundation exists for bookings/line items/payments, but advanced event operations are not complete | Future Enterprise add-on | Build event pipeline, venue availability, package builder, banquet/event orders, supplier coordination, timelines, group-room linkage, deposits/milestones, documents, settlement, and profitability reporting. Add-on entitlement required when requestable. |

### 12.0.1 Customization Requirements By Feature

Each feature implementation must include a customization checklist.

Minimum customization expectations:

- Folios: charge categories, folio types, document branding, tax labels, approval rules, close/reopen permissions.
- Night audit: business day close time, required checks, exception tolerances, manager override rules, audit pack sections.
- Rates: seasons, restrictions, packages, corporate rate labels, approval flow, rounding/currency rules.
- Corporate accounts: payment terms, credit limits, statement templates, debtor aging buckets, tax fields.
- Groups: block statuses, release rules, rooming-list import columns, group document templates.
- Housekeeping: room statuses, inspection steps, attendant assignment rules, SLA timers, linen categories.
- Maintenance: ticket categories, severity, out-of-order/out-of-service labels, escalation rules, downtime reporting.
- Channel manager: channel names, source mapping, sync cadence, overbooking rules, fallback behavior.
- Payments: provider, currency, deposit policy, payment link expiry, reconciliation rules, proof-of-payment workflow.
- Messaging: templates, triggers, language, opt-in/out, sender identity, escalation rules.
- Command center: dashboard widgets, alert thresholds, daily focus filters.
- Multi-property: property groups, cross-property roles, consolidated report defaults, shared account rules.
- Roles: custom role names, capabilities, approval powers, restricted reports.
- Reports: visible columns, saved filters, export formats, scheduled report preferences.
- Guest CRM: VIP categories, preferences, consent fields, blacklist/watchlist reasons.
- Documents: logo, footer, numbering, legal text, tax/VAT copy, signature blocks.
- Check-in/out: required fields, ID rules, deposit rules, signature rules, room readiness gates.
- No-show/cancellation: fee policy, retention rules, release timing, reason categories, refund/customer-credit outcomes.
- Custom website: brand colors, domain, images, offers, room type display, inquiry fields.
- Guest portal: visible actions, required uploads, message categories, payment request behavior.
- Revenue manager: forecast assumptions, rate recommendation thresholds, approval rules.
- Compliance add-ons: categories, retention, restricted visibility, export formats, incident severity.

### 12.0.2 Lower-Tier Compatibility For Shared Concepts

Some Enterprise features share concepts with lower tiers. Implement them as layered capabilities.

Rooms:

- Starter/Standard/Pro: keep simple rooms, simple type text, rate, occupancy, status, basic housekeeping.
- Enterprise: add structured room types, floor/section, room attributes, inventory grouping, room move audit, out-of-order/out-of-service, and hotel room readiness.

Night Audit:

- Lower tiers: simple daily summary and existing reports.
- Enterprise: formal daily close with locked business date, room charge posting, exception resolution, folio checks, and audit pack.

Housekeeping:

- Lower tiers: simple clean/dirty/maintenance status.
- Enterprise: assignments, inspection, supervisor approval, linen/laundry, maintenance escalation, and productivity reports.

Maintenance:

- Lower tiers: ticket tracking.
- Enterprise: room availability blocking, downtime, preventive schedules, escalation, and full room history.

Guests:

- Lower tiers: basic customer record, payments/prepayments visibility, blacklist where already supported.
- Enterprise: CRM preferences, VIPs, stay history, company links, consent, incidents, and personalization.

Reports:

- Lower tiers: operational and financial summaries already present.
- Enterprise: hotel KPIs, pace/pickup, channel/source, debtor, housekeeping, maintenance, rate, and group reports.

Documents:

- Lower tiers: existing receipts/invoices.
- Enterprise: customizable hotel document suite and branded templates.

### 12.0.3 Detailed Enterprise Build Requirements

This section is intentionally detailed. Implementation agents must treat it as the working Enterprise backlog, not as optional inspiration.

Each item must be implemented with:

- Enterprise/property/add-on/capability gating where applicable;
- server-side lodge isolation;
- audit history for operationally or financially meaningful changes;
- customization settings where listed;
- regression tests for lower-tier non-clutter;
- clear labels when values are estimates rather than authoritative financial truth.

#### 1. True Hotel Folio Ledger

Build a real Enterprise folio ledger, separate from the current simple booking-charge foundation.

Required capabilities:

- create guest folios per booking/stay;
- create additional folios for incidentals, company charges, group charges, and split billing;
- post room charges to folio through an authoritative RPC;
- post service/extra charges such as minibar, laundry, room service, damages, late checkout, early check-in, tourism levy, and custom fees;
- transfer charges between folios;
- split a folio by guest, company, department, date range, charge type, percentage, or manual line selection;
- allocate payments across folio lines without double-counting booking payments;
- support company-paid room and guest-paid extras;
- support group master folio plus individual guest extras;
- void/reverse folio lines with reason, actor, timestamp, and before/after audit;
- close, reopen, and lock folios based on role/capability;
- prevent checkout when configured required folio checks fail;
- generate folio statement, pro-forma folio, final invoice, and receipt PDFs;
- expose folio balance, deposits, payments, refunds, transfers, and adjustments;
- support offline-safe pending local folio actions only if replay uses the same RPC/idempotency contract.

Customization:

- charge categories;
- folio types;
- tax/VAT labels;
- document numbering;
- mandatory close checks;
- manager override rules;
- line-item templates;
- approval thresholds;
- default split rules for corporate/group bookings.

Do not:

- mutate `bookings.amount_paid` directly;
- compute final settlement in React;
- treat cache-derived balances as authoritative;
- replace the existing lower-tier simple receipt flow.

#### 2. Night Audit

Build Enterprise night audit as a formal daily close workflow.

Required capabilities:

- define hotel business date and close time;
- run pre-close checks for unresolved arrivals, departures, no-shows, open folios, unpaid balances, dirty occupied rooms, out-of-order rooms, pending room moves, and failed payment/folio postings;
- post daily room charges where the folio model requires it;
- record audit close batch with actor, timestamp, business date, exceptions, overrides, and generated reports;
- lock closed business dates for normal edits;
- allow privileged reopen/reversal workflow with reason and audit;
- generate night audit pack PDF/export;
- separate revenue recognition from cash movement;
- detect stale cache/report data before close;
- show warnings for local/offline pending operations before close;
- include occupancy, ADR, RevPAR, room revenue, payments, taxes, refunds, deposits, house-use, complimentary rooms, no-shows, cancellations, and exceptions.

Customization:

- close time;
- required checks;
- optional checks;
- exception tolerances;
- override roles;
- audit pack sections;
- report recipients;
- document branding.

Lower tiers:

- keep simple daily summaries and current reporting;
- do not force formal hotel close on Starter, Standard, or Pro.

#### 3. Rate Management

Build Enterprise rate management as a rate calendar and rule engine.

Required capabilities:

- rate calendar by room type and date;
- base, weekday, weekend, seasonal, holiday, event, and peak rates;
- minimum stay;
- maximum stay;
- closed-to-arrival;
- closed-to-departure;
- stop-sell;
- occupancy-based rate rules;
- package rates;
- corporate negotiated rates;
- group block rates;
- promo codes or named offers;
- child/adult occupancy pricing where needed;
- rate override approval and audit;
- rate preview before publishing;
- conflict detection between overlapping rules;
- public website/channel-ready availability and rate export contract;
- clear fallback to simple room rate when no Enterprise rate rule applies.

Customization:

- seasons;
- rate rule names;
- rounding rules;
- currency;
- tax-inclusive/tax-exclusive display;
- approval thresholds;
- default restrictions;
- package inclusions;
- corporate rate labels.

Lower tiers:

- keep simple room rate fields;
- optional small improvement: room type selection may appear when harmless, but complex rate calendar stays Enterprise.

#### 4. Corporate Accounts And Debtors

Build Enterprise corporate account management as a B2B billing module.

Required capabilities:

- company profiles;
- billing contacts;
- tax/VAT details;
- credit limits;
- payment terms;
- negotiated rates;
- authorized bookers;
- linked guests/stays;
- master folios;
- company statements;
- debtor aging;
- payment allocation;
- partial payment handling;
- credit note/adjustment workflow;
- over-limit warning and blocking rules;
- account suspension;
- statement PDF/export;
- audit trail for credit-limit and term changes.

Customization:

- payment terms;
- statement layout;
- aging buckets;
- credit-limit enforcement strictness;
- company categories;
- required billing fields;
- tax copy;
- approval roles.

Add-on:

- Corporate Accounts should require explicit Enterprise add-on entitlement unless product strategy later includes it by default.

#### 5. Group Bookings

Build Enterprise group booking workflows on top of the existing multi-room/group-invoice foundation.

Required capabilities:

- group block creation;
- block name, source, contact, company, check-in, check-out, release date, cutoff date, rate, deposit, and notes;
- room block inventory by room type and date;
- pickup tracking;
- unsold-room release;
- rooming list import;
- rooming list validation;
- group member assignment to rooms;
- group check-in;
- group check-out;
- master folio;
- individual guest extras;
- group documents/contracts;
- group cancellation policy;
- reporting for pickup, released rooms, revenue, and outstanding balances.

Customization:

- group statuses;
- release rules;
- rooming-list columns;
- contract template;
- deposit policy;
- approval roles;
- default billing split.

Lower tiers:

- preserve existing direct multi-room bookings and accommodation group invoice behavior.

#### 6. Housekeeping Command Center

Build Enterprise housekeeping as a command center, not just a status field.

Required capabilities:

- room attendant assignment;
- supervisor assignment;
- clean/dirty/inspected/out-of-service/out-of-order/custom statuses;
- inspection checklist;
- failed inspection workflow;
- refused service;
- do-not-disturb;
- room readiness timer;
- checkout cleaning queue;
- stayover cleaning queue;
- arrival priority;
- late checkout impact;
- maintenance escalation from housekeeping;
- linen usage/shortage integration;
- mobile-friendly housekeeping view;
- productivity report by attendant;
- supervisor dashboard.

Customization:

- housekeeping statuses;
- checklist items;
- attendant teams;
- SLA timers;
- inspection requirement rules;
- linen categories;
- escalation rules;
- mobile visibility.

Lower tiers:

- keep simple clean/dirty/maintenance flow.

#### 7. Maintenance Management

Upgrade Enterprise maintenance without disrupting the current lower-tier ticket flow.

Required capabilities:

- out-of-order room status;
- out-of-service room status;
- prevent sale of blocked rooms;
- maintenance tickets linked to rooms, equipment, area, or general property;
- severity and priority;
- photos/attachments;
- assignment;
- due dates;
- preventive maintenance schedules;
- downtime tracking;
- room return-to-service workflow;
- maintenance history per room;
- housekeeping escalation;
- reporting on downtime, recurring issues, and average repair time.

Customization:

- ticket categories;
- severity labels;
- room block types;
- escalation rules;
- preventive schedule templates;
- required close fields.

Lower tiers:

- retain simple maintenance tickets.

#### 8. Channel Manager Foundation

Build the channel manager foundation before any live OTA integration.

Required capabilities:

- channel catalog;
- source mapping;
- room type mapping;
- rate plan mapping;
- availability export queue;
- rate export queue;
- reservation import queue;
- cancellation import queue;
- idempotency keys for imported reservations;
- conflict/overbooking detection;
- manual review queue for uncertain imports;
- audit history for every channel message;
- retry/dead-letter handling;
- safe mode where sync is disabled but mappings remain;
- readiness screen showing what is configured and what is missing.

Customization:

- channel names;
- sync cadence;
- room/rate mappings;
- overbooking rules;
- manual approval thresholds;
- fallback behavior.

Do not:

- fake live Booking.com/Expedia integration;
- mark sync as successful without provider confirmation;
- bypass authoritative booking conflict checks.

#### 9. Payment Gateway And Payment Links

Build payment gateway support as property-owned payment processing, not Boroko-as-merchant.

Required capabilities:

- provider configuration per property;
- test/live mode;
- public key/secret storage server-side only;
- payment links for deposits, balances, folios, pro-formas, and booking intents;
- payment intent table;
- booking intent table;
- provider checkout creation;
- webhook signature verification;
- late webhook handling;
- duplicate webhook idempotency;
- failed, expired, abandoned, and mismatched payment states;
- reconciliation report;
- manual proof-of-payment workflow remains available;
- payment status must be confirmed only server-side.

Customization:

- provider;
- currency;
- deposit policy;
- payment link expiry;
- payment methods;
- payment instructions;
- reconciliation rules;
- proof-of-payment review workflow.

Add-on:

- Online Payment Gateway requires explicit Enterprise add-on entitlement.

#### 10. Guest Messaging

Build guest messaging as configurable templates and triggers.

Required capabilities:

- pre-arrival messages;
- check-in instructions;
- balance reminder;
- payment link message;
- cancellation confirmation;
- no-show notice;
- post-stay thank-you;
- review request;
- custom manual message;
- template variables;
- opt-in/opt-out handling;
- delivery status;
- retry/failure tracking;
- message history on guest profile and booking;
- WhatsApp/email/SMS-ready provider abstraction.

Customization:

- templates;
- trigger timing;
- language;
- sender identity;
- channels enabled;
- escalation rules;
- opt-in text.

#### 11. Hotel Command Center

Expand Hotel Dashboard into a full operational command center.

Required capabilities:

- today’s arrivals;
- today’s departures;
- in-house guests;
- no-shows;
- dirty rooms;
- inspection queue;
- maintenance blocks;
- room moves;
- unpaid balances;
- open folio exceptions;
- VIPs;
- groups in house;
- late checkouts;
- early check-ins;
- task list;
- manager alerts;
- night-audit readiness;
- quick actions with role/capability checks.

Customization:

- visible widgets;
- alert thresholds;
- default date scope;
- department filters;
- priority rules;
- dashboard layout.

#### 12. Multi-Property Management

Build multi-property as a controlled Enterprise add-on.

Required capabilities:

- property group;
- central office dashboard;
- property switcher;
- cross-property role assignments;
- per-property isolation;
- consolidated reports;
- property-specific reports;
- shared guest profile strategy;
- shared blacklist/watchlist strategy;
- shared corporate accounts where enabled;
- inter-property booking visibility rules;
- support ticket property identification;
- cross-property audit trail.

Customization:

- property groups;
- cross-property permissions;
- shared-account rules;
- report defaults;
- currency/tax handling;
- central office roles.

#### 13. Hotel Roles And Permissions

Extend the existing capability model with hotel-specific roles.

Required roles/capability areas:

- night auditor;
- housekeeping supervisor;
- housekeeper;
- maintenance;
- finance/debtors;
- revenue manager;
- group sales;
- general manager;
- front office manager;
- reservations agent.

Required capabilities:

- view/manage folios;
- close/reopen night audit;
- override rate restrictions;
- approve discounts;
- approve refunds;
- manage corporate credit;
- manage groups;
- inspect rooms;
- mark room out of order;
- configure rates;
- export sensitive reports.

Customization:

- custom role names;
- role templates;
- capability overrides;
- approval powers;
- report restrictions.

#### 14. Advanced Reporting

Build Enterprise reporting beyond current summaries and KPI estimates.

Required reports:

- occupancy by date and room type;
- ADR;
- RevPAR;
- pickup;
- pace;
- source/channel;
- cancellation/no-show;
- debtor aging;
- corporate account balances;
- group pickup;
- rate performance;
- housekeeping productivity;
- room downtime;
- maintenance recurring issues;
- tax/VAT;
- deposits/liabilities;
- folio exceptions;
- night audit pack.

Customization:

- columns;
- saved filters;
- scheduled reports;
- export format;
- date basis;
- revenue recognition basis;
- department visibility.

#### 15. Guest Profiles And CRM

Extend Guests into Enterprise CRM without cluttering lower tiers.

Required capabilities:

- stay history;
- lifetime value;
- preferences;
- VIP tags;
- blacklist/watchlist;
- company affiliation;
- corporate authorized guest;
- incidents linked to guest;
- lost-and-found links;
- document history;
- messaging history;
- consent/preferences;
- nationality/ID/passport details where configured;
- duplicate detection.

Customization:

- VIP categories;
- preference fields;
- required fields;
- consent wording;
- blacklist reasons;
- watchlist visibility.

#### 16. Document System

Build a unified Enterprise document system.

Required documents:

- booking confirmation;
- registration card;
- guest folio;
- pro-forma invoice;
- tax invoice;
- payment receipt;
- refund receipt;
- corporate statement;
- group contract;
- group rooming list;
- cancellation notice;
- no-show notice;
- night audit pack;
- housekeeping report;
- maintenance report.

Customization:

- logo;
- colors;
- footer;
- legal text;
- numbering;
- tax labels;
- signature blocks;
- terms and conditions;
- language.

#### 17. Check-In And Check-Out Workflow

Build hotel-grade arrival and departure workflows.

Required check-in capabilities:

- arrival checklist;
- ID/passport capture where configured;
- registration card;
- deposit/prepayment check;
- room assignment;
- room readiness check;
- key/card note;
- guest preferences;
- special requests;
- signature capture or confirmation;
- group check-in handling.

Required check-out capabilities:

- folio review;
- payment settlement;
- company/guest split confirmation;
- late checkout fee;
- room status handoff;
- receipt/invoice generation;
- checkout block when required checks fail;
- manager override with reason.

Customization:

- checklist steps;
- required documents;
- deposit rules;
- room readiness gates;
- signature rules;
- settlement rules.

#### 18. No-Show And Cancellation Workflow

Build configurable hotel no-show and cancellation handling.

Required capabilities:

- mark no-show;
- release room inventory;
- retain deposit/fee according to policy;
- move retained amount to revenue/liability correctly;
- transfer refundable amount to customer credit where configured;
- cancellation reason categories;
- cancellation fee rules;
- no-show reporting;
- guest messaging;
- manager override;
- audit trail.

Customization:

- policy by rate plan/booking source;
- fee amount/percentage;
- free-cancellation windows;
- reason categories;
- deposit-retention behavior;
- customer-credit behavior.

#### 19. Custom Booking Website Add-On

Build Enterprise custom website as a paid add-on, separate from the existing public booking site baseline.

Required capabilities:

- branded property website;
- custom domain workflow;
- room type pages;
- package/offer pages;
- image/gallery management;
- inquiry forms;
- quote request forms;
- direct booking flow where enabled;
- payment link support where payment gateway add-on is enabled;
- SEO metadata;
- analytics-ready events;
- Command Central activation and setup status.

Customization:

- brand colors;
- logo;
- hero images;
- room type descriptions;
- offer content;
- inquiry fields;
- domain;
- policies and terms.

#### 20. Guest Portal Add-On

Build guest self-service as an Enterprise add-on.

Required capabilities:

- guest can view booking;
- guest can view balance;
- guest can request payment link;
- guest can upload required details;
- guest can request date/room changes;
- guest can message property;
- guest can view documents;
- guest can complete pre-arrival tasks;
- guest can see cancellation policy;
- property can approve/deny guest requests.

Customization:

- visible actions;
- required upload fields;
- message categories;
- payment behavior;
- portal branding;
- terms and privacy copy.

#### 21. Revenue Manager Add-On

Build revenue management as an Enterprise add-on layered on rates and reports.

Required capabilities:

- demand calendar;
- pickup report;
- pace report;
- occupancy forecast;
- manual competitor notes;
- event/holiday demand markers;
- recommended rate changes;
- restriction recommendations;
- approval workflow;
- rate-change audit.

Customization:

- forecast assumptions;
- recommendation thresholds;
- comp set labels;
- approval roles;
- rate floors/ceilings;
- alert thresholds.

#### 22. Operations Compliance Add-Ons

Mature the operational add-on foundations.

Required capabilities:

- linen/laundry inventory;
- laundry batches;
- damaged/missing linen tracking;
- lost-and-found intake;
- lost-and-found claim/return/disposal workflow;
- incident log;
- restricted incident visibility;
- visitor register;
- visitor checkout;
- emergency/evacuation list;
- shift handover log;
- exports for compliance;
- retention/privacy controls.

Customization:

- linen categories;
- lost item categories;
- incident severity;
- incident visibility;
- visitor purpose categories;
- emergency list fields;
- handover categories;
- export format;
- data retention rules.

#### 23. Staff Operations and Workforce Add-On

Build staff operations as a hotel Enterprise add-on layered on existing staff/admin permissions, not as default clutter for smaller properties.

Boundary:

- This add-on overlaps with existing `staff`, `hotel_roles`, and `operations_compliance`, but it should not be merged into them.
- `staff` remains the simple staff/user management surface.
- `hotel_roles` supplies role templates and permissions.
- `operations_compliance` supplies incident, visitor, emergency, handover, and compliance records.
- Staff Operations & Workforce is the higher-level workforce operating layer: rosters, attendance, tasking, training, handovers, and productivity.
- Technical implementations may share staff profile, role, audit, workflow-event, and reporting contracts.

Required capabilities:

- staff profile extensions for departments, positions, employment type, and availability;
- shift scheduling by department and outlet;
- clock-in/clock-out or attendance import;
- task assignment for front desk, housekeeping, maintenance, restaurant, events, and management;
- shift handover notes;
- daily duty rosters;
- training and checklist completion;
- casual/temporary worker tracking;
- absence, lateness, and replacement notes;
- productivity reports by department, role, and shift;
- manager approval for schedule changes where configured;
- role/capability enforcement for roster edits, attendance edits, and private staff notes.

Customization:

- departments;
- roles/job titles;
- shift templates;
- attendance rules;
- overtime/late thresholds;
- task categories;
- checklist templates;
- approval roles;
- privacy rules for staff notes.

Lower tiers:

- retain the current simpler Staff/admin behavior.
- Do not expose hotel workforce scheduling, attendance, or productivity dashboards outside Enterprise hotel/lodge/resort contexts unless explicitly enabled.

Add-on:

- Staff Operations & Workforce should require explicit Enterprise add-on entitlement when it moves from planned to requestable.
- It may be sold individually or bundled inside the Enterprise Operations Suite.

#### 24. Maintenance and Asset Management Add-On

Build asset management as a hotel Enterprise add-on that deepens the existing maintenance ticket flow.

Boundary:

- This add-on is the premium expansion of existing maintenance and `maintenance_enterprise`, not a separate replacement for maintenance tickets.
- Lower tiers keep simple maintenance ticketing.
- Enterprise maintenance can continue to own room out-of-order/out-of-service logic, preventive maintenance, and downtime.
- Maintenance & Asset Management adds the full asset registry, equipment lifecycle, warranty/service history, technician/vendor workflow, asset costing, and asset-level reporting.
- Technical implementations may share maintenance ticket, room readiness, housekeeping escalation, report snapshot, audit, and attachment contracts.

Required capabilities:

- asset registry for rooms, equipment, vehicles, kitchen equipment, generators, pumps, HVAC, fire/safety equipment, and property infrastructure;
- asset location and ownership;
- warranty, supplier, serial number, purchase date, and replacement-value metadata;
- preventive maintenance schedules per asset;
- inspection checklists;
- service history;
- technician/vendor assignment;
- attachments/photos;
- downtime tracking;
- return-to-service approval;
- recurring-failure analytics;
- cost tracking by asset, room, area, and department;
- room-availability impact where the asset blocks sale or guest readiness;
- reporting for upcoming services, overdue inspections, downtime, repeated failures, and asset cost.

Customization:

- asset categories;
- service intervals;
- inspection checklist templates;
- downtime categories;
- escalation rules;
- technician/vendor lists;
- required close fields;
- report columns and export formats.

Lower tiers:

- keep simple maintenance tickets and room maintenance status.
- Do not force full asset records for ordinary ticket creation.

Add-on:

- Maintenance & Asset Management should require explicit Enterprise add-on entitlement when it moves from planned to requestable.
- It may be sold individually or bundled inside the Enterprise Operations Suite.

#### 25. Events and Venue Management Add-On

Build advanced Events & Venue Management as a hotel Enterprise add-on on top of the existing Events & Venues foundation.

Boundary:

- This add-on extends the existing Events & Venues/conference foundation; it must not replace the simpler conference/event flows already available to lower tiers.
- Basic venue-only, conference, and event booking behavior can remain in the current product.
- Group Operations remains responsible for group room blocks, pickup/release, rooming lists, and group check-in/out.
- Corporate Accounts remains responsible for company profiles, credit limits, statements, and debtor workflows.
- Advanced Folios/Documents remains responsible for folio allocation and formal documents.
- Events & Venue Management owns the event department layer: lead pipeline, venue/package design, banquet/event orders, timelines, supplier coordination, deposits/milestones, and post-event settlement/profitability.
- Technical implementations may share event booking, group operation, folio, POS/inventory, document, payment, and reporting contracts.

Required capabilities:

- event opportunity/lead pipeline;
- venue availability calendar;
- event package builder for venue hire, meals, equipment, accommodation, and extras;
- weddings, conferences, retreats, workshops, private dining, memorials, birthdays, and corporate events;
- event timelines, run sheets, setup/teardown tasks, and department assignments;
- menu and banquet linkage to POS/inventory where applicable;
- supplier coordination and cost tracking;
- deposits, milestones, cancellation terms, and payment schedule;
- event documents: quote, contract, pro-forma, banquet event order, invoice, and settlement statement;
- linked room blocks/group operations;
- event-specific folio/settlement handling without bypassing payment ledger rules;
- profitability and post-event reporting.

Customization:

- event types;
- venue types;
- package templates;
- deposit and cancellation rules;
- document templates;
- banquet task templates;
- supplier categories;
- approval roles;
- reporting categories.

Lower tiers:

- preserve existing conference/events behavior and public event/venue inquiry paths.
- Do not require hotels to use the advanced add-on for simpler venue-only or conference bookings that the current system already supports.

Add-on:

- Events & Venue Management should require explicit Enterprise add-on entitlement when it moves from planned to requestable.
- It may be sold individually or bundled inside the Events & Groups Suite.

### Phase 0: Truth and Documentation Cleanup

1. Confirm repo package version.
2. Confirm latest released desktop version separately from repository version.
3. Document TSA Bonno direction.
4. Document current subscription plan behavior.
5. Document intended Enterprise behavior.
6. Document Pro booking slug only.
7. Document Enterprise custom website/payment add-ons only.
8. Ensure `PROJECT_STATE.md` remains accurate.

### Phase 1: Subscription Plan Refactor

1. Add Enterprise to shared subscription order.
2. Add Enterprise plan metadata.
3. Change Pro limits.
4. Add Enterprise limits.
5. Add Enterprise aliases where appropriate.
6. Update upsell benefits.
7. Update recommendation logic.
8. Update subscription UI.
9. Remove Pro unlimited copy.
10. Add tests.

### Phase 2: Property Profile Setup

1. Add property type constants.
2. Add setup step asking what the client operates.
3. Add property type cards.
4. Add operating questions.
5. Save `property_type`.
6. Save `operation_style`.
7. Save `enabled_modules`.
8. Save `relevant_modules`.
9. Preserve `business_type` compatibility.
10. Remove wording that calls every profile a lodge.

### Phase 3: Module Catalog and UI Visibility

1. Create shared module catalog.
2. Add visibility resolver.
3. Update navigation filtering.
4. Update subscription/access panels.
5. Add upgrade/add modules surface.
6. Add tests for locked, unlocked, hidden states.
7. Ensure Starter/Standard/Pro are not cluttered.

### Phase 4: Hotel Core

1. Room types.
2. Physical room inventory.
3. Floors/wings/sections.
4. Room attributes.
5. Hotel dashboard.
6. Arrivals/departures/in-house/no-show board.
7. Room moves.
8. Early check-in / late checkout.
9. Housekeeping board v1.
10. Hotel KPIs.

### Phase 5: Finance and Folio

1. Basic folio tables.
2. Folio ledger RPCs.
3. Room charge posting.
4. POS-to-folio posting.
5. Split billing.
6. Group/master invoice foundation.
7. Customer/company allocation.
8. Night audit readiness.
9. Reporting updates.

### Phase 6: Enterprise Add-on Foundation

1. Add add-on catalog.
2. Add entitlement merge logic.
3. Add add-on quote/request UI.
4. Add admin activation.
5. Add tests proving correct gating.

### Phase 7: Commercial Request and Command Central Activation

1. Add shared subscription/add-on request data contract.
2. Add in-app package/add-on builder in Settings/Subscription.
3. Generate downloadable quotation/pro-forma request from the app.
4. Submit structured app requests to backend/Command Central.
5. Add public website package builder with the same structured payload.
6. Generate downloadable quotation/pro-forma request from the website.
7. Add Command Central request inbox with selected plan/add-ons parsed.
8. Add Command Central quote-to-invoice/pro-forma workflow.
9. Add manual payment-review states.
10. Add audited admin activation for plan and individual add-ons.
11. Add entitlement refresh so activated features appear in the client app.
12. Add tests proving requests do not directly activate paid features.

### Phase 8: Custom Website and Payments Foundation

1. Booking intent table.
2. Payment intent table.
3. Payment provider config model.
4. Server-side checkout creation.
5. Webhook verification.
6. Payment/booking state machine.
7. App inbox alerts.
8. No change to existing Pro booking slug beyond compatibility.

### Phase 9: Corporate, Groups, and Advanced Folios

1. Company profiles.
2. Corporate accounts.
3. Group blocks.
4. Master folios.
5. Company statements.
6. Debtor aging.
7. Credit limits.
8. Rooming list import.

### Phase 10: Expanded Add-ons

1. Advanced rates.
2. Advanced housekeeping mobile.
3. Guest portal.
4. Multi-outlet POS Pro.
5. Linen/laundry.
6. Lost and found.
7. Incident log.
8. Visitor register.
9. Emergency list.
10. Multi-property dashboard.

## 13. Definition of Done For Enterprise Work

An Enterprise change is not done until:

1. It is behind correct plan/add-on/property/capability gates.
2. Starter, Standard, and Pro behavior is verified unchanged except for explicitly planned changes.
3. Critical mutations use authoritative RPCs.
4. Database behavior is atomic and concurrency-safe.
5. Retries are idempotent.
6. Authorization and lodge/property/outlet isolation are server-enforced.
7. Desktop, Manager PWA, Legacy POS, public site, offline replay, and reporting paths are checked when applicable.
8. Audit history remains financially consistent.
9. Focused tests pass.
10. Affected builds pass.
11. Migrations are deployed only after review.
12. Deployment status is stated accurately.
13. `PROJECT_STATE.md` is updated if architecture, risk, release state, or deployment assumptions change.
14. Command Central is updated when work changes plan, entitlement, add-on, quote, invoice, support, activation, or admin-review behavior.
15. Development Preview Mode is available for local review of Enterprise UI without granting production authority.
16. Client-facing package/add-on requests generate structured backend records and do not directly activate paid entitlements.

## 14. Verification Checklist For Reviewers

Use this checklist when another AI submits implementation:

1. Check `git status` and identify touched files.
2. Read diffs before running tests.
3. Confirm no unrelated refactors were mixed in.
4. Confirm no direct financial writes were introduced.
5. Search for client-authored `payment_status`.
6. Search for direct writes to `bookings.amount_paid`.
7. Confirm new financial paths use RPCs.
8. Confirm idempotency keys are stable on retry.
9. Confirm setup changes preserve old settings.
10. Confirm Starter/Standard/Pro navigation remains clean.
11. Confirm Enterprise modules are gated.
12. Confirm Pro caps are reflected in UI and logic.
13. Confirm public booking frontend does not trust price/payment state.
14. Confirm secrets are not exposed to frontend or renderer.
15. Confirm tests cover the changed contract.
16. Run the real scripts from `package.json`.
17. For SQL changes, inspect migrations and verify linked deployment separately when needed.
18. For UI changes, run the app and inspect the actual screens.
19. For release changes, consult `docs/SHIP_READY_RUNBOOK.md`.
20. Report repository state, deployment state, and release state separately.

## 15. Recommended First Implementation Task

The first implementation task should be:

> Implement the product foundation for the Enterprise Hotel tier and property-aware module visibility.

Strict scope:

1. Add Enterprise to subscription plans.
2. Cap Pro limits.
3. Add Enterprise usage limits.
4. Add Enterprise metadata and upsell benefits.
5. Add property type constants.
6. Add operating profile constants/helpers.
7. Add module catalog.
8. Add module visibility resolver.
9. Update setup to ask property type.
10. Update navigation to use property type/module visibility.
11. Update subscription panel to show Enterprise and Pro counters correctly.
12. Add tests for plan limits, property type mapping, entitlement merging, and module visibility.
13. Update docs.

Out of scope for first task:

- hotel folios;
- payment gateway integration;
- custom direct booking website;
- channel manager;
- multi-property;
- door-lock integration;
- advanced rate engine;
- broad brand rename;
- release publication.

## 16. Implementation Warning For Less Capable Agents

Do not implement this as a UI-only change.

Do not add Enterprise buttons that call existing Pro flows without new server contracts.

Do not hardcode plan checks in scattered components when a shared resolver is needed.

Do not show hotel-only modules to small guest houses just because they are locked.

Do not bypass current domain modules or Supabase RPCs.

Do not invent test scripts. Read `package.json` and use real scripts.

Do not claim production readiness from local code alone.

Do not touch updater identity, package identifiers, or public URLs as part of the Enterprise foundation.

Do not make payment success pages authoritative.

Do not create a second offline model for hotel features.

Build carefully, behind gates, and verify each surface before claiming completion.
