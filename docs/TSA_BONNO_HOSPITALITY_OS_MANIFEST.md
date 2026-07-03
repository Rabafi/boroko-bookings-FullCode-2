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

## 4. Product Model

### 4.1 Separate Concepts

The system must separate four concepts:

1. Property type: what the client operates.
2. Subscription plan: what package the client pays for.
3. Operating modules: which operational areas are relevant and enabled.
4. Enterprise add-ons: which advanced paid modules are activated.

Do not collapse these into one field.

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

## 9. Public Booking, Custom Website, and Payments

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

### Phase 7: Custom Website and Payments Foundation

1. Booking intent table.
2. Payment intent table.
3. Payment provider config model.
4. Server-side checkout creation.
5. Webhook verification.
6. Payment/booking state machine.
7. App inbox alerts.
8. No change to existing Pro booking slug beyond compatibility.

### Phase 8: Corporate, Groups, and Advanced Folios

1. Company profiles.
2. Corporate accounts.
3. Group blocks.
4. Master folios.
5. Company statements.
6. Debtor aging.
7. Credit limits.
8. Rooming list import.

### Phase 9: Expanded Add-ons

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
