# Restaurant POS Product Plan

Last reviewed: 2026-07-08

This document focuses only on turning Boroko's existing restaurant-only mode into a sellable restaurant operating system built around POS. It does not replace the lodge, guest house, hotel, resort, or Enterprise PMS architecture.

## Product Position

Restaurant mode should be sold as a restaurant POS and operations system, not as a hospitality PMS with some screens hidden and not as a narrow cash-register-only tool.

The buying category should stay simple:

```text
Boroko Restaurant POS
```

The value proposition should be broader:

```text
POS, stock, staff, cash-up, and owner control for restaurants.
```

Working product names:

- Boroko POS for Restaurants
- Boroko Restaurant POS
- Boroko Food & Beverage POS
- Boroko Restaurant Manager

The product should feel built for:

- quick-service restaurants;
- cafes and coffee shops;
- bars and lounges;
- lodge/hotel restaurants that need standalone outlet control;
- small multi-outlet food businesses;
- owner-managed restaurants that need sales, stock, staff, and cash control without room-booking features.

## Customer-Wow Standard

Restaurant POS is a crowded market. Boroko Restaurant POS should not compete by having a long feature checklist only. It should compete by feeling safer, clearer, and more owner-aware than generic POS products.

The product should wow customers in the first demo by showing:

- an order can be created quickly without training;
- the kitchen/bar sees exactly what to prepare;
- the owner can see live sales and cash risk from their phone;
- stock impact is understandable, not hidden in accounting language;
- end-of-day cash-up catches mistakes before they become losses;
- discounts, voids, refunds, and drawer opens are controlled and auditable;
- the app still works during bad internet and clearly shows what is pending;
- the restaurant owner never sees hotel/room/booking language unless they also run accommodation.

The strongest product promise:

```text
Boroko Restaurant POS helps owners sell faster, control cash, control stock, manage staff, and see where money is leaking.
```

Everything in restaurant mode should support that promise.

## Product Differentiators

These are the differentiators that should shape design and implementation choices.

### 1. Owner Control, Not Just Cashier Speed

Many POS systems are good at taking orders but weak at owner oversight. Boroko should make owner control visible:

- suspicious void/discount/refund alerts;
- cashier variance summaries;
- item margin warnings;
- stock variance warnings;
- low-stock and fast-moving-item alerts;
- manager approval log;
- daily owner digest.

### 2. Offline Honesty

Bad internet is normal for many target customers. The product should not pretend offline work is final.

Restaurant mode should clearly label:

- local pending orders;
- pending sync;
- failed sync;
- server-confirmed sales;
- cash-up records that still need server confirmation.

### 3. Restaurant Language Everywhere

The app must feel like restaurant software from the first screen:

- sales, not accommodation revenue;
- customers, not guests;
- tables/tabs/orders, not rooms/bookings/folios;
- end-of-day close, not hotel night audit unless the client is in hotel mode;
- ingredients and stock, not room supplies.

### 4. Stock Loss Visibility

Recipe costing is not just a back-office feature. It should answer practical owner questions:

- Why did we sell 100 burgers but use enough patties for 120?
- Which item has the worst margin?
- Which staff meal, wastage, or comp caused stock movement?
- What should we buy before the weekend?

### 5. Simple First, Deep Later

The first restaurant release should be easy to sell and demo. Do not bury the cashier in configuration screens.

The cashier flow should stay fast:

- choose order type;
- select table or takeaway;
- add items/modifiers;
- send to kitchen/bar;
- take payment;
- print/share receipt.

Advanced controls should live in manager/settings/report areas.

## Demo Script Acceptance

Each phase should be demoable. If a phase cannot be demonstrated simply, it is not ready for a customer-facing milestone.

### Phase 1 Demo

Show a restaurant login where:

- the sidebar contains only restaurant-relevant modules;
- Reports opens directly to POS Sales;
- no booking, room, occupancy, folio, check-in, or hotel KPI language appears in primary restaurant screens;
- Manager PWA shows restaurant metrics rather than accommodation metrics.

### Phase 2 Demo

Show:

- open a dine-in table;
- add burger and drinks with modifiers;
- send food to kitchen and drinks to bar;
- split or move a bill;
- apply a manager-approved discount or void;
- close the table and cash up.

### Phase 3 Demo

Show:

- burger recipe with bun, patty, lettuce, sauce, cheese, and packaging;
- sell two burgers;
- stock decreases by recipe quantities;
- wastage entry reduces stock separately from sales;
- stock count shows variance;
- item margin report shows food cost and gross margin.

### Phase 4 Demo

Show:

- customer earns loyalty;
- customer redeems loyalty or pays on account;
- delivery order records platform commission;
- multi-outlet owner sees outlet comparison;
- central menu change publishes only to selected outlets.

### Phase 5 Demo

Show:

- staff clock in and get assigned to a shift/drawer;
- waiter sales and cashier variance are visible to the manager;
- supplier purchase order is received into stock once;
- prep batch consumes ingredients and creates produced stock;
- end-of-day close shows sales, cash, stock, staff, and exception alerts;
- multi-outlet owner sees outlet performance without accommodation screens.

## Product Non-Goals Before First Sale

Do not block the first restaurant sale on:

- full accounting package replacement;
- every delivery platform integration;
- biometric time attendance;
- AI forecasting;
- public online ordering site;
- full franchise management;
- advanced loyalty campaign automation;
- complex recipe nutrition/allergen compliance.

These can become later upsells. First sale needs a clean restaurant POS, owner dashboard, cash-up, stock basics, staff/manager controls, and credible offline behavior.

## Market Positioning and Packaging

The product should be marketed as restaurant POS because that is the category customers already understand and search for. The product should be built as a broader restaurant operating system because that is where Boroko can become more valuable than a cheap till app.

Recommended positioning:

```text
Boroko Restaurant POS is a restaurant operations system built around a fast POS. It helps restaurants sell, manage tables and waiters, control stock, control cash, and give owners visibility from one place.
```

Do not lead with "restaurant operating system" alone in early marketing. It can sound abstract. Lead with "Restaurant POS" and immediately explain the operational control behind it.

### Suggested Packages

#### POS Starter

For small cafes, takeaways, bars, and owner-operated restaurants.

- counter sales;
- tables/tabs;
- receipts;
- basic POS reports;
- basic inventory and low-stock alerts;
- basic staff roles;
- cash-up.

#### Restaurant Pro

The recommended default package for serious restaurants.

- everything in POS Starter;
- waiter/server attribution;
- kitchen/bar routing;
- table management;
- manager-approved discounts, voids, and refunds;
- recipe costing;
- ingredient depletion;
- stock variance;
- cashier and drawer accountability;
- manager dashboard.

#### Restaurant Owner / Multi-Outlet

For restaurants with stronger controls, multiple outlets, or owner-managed growth.

- everything in Restaurant Pro;
- owner mobile dashboard;
- multi-outlet comparisons;
- central menu publishing;
- purchasing and supplier controls;
- outlet stock transfers;
- advanced staff performance;
- customer accounts, loyalty, vouchers, and delivery/platform tracking.

### Messaging Rules

- Use "Restaurant POS" in product names, navigation, package names, landing pages, and sales calls.
- Use "operations system" in supporting copy, demos, and pricing explanations.
- Do not describe the product as "just POS".
- Do not delay the first sale until every operating-system feature is built.
- Make the first sellable milestone clean, fast, and restaurant-only; then use the later phases as premium upsells.

## UX Rules for Restaurant Mode

- Primary cashier buttons must be large and touch-friendly.
- The order screen must prioritize speed over decoration.
- Kitchen/bar displays must be readable from a distance.
- Cash-up screens must make variance impossible to miss.
- Low-stock and failed-sync warnings must be visible without panic wording.
- Manager approval prompts must be short and clear.
- Reports should show money, order count, margin, variance, and exceptions before charts.
- Do not show restaurant users hotel add-ons as upsells unless they also selected an accommodation property type.

## Commercial Readiness Questions

Before selling restaurant mode, answer these honestly:

- Can a cashier learn the sale flow in under 10 minutes?
- Can an owner understand yesterday's sales, cash variance, top items, and stock alerts in under 2 minutes?
- Can a manager detect who approved each void, refund, and discount?
- Can the restaurant continue selling during internet issues?
- Can support explain what is server-confirmed versus pending local work?
- Can we demo stock loss using one real menu item?
- Does any primary restaurant screen still mention rooms, bookings, guests, folios, occupancy, check-in, or hotel KPIs?

## Architecture Decision

Restaurant mode should reuse the existing Boroko architecture:

- same Supabase authority model;
- same POS order, return, void, shift, cash-up, outlet, inventory, expense, audit, and reporting paths;
- same desktop app shell;
- same Manager PWA where relevant;
- same Legacy POS path where hardware/offline/older Windows support matters;
- same subscription and property-type gating.

The restaurant product should be created through curation, language, and guardrails rather than a forked architecture.

## Current Foundation

The repository already has the right foundation for restaurant mode:

- `property_type = restaurant` and `business_type = restaurant`;
- restaurant defaults that include POS, inventory, outlets, cash-up, staff, expenses, and reports;
- navigation filtering that hides bookings, rooms, guests, housekeeping, maintenance, folios, and hotel modules from restaurant sidebar navigation;
- POS order and return flows;
- inventory depletion and restoration paths;
- outlet enforcement;
- shift and cash-up contracts;
- Manager PWA POS reporting;
- Legacy POS as a separate deliverable for POS-heavy environments;
- offline and replay safeguards for critical POS work.

This means the product does not need a new backend model just to become restaurant-sellable.

## Immediate Sellability Gap

The current restaurant experience still leaks accommodation language and report assumptions.

The most visible issue is Reports:

- default tab is bookings/occupancy;
- header says occupancy and revenue analysis;
- booking, room, conference, day-use, prepayment, hotel KPI, room profitability, and room-supply concepts can appear in report flows;
- exports are still described as booking/occupancy report packs;
- Manager PWA reports still talk about occupancy, rooms occupied, accommodation revenue, and bookings usage.

For restaurant clients, this creates confusion. It makes the product feel like hotel software that happens to include POS.

## Restaurant Mode Cleanup

These changes should be done before selling restaurant mode as a restaurant POS package.

### Restaurant-Facing Curation Addendum

This addendum must be included in the next AI handover before later phase claims are accepted. The goal is to make restaurant mode feel like a restaurant product everywhere, not a lodge product with hidden navigation.

#### Dashboard

- Stop loading accommodation data in restaurant mode: bookings, rooms, conference bookings, rate overrides, occupancy forecast, upcoming check-ins, and booking-payment stats.
- Replace restaurant dashboard cards with real POS/restaurant metrics: today POS sales, order count, average ticket, open tables/tabs, low stock, today expenses, cash-up/variance warnings, and manager approvals needed.
- Hide Online Booking Requests, Running Room Specials, Outstanding Guest Balances, Booking Cash Today, Balance Collection Queue, Day Use Follow-up, 30-Day Occupancy Forecast, Recent Bookings, Upcoming Check-ins, and the Hotel Dashboard embed.
- Replace hidden accommodation sections with Recent Orders, Open Tables/Tabs, Kitchen/Bar Queue, Low Stock, Manager Attention, and Today's POS Summary.
- Add tests proving restaurant dashboard code does not render booking, room, occupancy, guest-stay, check-in, check-out, or hotel KPI sections.

#### POS

- In restaurant mode, hide Charge to Room, room selector, active booking lookup, folio charge language, guest/room labels, room service mode, and room folio credit on returns.
- Block booking, room, and folio POS actions in the domain/server path when `property_type = restaurant`, even if stale UI state or a direct call tries to submit them.
- Restaurant POS language should use tables, tabs, orders, bills, payments, discounts, voids, refunds, kitchen/bar, and cash-up.
- Lodge/hotel mode must keep room-charge and folio behavior where accommodation exists.
- Add tests proving restaurant mode POS cannot render or submit room-charge/folio paths.

#### Data Management

- Rename restaurant mode copy away from lodge, bookings, guests, rooms, check-in, and check-out.
- Hide booking, guest, room, check-in/check-out import templates in restaurant mode.
- Restaurant-safe imports should include inventory/ingredients, expenses, suppliers/purchases when supported, and menu/catalog when implemented.
- Restaurant-safe exports should include POS sales, stock/inventory, expenses, recipes, cash-up, staff/activity audit, and full restaurant backup.
- Backup copy should say restaurant or business, not lodge.

#### Expenses

- Hide room supplies and room maintenance automatic cost sections in restaurant mode.
- Replace expense language with restaurant categories: food stock, beverages, packaging, cleaning, utilities, staff, equipment, repairs, and delivery/platform fees.
- Automatic stock costs should reference inventory/ingredients, not room supplies.
- Add tests proving restaurant expenses do not show booking, lodge, room supply, or room-maintenance wording.

#### Staff

- Keep the shared staff foundation, but make restaurant mode defaults and language restaurant-first.
- Default new staff to cashier or supervisor, not receptionist.
- Prioritize restaurant roles: cashier, waiter/server, supervisor, manager, admin, and finance.
- Replace "this lodge" wording with restaurant/business wording.
- Later restaurant staff features should include clock-in/out, shift assignment, cashier drawer assignment, waiter sales attribution, manager PIN approval history, and staff meal/comp tracking.

#### Settings

- Rename lodge-facing labels in restaurant mode: Lodge Logo becomes Restaurant Logo or Business Logo; lodge examples become restaurant examples; reservations email placeholders become restaurant/admin placeholders.
- Hide accommodation-only settings: Online Booking Site, room stays, multi-room, full lodge, day use, events/venues, check-in/check-out times, house rules for guests, booking FAQ, and guest stay policies.
- Hide booking automation email toggles in restaurant mode unless rebuilt as restaurant receipt/customer messaging: booking confirmation, booking invoice, booking cancellation, and accommodation quotation emails.
- Future restaurant replacements should include POS receipt email, customer receipt settings, supplier/admin notifications, manager alerts, and online ordering settings when built.
- Document templates should show restaurant-safe templates only: POS receipt, tax receipt/invoice, cash-up report, stocktake sheet, supplier purchase order, and recipe cost sheet.

#### Global Guardrails

- Restaurant mode must not show primary UI text for rooms, bookings, guests, folios, occupancy, check-in, check-out, housekeeping, room supplies, full lodge, or hotel KPIs.
- Lodge, guest house, camp, motel, hotel, and resort modes must keep their existing accommodation behavior.
- Use property-type gates, not role hacks.
- Add structural tests scanning restaurant mode files for forbidden UI labels.
- Add route tests proving restaurant mode cannot access accommodation-only routes except through a clear redirect or not-available state.
- Add POS tests proving room-charge actions are unavailable and blocked in restaurant mode.

### Navigation and Routes

For `property_type = restaurant`, visible desktop navigation should focus on:

- Dashboard;
- POS;
- Inventory;
- Reports;
- Expenses;
- Staff;
- Settings;
- Assistant, if it uses restaurant-specific guidance;
- Data Management, if imports/exports are restaurant-safe.

Accommodation-only routes should either redirect to the restaurant dashboard or show a clear not-available state:

- bookings;
- quotations;
- invoices tied only to bookings;
- prepayments/customer credit if not positioned for restaurant tabs or deposits;
- room board;
- calendar;
- guests, unless converted into restaurant customers/loyalty;
- rooms;
- housekeeping;
- maintenance if it remains room/property-maintenance focused;
- folios;
- hotel dashboards and hotel reports;
- room moves;
- rate plans;
- channel manager;
- guest portal;
- guest CRM until reframed as customer CRM.

### Restaurant Language

Replace accommodation language in restaurant mode:

| Accommodation wording | Restaurant wording |
|---|---|
| Bookings | Orders / Reservations only if table booking exists |
| Guests | Customers |
| Rooms | Tables / Outlets / Service areas |
| Occupancy | Sales activity / Table usage |
| Check-in / check-out | Open order / close order |
| Folio | Tab / Account |
| Room supplies | Ingredients / consumables |
| Front desk | Cashier / manager |
| Night audit | End-of-day close |
| Housekeeping | Not shown unless a restaurant cleaning checklist feature exists |

### Restaurant Dashboard

Restaurant dashboard should show:

- today's gross sales;
- net sales after discounts/returns;
- open orders/tabs;
- completed orders;
- average order value;
- top-selling items;
- low-stock alerts;
- active shift;
- expected cash versus counted cash;
- unpaid tabs/accounts;
- voids and returns requiring manager attention;
- sales by outlet or service area.

It should not show:

- arrivals;
- departures;
- occupancy;
- rooms occupied;
- booking requests;
- room balances.

### Restaurant Reports

Restaurant reports should default to POS Sales.

Restaurant-safe tabs:

- POS Sales;
- Payment Methods;
- Cash-Up / Shift Close;
- Returns and Voids;
- Discounts and Comps;
- Top Items;
- Category Sales;
- Operator Sales;
- Outlet Sales;
- Stock Costs;
- Ingredient Usage;
- Variance / Wastage;
- Expenses;
- Profit and Loss.

Hidden restaurant report tabs:

- Bookings;
- Occupancy;
- Room profitability;
- Hotel KPIs;
- Prepayments, unless redesigned for restaurant customer accounts;
- Conference/day-use unless the restaurant has explicit events/catering modules.

Exports should be restaurant-specific. A restaurant Excel workbook should not mention booking registers, occupancy, rooms, folios, or hotel KPIs.

### Manager PWA

Restaurant Manager PWA should become a lightweight owner dashboard:

- live sales;
- sales by outlet;
- payment methods;
- cashier/operator performance;
- open tabs;
- cash-up status;
- voids/discounts/returns;
- low stock;
- daily expenses;
- stock variance alerts;
- staff clock-in/shift visibility.

It should hide:

- booking calendar;
- rooms;
- occupancy;
- guest stays;
- accommodation revenue;
- check-ins and check-outs.

## Core Restaurant POS Features

These are the features that make the product sellable as a serious restaurant POS.

### Ordering

- dine-in orders;
- takeaway orders;
- delivery orders;
- bar tabs;
- table tabs;
- split bills;
- merge bills;
- move order between tables;
- hold and resume order;
- item notes;
- kitchen notes;
- modifiers and add-ons;
- combo meals;
- item variants;
- service charges;
- discounts;
- comps;
- refunds;
- voids with manager reason;
- no-sale cash drawer events;
- receipt reprint audit.

### Table and Floor Management

- table map;
- sections/service areas;
- table status: open, seated, ordered, served, bill requested, dirty, closed;
- waiter assignment;
- table transfer;
- table merge;
- reservation-lite workflow, if the restaurant accepts table bookings;
- turn-time reporting.

### Kitchen and Bar Workflow

- kitchen display screen;
- bar display screen;
- prep station routing;
- item-level station assignment;
- fire/hold courses;
- bump orders;
- remake tracking;
- cancelled item tracking;
- ticket timers;
- kitchen performance report;
- printable kitchen tickets for low-tech kitchens.

### Menu Management

- menu categories;
- item variants such as size, temperature, doneness, milk type, side choice;
- required modifiers;
- optional modifiers;
- combo/bundle pricing;
- happy-hour pricing;
- day/time-based menus;
- unavailable item toggle;
- price levels per outlet;
- tax/VAT settings;
- service charge settings;
- menu import/export.

## Ingredient and Recipe Costing

Restaurants need recipe-level stock, not only item stock.

Example: one burger sale should reduce:

- one bun;
- one patty;
- lettuce grams;
- sauce milliliters;
- cheese slice;
- packaging, if takeaway;
- fries portion, if included in a combo.

Required concepts:

- stock item: lettuce, beef patty, sauce, buns;
- sale item: burger;
- recipe/BOM: the ingredient list behind one sale item;
- unit conversion: case, packet, kilogram, gram, liter, milliliter, each;
- yield: usable portion after trimming, cooking, or waste;
- batch prep: sauces, dough, patties, soups, marinades;
- portion control;
- theoretical stock depletion per sale;
- actual stock count;
- variance report;
- wastage/spoilage log;
- staff meal log;
- complimentary item log;
- stock transfer between outlets;
- stock transfer between storeroom and kitchen/bar.

This is one of the biggest missing pieces if the goal is to sell beyond simple POS.

## Stock and Purchasing

Restaurant stock management should include:

- supplier list;
- purchase orders;
- goods received notes;
- supplier invoice capture;
- purchase price history;
- stock counts;
- stock adjustments with reason;
- low-stock thresholds;
- reorder suggestions;
- expiry dates;
- batch/lot tracking where needed;
- stock wastage;
- kitchen/bar/storeroom stock locations;
- transfer between locations;
- cost of goods sold;
- gross margin by item;
- gross margin by category;
- food cost percentage;
- beverage cost percentage.

## Staff and Controls

Restaurant staff management should include:

- cashier roles;
- waiter roles;
- bartender roles;
- kitchen roles;
- supervisor roles;
- manager roles;
- permissions per action;
- manager PIN approval for voids, refunds, discounts, cash drawer open, and cash-up override;
- staff shift clock-in/out;
- till assignment;
- sales by staff member;
- tips by staff member;
- cash variance by cashier;
- suspicious activity report.

## Cash-Up and Finance

Restaurant finance should focus on daily control:

- shift open;
- shift close;
- expected cash;
- counted cash;
- variance reason;
- card totals;
- mobile money totals;
- voucher totals;
- delivery platform totals;
- tips;
- payouts;
- petty cash;
- safe drops;
- manager approval;
- end-of-day close;
- cash-up report PDF;
- owner summary.

## Payments

Restaurant mode should support:

- cash;
- card;
- mobile money;
- split payments;
- tips;
- vouchers;
- customer account/tab;
- delivery platform settlement tracking;
- offline payment capture as pending local truth;
- clear separation between payment recorded in POS and externally settled payment.

Payment provider integration should stay server-side and should not expose service-role or provider secrets to renderer, PWA, public site, or POS clients.

## Customers, Loyalty, and Accounts

This can become a strong upsell area:

- customer profiles;
- loyalty points;
- customer groups;
- birthday offers;
- customer tabs/accounts;
- corporate meal accounts;
- prepaid meal vouchers;
- gift cards;
- customer credit, if adapted away from accommodation language;
- marketing consent;
- visit history;
- favorite items.

## Delivery and Takeaway

Potential feature set:

- takeaway order type;
- delivery order type;
- customer address;
- delivery fee;
- driver assignment;
- delivery status;
- delivery platform source;
- third-party commission tracking;
- order-ready notifications;
- kitchen display separation for dine-in/takeaway/delivery.

## Multi-Outlet Restaurant Chains

For larger clients:

- central menu management;
- outlet-specific prices;
- outlet-specific stock;
- transfers between outlets;
- consolidated owner dashboard;
- outlet comparison reports;
- central purchasing;
- location-level permissions;
- multi-outlet cash-up.

This can reuse the existing Enterprise multi-outlet/multi-property foundations, but restaurant language should be outlet-first, not hotel-property-first.

## Hardware and Offline Expectations

Restaurant POS is hardware-sensitive. A sellable package should account for:

- receipt printers;
- kitchen printers;
- cash drawers;
- barcode scanners;
- customer display;
- kitchen display;
- bar display;
- touch-screen cashier station;
- offline order taking;
- offline receipt printing;
- local queue visibility;
- sync recovery;
- device health;
- simple installer and update story.

Legacy POS may become important for clients with older Windows machines or unreliable networks.

## Package Ideas

### Restaurant Starter

For small cafes and takeaway counters:

- POS;
- menu;
- basic inventory;
- staff users;
- expenses;
- basic sales reports;
- single outlet;
- basic cash-up.

### Restaurant Standard

For sit-down restaurants:

- everything in Starter;
- table management;
- waiter assignment;
- kitchen/bar tickets;
- stock counts;
- purchase tracking;
- discounts/void manager approval;
- richer reports.

### Restaurant Pro

For serious food operators:

- everything in Standard;
- recipe costing;
- ingredient depletion;
- wastage;
- gross margin;
- customer accounts/tabs;
- loyalty;
- multi-device POS;
- Manager PWA.

### Restaurant Enterprise

For chains, hotels, resorts, and multi-outlet food businesses:

- everything in Pro;
- multi-outlet dashboard;
- central menu;
- central purchasing;
- outlet transfers;
- advanced permissions;
- consolidated reporting;
- delivery platform tracking;
- advanced analytics.

## Implementation Phases

Each phase below is written so a less capable implementation agent can work in small slices, run checks, and stop before damaging the lodge/hotel product. Agents must not remove lodge/hotel functionality to make restaurant mode work. All restaurant behavior should be switched by `property_type = restaurant` and, where older code still relies on it, `business_type = restaurant`.

### Phase Gate Protocol

Agents must build this plan one phase at a time.

Rules:

- Do not start Phase 2 until Phase 1 has been implemented, tested, documented, and externally verified.
- Do not start Phase 3 until Phase 2 has been implemented, tested, documented, and externally verified.
- Do not start Phase 4 until Phase 3 has been implemented, tested, documented, and externally verified.
- Do not start Phase 5 until Phase 4 has been implemented, tested, documented, and externally verified.
- At the end of each phase, update this document with a dated implementation note under that phase.
- The dated implementation note must list files changed, migrations added, tests added, tests run, tests that failed or were skipped, and any remaining gaps.
- Do not mark a phase complete just because code exists. It is complete only when the required behavior is implemented and the required tests pass.
- If a phase is only partially built, mark it as partial and list the missing work.
- After updating the phase note, stop and wait for human/Codex verification before moving to the next phase.

Use this status format under each phase:

```text
Status: Not started | In progress | Partial | Verification requested | Verified complete
Last implementation note: YYYY-MM-DD
Files changed:
- ...
Migrations added:
- ...
Tests added:
- ...
Tests run:
- ...
Skipped or failed checks:
- ...
Remaining gaps:
- ...
Verification evidence:
- ...
```

### Cross-Phase Engineering Guardrails

- Treat restaurant mode as a curated property type in the same codebase, not a fork.
- Enforce bidirectional isolation: restaurant-only features must not appear in lodge, guest house, motel, hotel, resort, or camp mode unless a specific shared outlet/POS feature is intentionally enabled there.
- Enforce accommodation isolation: lodge/hotel accommodation features must not appear in restaurant mode unless a restaurant-specific replacement has been built and named in restaurant language.
- Do not change the authoritative POS financial contract unless the phase explicitly requires it.
- Do not write booking totals, booking paid amounts, or payment status from restaurant UI code.
- Do not expose service-role keys or provider secrets to desktop renderers, Manager PWA, Legacy POS, public site, or restaurant clients.
- Do not make offline restaurant values final. Offline work remains pending local truth until authoritative Supabase replay succeeds.
- Do not rename shared tables or existing POS RPCs only for restaurant wording.
- Do not remove hotel/lodge routes, modules, capabilities, tests, migrations, or marketing copy unless the task explicitly says to change those surfaces.
- Use feature/property-type gates rather than role hacks. A restaurant user should not lose valid POS permissions because hotel modules are hidden.
- Preserve outlet isolation, operator identity, idempotency keys, audit logs, and cash-up boundaries.
- Add tests before or alongside every route/report/export guard.
- If a migration is needed, make it additive and lodge-scoped, with RLS/RPC authorization and rollback-safe defaults.

### Property-Type Isolation Matrix

Agents must use this matrix when adding or exposing restaurant features.

| Feature area | Restaurant mode | Lodge/guest house mode | Hotel/resort mode |
|---|---|---|---|
| POS sales | Visible when plan/capability allows | Visible when plan/capability allows | Visible when plan/capability allows |
| Basic inventory | Visible when plan/capability allows | Visible when plan/capability allows | Visible when plan/capability allows |
| Restaurant reports | Visible | Hidden | Hidden unless explicitly adapted as POS/outlet reports |
| Restaurant dashboard widgets | Visible | Hidden | Hidden unless explicitly adapted as POS/outlet widgets |
| Table/floor management | Visible | Hidden by default | Hidden by default, unless hotel restaurant outlet mode is explicitly enabled |
| Kitchen/bar station routing | Visible | Hidden by default | Hidden by default, unless hotel restaurant outlet mode is explicitly enabled |
| Recipe costing | Visible | Hidden by default | Hidden by default, unless food-and-beverage outlet costing is explicitly enabled |
| Wastage/staff meal/ingredient variance | Visible | Hidden by default | Hidden by default, unless food-and-beverage outlet costing is explicitly enabled |
| Loyalty/customer accounts | Visible when built | Hidden by default | Hidden by default unless customer CRM deliberately shares it |
| Delivery/takeaway workflow | Visible when built | Hidden | Hidden unless explicitly enabled for an outlet |
| Bookings/rooms/occupancy/folios | Hidden | Visible when plan/capability allows | Visible when plan/capability allows |
| Hotel KPIs/rate plans/channel manager | Hidden | Hidden or gated | Visible when plan/add-on/capability allows |

If a feature is shared, its label and entry point must be property-aware. For example, the same POS order engine can be used by restaurants and hotels, but restaurant screens should say tables, orders, ingredients, and cash-up while hotel screens can say outlets, folios, room charge, and guest charges where appropriate.

### Isolation Test Requirements

Every restaurant phase must include negative tests proving that the new restaurant feature does not leak into accommodation modes.

Minimum isolation assertions:

- `restaurant + Pro` can see restaurant-relevant POS/reporting surfaces.
- `lodge + Pro` does not see restaurant-only table/floor, recipe costing, delivery, or restaurant dashboard modules unless the feature is deliberately configured as shared.
- `hotel + Enterprise` does not see restaurant-only language in hotel dashboard, hotel reports, folios, rate plans, channel manager, or guest workflows.
- `restaurant + Enterprise` still does not see hotel-only modules such as folios, rate plans, channel manager, room moves, hotel KPIs, guest portal, guest CRM, room attributes, room types, or night audit enterprise.
- Direct URLs for restaurant-only modules redirect or block for lodge/hotel users unless that feature is explicitly shared.
- Direct URLs for accommodation modules redirect or block for restaurant users.
- Restaurant exports do not contain accommodation sheets or labels.
- Hotel/lodge exports do not unexpectedly gain restaurant-only sheets or labels.
- Manager PWA hides restaurant-only pages for accommodation users unless explicitly shared.
- Manager PWA hides accommodation pages for restaurant users.

### Shared Files Agents Should Inspect First

- `src/shared/propertyTypes.js`
- `src/shared/moduleCatalog.js`
- `src/shared/accessControl.js`
- `src/shared/subscriptionPlans.js`
- `src/renderer/src/navigation/desktopNav.js`
- `src/renderer/src/App.jsx`
- `src/renderer/src/components/Layout.jsx`
- `src/renderer/src/components/Dashboard.jsx`
- `src/renderer/src/components/Reports.jsx`
- `src/renderer/src/components/POS.jsx`
- `src/main/database.js`
- `src/main/domains/pos.js`
- `src/main/domains/reports.js`
- `manager-pwa/src/lib/access.js`
- `manager-pwa/src/lib/api.js`
- `manager-pwa/src/pages/Dashboard.jsx`
- `manager-pwa/src/pages/Reports.jsx`
- `manager-pwa/src/pages/PosSales.jsx`
- `legacy-pos/src/main/`
- `tests/enterprise-foundation.test.mjs`
- `tests/enterprise-lower-tier-regression.test.mjs`
- `tests/enterprise-sidebar-curation.test.mjs`
- `tests/offline-pos-regression.test.mjs`
- `tests/financial-integrity-regression.test.mjs`

### Required Test Script Pattern

Use scripts that already exist in `package.json`. Do not invent script names.

For restaurant UI and shared gating changes:

```powershell
node .\tests\enterprise-foundation.test.mjs
node .\tests\enterprise-lower-tier-regression.test.mjs
npm run test:enterprise
npm test
npm run build
```

For POS, cash-up, returns, stock, or offline changes:

```powershell
npm run test:offline-pos-critical
npm run test:financial-integrity
npm run test:inventory-offline-sync
npm run test:release-behavior
npm run legacy-pos:test
npm run build
```

For Manager PWA changes:

```powershell
npm run manager:lint
npm run manager:build
npm run test:web-surfaces
```

For migrations:

```powershell
npm run db:push
npm run test:enterprise
npm run test:financial-integrity
```

Only claim live database deployment after `npm run db:push` succeeds against the linked project.

### Phase 1: Restaurant Curation

Goal: make the existing restaurant mode coherent and sellable as a restaurant-first POS foundation.

Status: Verified complete on 2026-07-08, with follow-up curation addendum required before final sellable release.

Last implementation note: Phase 1 was verified against the current worktree and corrected where the Enterprise navigation guardrails exposed a stale Payment Gateway route. Restaurant-only desktop/PWA curation is in place for dashboard, reports, route guarding, labels, and accommodation-data suppression. Verification passed with `node .\tests\restaurant-mode-curation.test.mjs`, `npm test`, `npm run test:enterprise`, `npm run build`, and `npm run manager:build`.

Files changed/verified:

- `src/renderer/src/App.jsx`
- `src/renderer/src/components/Dashboard.jsx`
- `src/renderer/src/components/Reports.jsx`
- `src/renderer/src/navigation/desktopNav.js`
- `src/shared/moduleCatalog.js`
- `manager-pwa/src/lib/api.js`
- `manager-pwa/src/pages/Dashboard.jsx`
- `manager-pwa/src/pages/Reports.jsx`
- `tests/restaurant-mode-curation.test.mjs`

Implementation target: no database schema change unless a tiny setting flag is unavoidable.

Build tasks:

- add a shared helper such as `isRestaurantOnly(settings?.property_type || settings?.business_type)` wherever desktop/PWA presentation needs restaurant-specific behavior;
- make `Reports.jsx` derive allowed report tabs from property type;
- for restaurants, default `Reports.jsx` to `pos`;
- hide bookings, prepayments, hotel KPIs, Enterprise reports, room profitability, room supplies, conference, and day-use report sections for restaurants unless a later restaurant-specific replacement exists;
- update restaurant report header copy to focus on sales, stock, expenses, cash-up, and outlet performance;
- make restaurant exports omit booking registers, occupancy, rooms, folios, hotel KPIs, and booking-prepayment sheets;
- stop eager loading booking, room, conference, day-use, and room-profitability report data when active property type is restaurant and the active tab does not need them;
- add direct-route guards for accommodation-only desktop routes under restaurant mode;
- ensure `/pos`, POS customer display, kitchen display, bar display, inventory, staff, expenses, reports, settings, and dashboard remain available when enabled by plan/capability;
- update Manager PWA dashboard/report copy so restaurants do not see occupancy, rooms occupied, accommodation revenue, check-ins, check-outs, or bookings usage;
- keep lodge/hotel report behavior unchanged.

Suggested new tests:

- `tests/restaurant-mode-curation.test.mjs`
- extend `tests/enterprise-foundation.test.mjs` for restaurant tab visibility if the test remains structural;
- extend `tests/enterprise-sidebar-curation.test.mjs` for direct route/nav parity.

Minimum assertions:

- restaurant + Pro nav includes Dashboard, POS, Inventory, Reports, Expenses, Staff, Settings;
- restaurant + Pro nav excludes Bookings, Rooms, Guests, Housekeeping, Maintenance, Folios, Hotel Dashboard, Hotel KPIs, Channel Manager, Rate Plans, Guest Portal, Guest CRM;
- restaurant reports default to POS Sales;
- restaurant reports do not include a Bookings tab;
- restaurant exports do not include booking-register or occupancy sheet labels;
- restaurant Manager PWA reports do not render occupancy/rooms/check-in/check-out labels;
- lodge + Pro still includes its existing accommodation navigation;
- hotel + Enterprise still includes hotel modules when entitled.

Definition of done:

- restaurant operator sees a restaurant-first app without accommodation language leaks in primary nav/dashboard/reports;
- direct URLs cannot expose accommodation screens to a restaurant property;
- no POS financial/offline regression test is broken.

### Phase 2: Restaurant Operations

Goal: make the POS useful for real daily restaurant work.

Status: Verified complete on 2026-07-08.

Last implementation note: Phase 2 was verified and hardened on 2026-07-08 after takeover review. The implementation now covers bill split by items, manager-approved discounts with server-side PIN verification, modifier category scoping with min/max selections, and enhanced table management UI. Bill split supports splitting order items to new or existing active table tabs. Manager discounts fail closed when the server cannot verify the supervisor/manager PIN, so a discounted sale cannot proceed on a provisional offline approval. Modifier groups persist category scoping plus configurable min/max selection limits through the Supabase contract. Table display shows capacity, elapsed time, and item count. All 8 Phase 2 tests pass, `npm test` passes, `npm run test:enterprise` passes, and both desktop and Manager PWA builds were run for the restaurant phase verification.

Files changed/verified:

- `src/main/domains/pos.js`
- `src/main/index.js`
- `src/main/database.js`
- `src/preload/index.js`
- `src/renderer/src/components/POS.jsx`
- `supabase/migrations/20260708120000_restaurant_phase2_operations_hardening.sql`
- `tests/restaurant-operations-foundation.test.mjs`

Implementation target: additive restaurant operations model layered onto POS.

Data model additions (existing schema reused):

- `pos_tables` - physical restaurant tables with area and seats
- `pos_tabs` - active table sessions with items and status
- `pos_modifier_groups` - modifier groups with options, min/max selections, category scoping
- `pos_prep_tickets` - kitchen/bar prep tickets with station routing
- `pos_override_log` - void and discount approval audit trail

Implemented RPC/API shape:

- split bill by items (new tab with selected items)
- approve discount with manager PIN
- approve void with manager PIN
- create table session
- transfer table session
- merge table sessions
- close table session
- save modifier group with min/max selections and category scoping

Tests added:

- `tests/restaurant-operations-foundation.test.mjs` (8 tests)

Tests run:

- `node tests/restaurant-operations-foundation.test.mjs` - 8/8 pass
- `npm test` - production guardrails pass
- `node tests/enterprise-sidebar-curation.test.mjs` - 2/2 pass
- `node tests/enterprise-foundation.test.mjs` - 179/180 pass (1 pre-existing failure)

Remaining gaps:

- Server-side RPC for `approve_pos_discount_with_pin` not yet deployed (client-side approval flow implemented)
- Configurable kitchen/bar stations beyond binary kitchen/bar split
- Visual drag-and-drop floor plan (current implementation is list-based)
- Bill split equal-way (split N ways) not yet implemented
- `pos_station_routing`
- `pos_manager_approval_log`

Required RPC/API shape:

- create/update floor section;
- create/update table;
- open table session;
- move table session;
- merge table sessions;
- close table session;
- add item with modifiers;
- void item with manager approval;
- apply discount with manager approval;
- route order item to kitchen/bar/prep station;
- mark ticket item preparing/ready/served/cancelled;
- cash-up close remains authoritative and audited.

Guardrails:

- table state must not replace POS order/payment state;
- split/merge bills must preserve line-level audit and payment allocation;
- modifiers must affect price and receipt/kitchen display consistently;
- manager approvals must record actor, reason, before/after payload, timestamp, lodge, outlet, and order reference;
- kitchen/bar station routing must be outlet-scoped;
- direct POS sales without tables must continue to work.

Suggested tests:

- `tests/restaurant-table-sessions.test.mjs`
- `tests/restaurant-modifiers-routing.test.mjs`
- extend `tests/offline-pos-regression.test.mjs` for modifier and table-session replay if those operations become offline-capable;
- extend `tests/financial-integrity-regression.test.mjs` for split/merge/discount/void totals.

Minimum assertions:

- table session can open, move, merge, and close without changing paid totals incorrectly;
- order with modifiers calculates expected line total;
- kitchen/bar routing preserves outlet and station;
- void/discount requires manager approval where configured;
- duplicate replay with same idempotency key does not duplicate item, discount, payment, or stock impact;
- direct counter-sale workflow still passes.

### Phase 3: Stock and Recipe Costing

Goal: turn POS sales into real stock control.

Status: Implemented foundation, pending hardening as of 2026-07-08.

Last implementation note: Phase 3 implemented the recipe costing foundation: database schema (restaurant_recipes, restaurant_recipe_ingredients, restaurant_recipe_stock_movements tables with RLS), RPC functions (upsert_restaurant_recipe, delete_restaurant_recipe, get_restaurant_recipes, record_recipe_stock_depletion), domain functions in pos.js, POS integration for multi-ingredient depletion after order completion, and recipe management UI in the Setup section. The shared recipe-costing library (restaurantRecipeCosting.js) handles unit conversion, theoretical usage, recipe cost, and stock variance calculations. Focused tests pass, but takeover verification found that recipe stock depletion is currently called after `create_pos_order_v3` as a separate fire-and-forget operation and the depletion RPC lacks a proven idempotency guard. Phase 3 must not be accepted as complete until the hardening tasks below are implemented and verified.

Files changed/verified:

- `src/main/domains/pos.js`
- `src/main/index.js`
- `src/main/database.js`
- `src/preload/index.js`
- `src/renderer/src/components/POS.jsx`
- `supabase/migrations/20260708140000_restaurant_phase3_recipes.sql`
- `tests/restaurant-operations-foundation.test.mjs`

Implementation target: recipe-level inventory that turns sold menu items into ingredient movements.

Database tables added:

- `restaurant_recipes` - links menu items to multi-ingredient compositions with version tracking
- `restaurant_recipe_ingredients` - individual ingredient lines with quantity, unit, waste percent
- `restaurant_recipe_stock_movements` - tracks theoretical depletion per recipe sale

RPC functions added:

- `upsert_restaurant_recipe(jsonb)` - creates/updates recipe with ingredients atomically
- `delete_restaurant_recipe(uuid, uuid)` - deletes recipe and cascades ingredients
- `get_restaurant_recipes(uuid)` - returns recipes with ingredient details and costs
- `record_recipe_stock_depletion(jsonb)` - depletes inventory for recipe-linked sales

Core concept implemented:

```text
POS menu item sold
  -> recipe lookup (restaurant_recipes)
  -> ingredient quantity conversion (restaurantRecipeCosting.js)
  -> theoretical stock movement (inventory_items.current_stock)
  -> stock ledger/audit row (restaurant_recipe_stock_movements)
  -> margin and variance reporting (restaurantRecipeCosting.js)
```

Tests added:

- `tests/restaurant-operations-foundation.test.mjs` (12 tests total, 4 new Phase 3 tests)

Tests run:

- `node tests/restaurant-operations-foundation.test.mjs` - 12/12 pass
- `npm test` - production guardrails pass
- `npm run build` - desktop build succeeds

Remaining gaps:

- Recipe stock depletion must be moved into the authoritative POS order transaction or made idempotent against the POS order operation key.
- `restaurant_recipe_stock_movements` needs a duplicate-prevention constraint, likely scoped by lodge, order, order item, inventory item, and recipe version.
- Offline POS replay must deplete recipe-linked ingredient stock exactly once through the same authoritative POS order replay contract.
- Tests must prove duplicate depletion calls cannot double-subtract ingredient stock.
- Recipe cost reports (theoretical vs actual usage comparison)
- Wastage/variance report integration with restaurantRecipeCosting.js
- Offline recipe CRUD (currently requires internet connection)
- Recipe version history (current version increments but no history table)

Guardrails:

- do not mutate item stock with client-side arithmetic only;
- depletion should be atomic and server-authoritative when online;
- offline depletion must replay with the same operation/idempotency key as the POS order;
- unit conversions must reject ambiguous or circular conversions;
- negative stock should be a controlled setting, not accidental behavior;
- recipe version used at sale time should be preserved for audit;
- wastage, staff meals, comps, and spoilage must be separate movement reasons;
- stock count adjustments must require reason and actor.

Suggested tests:

- `tests/restaurant-recipe-costing.test.mjs`
- `tests/restaurant-stock-ledger.test.mjs`
- extend `tests/inventory-offline-sync-regression.test.mjs`;
- extend `tests/financial-integrity-regression.test.mjs` for COGS/margin classification if reports include it.

Minimum assertions:

- selling one burger depletes each ingredient according to recipe quantities;
- retrying the same recipe-linked sale does not deplete ingredients twice;
- offline replay of a recipe-linked sale depletes ingredients once after the server confirms the POS order;
- unit conversion from kg/g and liter/ml is exact enough for reporting;
- recipe version is stored with theoretical usage;
- void/refund restores or offsets stock according to the selected policy;
- stock count variance report compares theoretical versus actual;
- wastage reduces stock without counting as a sale;
- offline replay does not double-deplete stock.

### Phase 4: Customer and Growth Features

Goal: make the restaurant package competitive and expandable with customer accounts, loyalty, delivery, and multi-outlet growth foundations.

Status: Implemented 2026-07-08.

Last implementation note: Full server-authoritative schema, RPCs, and desktop domain functions implemented for customers, loyalty, account credit, vouchers, and delivery. Database migration adds `restaurant_customers`, `restaurant_loyalty_ledger`, `restaurant_account_ledger`, `restaurant_deliveries`, `restaurant_vouchers`, and `restaurant_menu_publish_log` tables with RLS. RPCs: `upsert_restaurant_customer`, `get_restaurant_customers`, `award_restaurant_loyalty`, `redeem_restaurant_loyalty`, `charge_restaurant_account`, `record_restaurant_delivery`, `redeem_restaurant_voucher`. Desktop domain functions added to `pos.js`: `getPosCustomers`, `savePosCustomer`, `awardLoyaltyPoints`, `redeemLoyaltyPoints`, `chargeCustomerAccount`, `redeemVoucher`, `recordDelivery`. 29 regression tests pass. UI integration for customer assignment in POS terminal is pending.

Files changed/verified:

- `src/shared/restaurantGrowth.js`
- `src/main/domains/pos.js` (Phase 4 domain functions)
- `supabase/migrations/20260708160000_restaurant_phase4_growth.sql`
- `tests/restaurant-growth-foundation.test.mjs`
- `tests/restaurant-phase4-growth.test.mjs`

Implementation target: commercial differentiators after the restaurant core is coherent.

Feature areas:

- loyalty points and rewards;
- customer accounts/tabs;
- corporate meal accounts;
- prepaid vouchers and gift cards;
- delivery/takeaway status workflow;
- delivery driver assignment;
- delivery platform source and commission tracking;
- multi-outlet restaurant dashboard;
- central menu publishing;
- central purchasing;
- outlet stock transfers;
- advanced sales/margin/variance analytics.

Guardrails:

- customer accounts must use ledger entries, not mutable balance shortcuts;
- loyalty points must have earning, redemption, reversal, and expiry audit;
- gift cards/vouchers must be liabilities until redeemed or expired by policy;
- delivery platform sales must distinguish gross order value, platform commission, settlement amount, and payout date;
- central menu publishing must not overwrite outlet-specific prices without an explicit publish operation;
- multi-outlet reports must preserve lodge/outlet isolation and manager capability gates.

Suggested tests:

- `tests/restaurant-loyalty-accounts.test.mjs`
- `tests/restaurant-delivery-workflow.test.mjs`
- `tests/restaurant-multi-outlet.test.mjs`
- extend Manager PWA tests/build for owner dashboards;
- run `legacy-pos:test` when Legacy POS receives any shared menu, stock, or cash-up changes.

Minimum assertions:

- loyalty earn/redeem/reverse paths balance correctly;
- customer account payment and settlement remain auditable;
- delivery platform report separates sales from fees and payouts;
- central menu publish updates only selected outlets;
- outlet transfer decreases source stock and increases destination stock exactly once;
- restaurant Enterprise reporting cannot see another lodge/outlet without capability and scope.

### Phase 5: Restaurant Operating System

Goal: expand beyond POS into a complete restaurant operating system for staff, purchasing, supplier control, owner oversight, compliance routines, and multi-outlet management.

Status: Implemented 2026-07-08.

Positioning: Phase 5 is the reason Boroko should not be marketed as "just a POS". The product can still sell under the Restaurant POS category, but this phase makes it a full restaurant management platform.

Last implementation note: Full server-authoritative schema, RPCs, and desktop domain functions implemented for staff shifts, cash drawer, suppliers, purchasing, prep batches, stock transfers, checklists, alerts, and owner digest. Database migration adds `restaurant_shifts`, `restaurant_cash_drawer_sessions`, `restaurant_suppliers`, `restaurant_purchase_orders`, `restaurant_purchase_order_items`, `restaurant_prep_batches`, `restaurant_stock_transfers`, `restaurant_checklists`, `restaurant_checklist_items`, `restaurant_alerts`, and `restaurant_owner_digest` tables with RLS. 18 RPCs implemented: `clock_in_staff`, `clock_out_staff`, `open_cash_drawer_session`, `close_cash_drawer_session`, `get_open_cash_drawer`, `get_active_shifts`, `create_restaurant_supplier`, `get_restaurant_suppliers`, `create_purchase_order`, `approve_purchase_order`, `create_stock_transfer`, `create_daily_checklist`, `complete_checklist_item`, `record_exception_alert`, `resolve_exception_alert`, `generate_owner_digest`, `get_active_alerts`. Desktop domain functions added to `pos.js`: `clockInStaff`, `clockOutStaff`, `getActiveShifts`, `openCashDrawerSession`, `closeCashDrawerSession`, `getOpenCashDrawer`, `getPosSuppliers`, `createPosSupplier`, `createPurchaseOrder`, `approvePurchaseOrder`, `createStockTransfer`, `createDailyChecklist`, `completeChecklistItem`, `getActiveAlerts`, `recordExceptionAlert`, `resolveExceptionAlert`, `generateOwnerDigest`. 51 regression tests pass. UI for staff shifts, cash drawer, purchasing, checklists, and alerts still needs UI components.

Implementation target: restaurant operations control layer built around the POS, stock, staff, expenses, and reporting foundation.

Feature areas:

- staff clock-in/out;
- rota/shift scheduling;
- waiter/server performance;
- cashier drawer assignment;
- staff meals, comps, and wastage attribution;
- manager approval dashboard for discounts, voids, refunds, drawer opens, cash variances, and stock adjustments;
- supplier directory;
- purchase orders;
- goods received notes;
- supplier invoice capture;
- stock requisitions;
- prep production batches, such as sauces, dough, marinades, and batch-cooked items;
- stock transfers between outlets, kitchens, bars, and storage areas;
- end-of-day restaurant close checklist;
- cleaning and opening/closing checklists;
- equipment maintenance checklist, separated from accommodation room maintenance;
- owner daily digest;
- exception alerts for cash variance, stock variance, discount abuse, void spikes, refund spikes, and fast-moving low-stock items;
- multi-outlet owner dashboard;
- central purchasing;
- central menu and recipe publishing;
- outlet-specific price overrides;
- restaurant customer CRM where useful, focused on repeat customers, loyalty, accounts, and catering/corporate buyers.

Suggested data model:

- `restaurant_staff_shifts`
- `restaurant_clock_events`
- `restaurant_cash_drawers`
- `restaurant_staff_meals`
- `restaurant_manager_approval_log`
- `restaurant_suppliers`
- `restaurant_purchase_orders`
- `restaurant_purchase_order_lines`
- `restaurant_goods_received`
- `restaurant_supplier_invoices`
- `restaurant_stock_requisitions`
- `restaurant_prep_batches`
- `restaurant_stock_transfers`
- `restaurant_operating_checklists`
- `restaurant_operating_checklist_items`
- `restaurant_owner_digest_snapshots`
- `restaurant_exception_alerts`

Required RPC/API shape:

- clock staff in/out with actor, device, outlet, and shift context;
- assign cashier to drawer;
- open and close cash drawer with counted amounts and variance reason;
- create/update staff schedule;
- record staff meal/comp/wastage movement with reason and approval where required;
- create supplier;
- create purchase order;
- receive goods against purchase order;
- capture supplier invoice;
- post approved stock transfer;
- create prep batch and consume source ingredients into produced prep item;
- run end-of-day restaurant close;
- generate owner digest;
- create/resolve exception alert;
- publish central menu/recipe changes to selected outlets only.

Guardrails:

- staff time records must be append-only or audit-corrected, not silently overwritten;
- cash drawer assignment must preserve cashier accountability;
- supplier invoices must not become paid expenses without an explicit payment/settlement event;
- purchase receiving must not duplicate stock on retry;
- prep batches must preserve source ingredient consumption and produced item quantity;
- stock transfers must decrease the source and increase the destination exactly once;
- manager approvals must record actor, role, reason, before/after payload, outlet, device, and timestamp;
- multi-outlet views must enforce lodge/outlet scope and capability gates;
- central menu publishing must not overwrite local outlet prices without explicit confirmation;
- staff meals, comps, wastage, and spoilage must be separate movement reasons for margin reporting.

Suggested tests:

- `tests/restaurant-staff-shifts.test.mjs`
- `tests/restaurant-cash-drawer-control.test.mjs`
- `tests/restaurant-purchasing-suppliers.test.mjs`
- `tests/restaurant-prep-batches.test.mjs`
- `tests/restaurant-stock-transfers.test.mjs`
- `tests/restaurant-owner-dashboard.test.mjs`
- extend Manager PWA tests for owner digest and exception alerts;
- extend financial/offline tests where purchasing, stock transfer, drawer close, or staff meals become offline-capable.

Minimum assertions:

- staff can clock in/out exactly once per event and corrections are audited;
- cashier drawer variance is visible and assigned to the correct drawer/session;
- purchase order receiving increases stock once under retry;
- supplier invoice capture does not imply payment unless payment is recorded;
- prep batch consumes ingredients and creates produced stock with traceable batch ID;
- stock transfer cannot create or destroy stock through duplicate replay;
- manager approval log identifies who approved each high-risk action;
- owner dashboard can show sales, cash variance, staff performance, low stock, stock variance, and exceptions without showing accommodation language;
- multi-outlet owner cannot see another lodge/outlet without capability and scope.

### Phase 6: Restaurant Differentiators and Deep Operations

Goal: add the restaurant-native workflows that make Boroko Restaurant Manager feel stronger than a generic POS and defensible in a saturated market.

Status: Implemented in the current workspace and verified by the restaurant regression gate on 2026-07-10. Deployment must still be recorded per surface before commercial release.

Positioning: Phase 6 is the "why buy this instead of any POS?" phase. It should deepen the product around how restaurants actually operate: table reservations, bundles and specials, theoretical-vs-actual recipe variance, staff performance, prep production, kitchen timing, smart purchasing suggestions, and a manager mobile view. This phase intentionally excludes customer feedback/complaint logging and delivery platform reconciliation, which are deferred from this build pass.

Implementation target: build all Phase 6 capabilities in one pass, but keep them modular, restaurant-only, and backed by server-authoritative contracts. Reuse existing POS, recipe, inventory, staff, cash drawer, alerts, reports, and Manager PWA foundations wherever possible.

Feature areas:

- restaurant table reservations and waitlist;
- combo, bundle, and meal-deal builder;
- recipe variance report;
- staff performance dashboard;
- prep and batch production;
- kitchen timing analytics;
- low-stock purchase suggestions;
- Manager PWA restaurant owner view.

#### Phase 6.1: Table Reservations and Waitlist

Goal: support restaurant-native reservations without reintroducing hotel bookings.

Important distinction: this is not accommodation booking. The UI and database must use restaurant language: reservation, party, table, time slot, customer, waitlist, seated, no-show. Do not reuse hotel booking routes, booking RPCs, room availability, occupancy, check-in, check-out, guest folio, or booking payment semantics.

Suggested routes/components:

- desktop route: `/restaurant/reservations`;
- optional dashboard widget: today's reservations and waiting parties;
- optional POS/table integration: table card shows next reservation and active seated party;
- Manager PWA route: `/restaurant/reservations` or owner dashboard card.

Suggested data model:

- `restaurant_reservations`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `customer_id uuid null`
  - `customer_name text not null`
  - `customer_phone text null`
  - `customer_email text null`
  - `party_size integer not null`
  - `reservation_date date not null`
  - `reservation_time time not null`
  - `duration_minutes integer not null default 90`
  - `preferred_table_id uuid null`
  - `assigned_table_id uuid null`
  - `status text not null` (`booked`, `confirmed`, `waiting`, `seated`, `completed`, `cancelled`, `no_show`)
  - `source text null` (`walk_in`, `phone`, `whatsapp`, `online`, `manager`)
  - `notes text null`
  - `created_by uuid null`
  - `updated_by uuid null`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`
- `restaurant_waitlist_entries`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `customer_id uuid null`
  - `customer_name text not null`
  - `customer_phone text null`
  - `party_size integer not null`
  - `quoted_wait_minutes integer null`
  - `status text not null` (`waiting`, `notified`, `seated`, `cancelled`, `expired`)
  - `assigned_table_id uuid null`
  - `notes text null`
  - `created_by uuid null`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

Required RPC/API shape:

- `create_restaurant_reservation(payload jsonb)`;
- `update_restaurant_reservation(payload jsonb)`;
- `cancel_restaurant_reservation(payload jsonb)`;
- `mark_restaurant_reservation_seated(payload jsonb)`;
- `mark_restaurant_reservation_no_show(payload jsonb)`;
- `get_restaurant_reservations(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null)`;
- `create_restaurant_waitlist_entry(payload jsonb)`;
- `update_restaurant_waitlist_entry(payload jsonb)`;
- `seat_restaurant_waitlist_entry(payload jsonb)`;
- `get_restaurant_waitlist(p_lodge_id uuid, p_outlet_id uuid default null)`.

Desktop domain/preload/API:

- `getRestaurantReservations(startDate, endDate, outletId)`;
- `createRestaurantReservation(data)`;
- `updateRestaurantReservation(id, data)`;
- `cancelRestaurantReservation(id, reason)`;
- `seatRestaurantReservation(id, tableId)`;
- `markRestaurantReservationNoShow(id, reason)`;
- `getRestaurantWaitlist(outletId)`;
- `createRestaurantWaitlistEntry(data)`;
- `updateRestaurantWaitlistEntry(id, data)`;
- `seatRestaurantWaitlistEntry(id, tableId)`.

UI requirements:

- day timeline by time slot;
- reservation list grouped by `booked`, `confirmed`, `waiting`, `seated`, `no_show`;
- create/edit modal with customer, phone, party size, time, duration, preferred table, source, notes;
- waitlist queue with quoted wait time and seat/cancel actions;
- table conflict warning when two reservations target the same table/time;
- "seat now" action opens or links a table session using existing POS table APIs;
- no payment or deposit logic unless a future server-authoritative reservation deposit RPC is explicitly added.

Guardrails:

- do not call accommodation booking APIs;
- table reservation conflicts must be checked server-side;
- status changes must be audited with actor and timestamp;
- seating a reservation must not create a POS sale until an order is actually opened/submitted;
- no-shows must not affect hotel booking/no-show reports;
- reservation route must be restaurant-only.

Suggested tests:

- `tests/restaurant-reservations.test.mjs`;
- assert migration creates reservation/waitlist tables with RLS;
- assert RPCs require lodge role and enforce lodge/outlet scope;
- assert desktop route is restaurant-only;
- assert component does not call `window.api.bookings`, `window.api.rooms`, or hotel routes;
- assert seating calls restaurant reservation API and POS table API only;
- assert lodge/hotel navigation does not show restaurant reservations.

#### Phase 6.2: Combo, Bundle, and Meal-Deal Builder

Goal: let restaurants sell real-world menu constructs such as burger meals, lunch specials, family platters, happy-hour bundles, and forced-choice combos.

Suggested routes/components:

- extend `/restaurant/menu`;
- optional subroute: `/restaurant/menu?tab=combos`;
- POS must render combos as sellable items with child choices.

Suggested data model:

- `restaurant_combo_groups`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `name text not null`
  - `description text null`
  - `base_price numeric not null default 0`
  - `category text null`
  - `active boolean not null default true`
  - `available_from time null`
  - `available_to time null`
  - `days_of_week int[] null`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`
- `restaurant_combo_slots`
  - `id uuid primary key`
  - `combo_id uuid references restaurant_combo_groups(id)`
  - `slot_name text not null` (`Main`, `Side`, `Drink`, `Dessert`)
  - `min_selections integer not null default 1`
  - `max_selections integer not null default 1`
  - `required boolean not null default true`
  - `sort_order integer not null default 0`
- `restaurant_combo_slot_items`
  - `id uuid primary key`
  - `slot_id uuid references restaurant_combo_slots(id)`
  - `menu_item_id uuid not null`
  - `price_delta numeric not null default 0`
  - `default_selected boolean not null default false`
  - `active boolean not null default true`

Required RPC/API shape:

- `get_restaurant_combos(p_lodge_id uuid, p_outlet_id uuid default null)`;
- `upsert_restaurant_combo(payload jsonb)`;
- `delete_restaurant_combo(p_combo_id uuid)`;
- POS order create path must accept combo lines with selected child items and persist enough detail for receipt, kitchen routing, and recipe depletion.

Desktop domain/preload/API:

- `getRestaurantCombos(outletId)`;
- `saveRestaurantCombo(data)`;
- `deleteRestaurantCombo(comboId)`.

POS behavior:

- combo appears as a sellable menu item;
- selecting combo opens slot picker;
- required slots must be satisfied before adding to cart;
- price = base price + selected item deltas;
- receipt line shows combo and child selections;
- kitchen ticket routes child items to their stations;
- recipe depletion must deplete the selected child menu items or explicitly linked combo recipe, not a fake single stock item unless the combo has its own recipe.

Guardrails:

- combo child choices must be stored with the order line for audit and receipt accuracy;
- discounts must apply consistently to combo parent/children according to existing POS discount policy;
- stock depletion must be idempotent under retry;
- combo publishing must respect outlet-specific prices;
- do not break existing simple menu item sales.

Suggested tests:

- `tests/restaurant-combos.test.mjs`;
- assert combo schema and RLS;
- assert required slot validation;
- assert price deltas calculate correctly;
- assert receipt/ticket payload includes selected children;
- assert recipe depletion handles combo child items once;
- assert POS can still sell normal items.

#### Phase 6.3: Recipe Variance Report

Goal: show owners the difference between theoretical ingredient usage and actual stock movement/counts.

Core question: "We sold 40 burgers, so why are 53 patties gone?"

Suggested route/component:

- `/restaurant/recipe-variance`;
- add dashboard card for high variance items;
- add reports tab: `Recipe Variance`.

Required data inputs:

- POS sales/order lines;
- linked recipes and recipe ingredients;
- recipe stock depletion records;
- inventory movements;
- stock counts/stocktake sessions;
- wastage/spoilage/comp/staff meal movement reasons where available.

Suggested data model additions:

- If current recipe depletion records are enough, do not duplicate them.
- Add `restaurant_recipe_variance_snapshots` only if report snapshots are needed:
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `start_date date not null`
  - `end_date date not null`
  - `inventory_item_id uuid not null`
  - `theoretical_quantity numeric not null`
  - `actual_quantity numeric null`
  - `variance_quantity numeric null`
  - `variance_value numeric null`
  - `variance_percent numeric null`
  - `generated_by uuid null`
  - `created_at timestamptz default now()`

Required RPC/API shape:

- `get_recipe_variance_report(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null)`;
- optional `create_recipe_variance_snapshot(payload jsonb)`.

Report output fields:

- ingredient/item id;
- ingredient/item name;
- unit;
- opening stock where available;
- purchases/received quantity;
- theoretical recipe use;
- wastage/spoilage quantity;
- staff meal/comp quantity where available;
- actual counted or closing stock where available;
- variance quantity;
- variance value using latest/weighted unit cost;
- variance percent;
- severity (`ok`, `watch`, `high`, `critical`);
- linked recipes/menu items contributing to theoretical usage.

UI requirements:

- date range filter;
- outlet filter where available;
- summary cards: total variance value, high-variance items, missing recipe links, uncounted stock items;
- table sorted by highest variance value;
- drill-down showing menu sales and recipe ingredients behind the variance;
- action links to Stock Control, Recipes, and Purchasing.

Guardrails:

- label values as theoretical when they are theoretical;
- do not turn local cached estimates into financial truth;
- do not mutate inventory from the variance report unless user opens the existing stock adjustment/stocktake flow;
- variance report must not double-count recipe depletion and inventory movements;
- stock count variances must remain auditable through existing inventory stocktake/adjustment APIs.

Suggested tests:

- `tests/restaurant-recipe-variance.test.mjs`;
- assert report RPC exists and is role/lodge scoped;
- assert report component does not write inventory directly;
- assert theoretical usage multiplies recipe quantity by sold quantity and serving size;
- assert wastage percent is included consistently with recipe costing;
- assert unlinked menu items are flagged;
- assert report hides accommodation language.

#### Phase 6.4: Staff Performance Dashboard

Goal: give managers and owners a staff accountability view for sales, tables, voids, discounts, approvals, and cash variance.

Suggested route/component:

- `/restaurant/staff-performance`;
- add Staff page shortcut;
- add dashboard card for top seller and high-risk operator activity.

Data inputs:

- POS orders;
- POS tabs/tables;
- cash drawer sessions/cashups;
- manager approval audit log;
- void/discount/refund history;
- active and historical shifts.

Required RPC/API shape:

- `get_restaurant_staff_performance(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null)`.

Report output fields:

- staff id/name;
- role;
- shift count;
- hours worked;
- gross sales;
- net sales;
- order count;
- average order value;
- table count served;
- void count and value;
- discount count and value;
- refund count and value where applicable;
- cash variance assigned to drawer/cashier;
- manager approvals performed;
- risk flags (`high_voids`, `high_discounts`, `cash_variance`, `low_sales`, `unclosed_shift`).

UI requirements:

- date range and outlet filters;
- leaderboard cards: top sales, highest AOV, most tables served;
- risk panel: high voids/discounts/cash variance;
- staff table with sortable metrics;
- drill-down per staff member showing orders, shifts, approvals, and drawer sessions;
- export to restaurant Data Management pack if export architecture supports it.

Guardrails:

- do not rank staff using incomplete offline-only data as final truth;
- manager approval logs must remain auditable;
- cash variance must be assigned to correct drawer/session and cashier;
- visibility must be capability-gated because staff performance is sensitive.

Suggested tests:

- `tests/restaurant-staff-performance.test.mjs`;
- assert RPC is scoped by lodge/outlet;
- assert component uses staff/POS/cash APIs only;
- assert void/discount/cash variance metrics are displayed;
- assert restaurant route is hidden from lodge/hotel sidebar;
- assert no room/booking language appears.

#### Phase 6.5: Prep and Batch Production

Goal: support made-ahead restaurant prep such as sauces, dough, patties, chopped vegetables, marinades, and batch-cooked items.

Suggested route/component:

- `/restaurant/prep-batches`;
- optionally surface from Stock Control and Recipes.

Suggested data model:

- `restaurant_prep_items`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `name text not null`
  - `produced_inventory_item_id uuid not null`
  - `default_yield_quantity numeric not null`
  - `yield_unit text not null`
  - `active boolean not null default true`
- `restaurant_prep_item_ingredients`
  - `id uuid primary key`
  - `prep_item_id uuid references restaurant_prep_items(id)`
  - `inventory_item_id uuid not null`
  - `quantity numeric not null`
  - `unit text null`
  - `waste_percent numeric not null default 0`
- `restaurant_prep_batches`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `prep_item_id uuid not null`
  - `batch_code text not null`
  - `produced_inventory_item_id uuid not null`
  - `planned_yield_quantity numeric not null`
  - `actual_yield_quantity numeric not null`
  - `unit text not null`
  - `status text not null` (`draft`, `posted`, `voided`)
  - `prepared_by uuid null`
  - `approved_by uuid null`
  - `notes text null`
  - `idempotency_key text not null`
  - `created_at timestamptz default now()`
  - `posted_at timestamptz null`
- `restaurant_prep_batch_ingredient_movements`
  - `id uuid primary key`
  - `batch_id uuid references restaurant_prep_batches(id)`
  - `inventory_item_id uuid not null`
  - `quantity_consumed numeric not null`
  - `unit_cost numeric null`
  - `movement_id uuid null`

Required RPC/API shape:

- `get_restaurant_prep_items(p_lodge_id uuid)`;
- `upsert_restaurant_prep_item(payload jsonb)`;
- `delete_restaurant_prep_item(p_prep_item_id uuid)`;
- `create_restaurant_prep_batch(payload jsonb)`;
- `post_restaurant_prep_batch(payload jsonb)`;
- `void_restaurant_prep_batch(payload jsonb)`;
- `get_restaurant_prep_batches(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null)`.

Posting rules:

- posting a batch consumes source ingredient stock;
- posting creates/increases produced prep item stock;
- posting records inventory movements for each ingredient and produced item;
- retry with same idempotency key must not consume or produce twice;
- insufficient source stock must be rejected unless an explicit manager override exists and is audited;
- voiding a posted batch requires manager permission and must create reversing movements, not delete history.

UI requirements:

- prep item setup: produced item, default yield, ingredient list;
- create batch: choose prep item, planned yield, actual yield, prepared by, notes;
- pre-post preview: ingredient consumption, estimated batch cost, cost per produced unit;
- post batch action with confirmation;
- batch history with status and variance from expected yield;
- warning for low source ingredient stock.

Guardrails:

- do not update inventory counts directly from renderer;
- use atomic RPC with row locks and idempotency;
- retain audit trail for posted/voided batches;
- produced prep item must be a real inventory item so it can be consumed by recipes later.

Suggested tests:

- `tests/restaurant-prep-batches.test.mjs`;
- assert posting consumes ingredients and creates produced stock once;
- assert duplicate idempotency key does not duplicate movement;
- assert insufficient stock rejects;
- assert void creates reversal movements;
- assert UI uses RPC/preload APIs only.

#### Phase 6.6: Kitchen Timing Analytics

Goal: expose bottlenecks by measuring how long tickets spend in each preparation state and station.

Suggested route/component:

- `/restaurant/kitchen-analytics`;
- add from Kitchen Display and Reports.

Data requirements:

- ticket created time;
- status transition timestamps: pending, preparing, ready, served;
- station: kitchen, bar, grill, dessert, other;
- ticket item count and modifier complexity where available;
- outlet id and staff/waiter/cashier context.

Suggested data model:

- If current ticket status timestamps are insufficient, add:
  - `restaurant_ticket_status_events`
    - `id uuid primary key`
    - `lodge_id uuid not null`
    - `ticket_id uuid not null`
    - `station text null`
    - `from_status text null`
    - `to_status text not null`
    - `changed_by uuid null`
    - `changed_at timestamptz default now()`

Required RPC/API shape:

- `get_kitchen_timing_report(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null, p_station text default null)`;
- ticket status update RPC/domain path must record status events if not already recorded.

Report output fields:

- average time to start;
- average prep time;
- average ready-to-served time;
- slowest tickets;
- ticket count by station;
- late ticket count by threshold;
- station bottleneck score;
- peak hour timing.

UI requirements:

- date range filter;
- station filter;
- summary cards: average prep time, slow tickets, busiest station, peak hour;
- chart/table by station;
- slow ticket drill-down with ticket, table, waiter, items, timestamps;
- threshold settings can be hardcoded initially, e.g. warning after 15 minutes, critical after 25 minutes.

Guardrails:

- analytics should be read-only;
- do not block kitchen operations if analytics event write fails, but log safely;
- do not expose another outlet/lodge's tickets.

Suggested tests:

- `tests/restaurant-kitchen-analytics.test.mjs`;
- assert status update records event;
- assert timing report groups by station;
- assert slow ticket thresholds are rendered;
- assert route is restaurant-only;
- assert no accommodation APIs are called.

#### Phase 6.7: Low-Stock Purchase Suggestions

Goal: turn low-stock warnings into suggested purchase orders.

Suggested route/component:

- add to `/restaurant/purchasing`;
- optional dashboard widget: "Suggested PO";
- optional Stock Control action: "Create suggested purchase order".

Data inputs:

- inventory current stock;
- reorder level/par level;
- recent sales velocity;
- recipe theoretical usage;
- open purchase orders;
- supplier/item mapping if available;
- latest unit cost.

Suggested data model:

- `restaurant_supplier_items`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `supplier_id uuid not null`
  - `inventory_item_id uuid not null`
  - `supplier_sku text null`
  - `preferred boolean not null default false`
  - `pack_size numeric null`
  - `pack_unit text null`
  - `last_unit_cost numeric null`
  - `lead_time_days integer null`
- optional `restaurant_purchase_suggestions`
  - `id uuid primary key`
  - `lodge_id uuid not null`
  - `outlet_id uuid null`
  - `inventory_item_id uuid not null`
  - `supplier_id uuid null`
  - `suggested_quantity numeric not null`
  - `reason text not null`
  - `status text not null` (`suggested`, `converted`, `dismissed`)
  - `created_at timestamptz default now()`

Required RPC/API shape:

- `get_low_stock_purchase_suggestions(p_lodge_id uuid, p_outlet_id uuid default null)`;
- `upsert_restaurant_supplier_item(payload jsonb)`;
- `convert_purchase_suggestions_to_po(payload jsonb)`.

Suggested quantity formula:

- baseline: `max(reorder_level - current_stock, 0)`;
- if sales velocity is available: add projected use for lead time plus safety days;
- round up to supplier pack size where configured;
- subtract quantities already on approved/open purchase orders;
- never suggest negative quantity.

UI requirements:

- list suggested items grouped by supplier;
- show current stock, reorder level, sales velocity, suggested quantity, estimated cost, reason;
- allow manager to adjust quantities before creating PO;
- create draft PO from suggestions;
- dismiss suggestion with reason.

Guardrails:

- suggestions must not change stock;
- converting suggestions must create a normal draft purchase order using the existing PO flow;
- receiving still happens only through approved PO receive RPC;
- supplier-item mappings must be lodge-scoped.

Suggested tests:

- `tests/restaurant-purchase-suggestions.test.mjs`;
- assert suggestions subtract open PO quantities;
- assert pack-size rounding works;
- assert conversion creates draft PO, not received stock;
- assert receiving remains idempotent through existing PO receive path.

#### Phase 6.8: Manager PWA Restaurant Owner View

Goal: make the owner/manager phone view restaurant-first so the product feels complete outside the desktop app.

Surfaces:

- Manager PWA Dashboard;
- Manager PWA Reports;
- optional Manager PWA Restaurant pages for Reservations, Daily Close, Alerts, Low Stock, Staff Performance.

Required PWA behavior in restaurant mode:

- no bookings/rooms/occupancy/check-in/check-out/guest-stay language;
- show today sales;
- show order count and average order;
- show open tables;
- show kitchen pending/slow tickets;
- show low stock;
- show cash drawer status;
- show active alerts;
- show active shifts;
- show Daily Close readiness;
- show owner digest.

Suggested PWA API/RPC usage:

- Prefer existing Supabase RPCs/read queries used by desktop where safe.
- Add PWA-safe read RPCs where direct table reads would bypass intended aggregation or scope.
- Mutations from PWA should be limited to safe manager actions already supported server-side, such as resolving alerts or viewing digest, unless explicitly capability-gated.

Suggested PWA routes:

- `/restaurant`
- `/restaurant/daily-close`
- `/restaurant/alerts`
- `/restaurant/stock`
- `/restaurant/staff-performance`
- `/restaurant/reservations`

Guardrails:

- PWA does not use desktop `database.js`;
- all PWA reads/mutations must be Supabase/RPC and RLS-safe;
- PWA must not expose service-role credentials;
- high-risk actions must remain capability-gated;
- offline PWA behavior must not create a second financial truth.

Suggested tests:

- extend Manager PWA restaurant curation tests;
- build Manager PWA after changes;
- assert restaurant PWA dashboard hides accommodation language;
- assert restaurant PWA calls restaurant RPCs/read queries;
- assert owner view cannot see another lodge/outlet;
- assert PWA route guards match restaurant property type.

#### Phase 6 Navigation and Release Requirements

Restaurant sidebar additions:

- `Reservations`
- `Combos`
- `Recipe Variance`
- `Staff Performance`
- `Prep Batches`
- `Kitchen Analytics`
- `Purchase Suggestions`

Recommended grouping:

- Sell: `Reservations`, `Tables`, `POS Terminal`, `Kitchen Display`, `Combos`;
- Stock: `Recipes & Costing`, `Recipe Variance`, `Prep Batches`, `Stock Control`, `Purchase Suggestions`, `Purchasing`;
- Team: `Staff`, `Shifts`, `Staff Performance`;
- Money/Control: keep `Cash Drawer`, `Daily Close`, `Owner Digest`, `Alerts`, `Checklists`, `Reports`.

Customer feedback capture and settlement reconciliation were added in the commercial-controls pass on 2026-07-10. Direct delivery-platform order ingestion remains a future integration; settlement records reconcile external platform payouts without pretending an external platform is connected.

### WhatsApp Business operating mode

Boroko supports the normal WhatsApp Business app as an operator-assisted channel. Reservation cards open a prefilled `wa.me` confirmation or table-ready message in the installed app; staff enter accepted WhatsApp orders through the standard POS so stock, payment, kitchen routing, and audit remain authoritative. This mode has no per-message API cost and must not be described as automatic sending, inbox sync, or order ingestion. Those capabilities require an approved WhatsApp Business API provider and credentials.

### Growth & Control Centre

The restaurant workspace now exposes complete manager workflows for issuing gift cards, recording tip-pool payouts, registering stock lots with expiry dates, viewing near-expiry lots, and configuring reservation cancellation/no-show/reminder policy. These actions call role-gated Supabase RPCs through the desktop IPC boundary; they are not local-only form state. Gift cards use the existing stored-value voucher ledger, tip payouts are idempotent audit records, and lot expiry is a separate operational control rather than a rewrite of the stock-on-hand ledger.

Phase 6 implementation files likely touched:

- `src/renderer/src/navigation/desktopNav.js`;
- `src/renderer/src/App.jsx`;
- `src/renderer/src/components/restaurant/*`;
- `src/renderer/src/components/Dashboard.jsx`;
- `src/renderer/src/components/Reports.jsx`;
- `src/renderer/src/components/DataManagement.jsx`;
- `src/main/domains/pos.js`;
- `src/main/database.js`;
- `src/main/index.js`;
- `src/preload/index.js`;
- `src/shared/accessControl.js` if new capabilities are required;
- `src/shared/moduleCatalog.js` if module catalog entries are required;
- `manager-pwa/src/*` for owner mobile view;
- new Supabase migrations for tables/RPCs/RLS;
- new tests under `tests/`.

Phase 6 build order:

1. Add migrations, RLS, and RPC contracts.
2. Add desktop domain functions, IPC handlers, and preload APIs.
3. Add route guards and sidebar entries.
4. Build desktop UI pages.
5. Integrate dashboard/report/Data Management links.
6. Build Manager PWA restaurant owner view.
7. Add tests.
8. Run full verification.

Phase 6 verification commands:

- `node .\tests\restaurant-reservations.test.mjs`
- `node .\tests\restaurant-combos.test.mjs`
- `node .\tests\restaurant-recipe-variance.test.mjs`
- `node .\tests\restaurant-staff-performance.test.mjs`
- `node .\tests\restaurant-prep-batches.test.mjs`
- `node .\tests\restaurant-kitchen-analytics.test.mjs`
- `node .\tests\restaurant-purchase-suggestions.test.mjs`
- `node .\tests\restaurant-mode-curation.test.mjs`
- `node .\tests\restaurant-standalone-modules.test.mjs`
- `npm test`
- `npm run build`
- Manager PWA build script from `manager-pwa/package.json`.

Phase 6 minimum acceptance:

- restaurant reservations/waitlist works without hotel booking APIs;
- combos sell correctly in POS and preserve selected child items;
- recipe variance shows theoretical vs actual usage and does not mutate stock directly;
- staff performance shows sales, orders, voids/discounts, approvals, and cash variance;
- prep batch posting consumes source stock and creates produced stock exactly once;
- kitchen analytics shows timing and bottleneck metrics by station;
- purchase suggestions create draft POs, not stock movements;
- Manager PWA has a restaurant owner view with no accommodation language;
- all new mutations are server-authoritative, role-gated, lodge/outlet-scoped, and idempotent where retry could duplicate effects;
- lodge/hotel modes remain unaffected.

## Definition of Done for Sellable Restaurant Mode

Restaurant mode is sellable when:

- a restaurant user sees no accommodation-first navigation;
- direct route access does not expose accommodation modules;
- dashboard language is restaurant-specific;
- reports default to POS/sales, not bookings/occupancy;
- exports do not mention booking registers, rooms, occupancy, folios, or hotel KPIs;
- Manager PWA hides booking/room/occupancy concepts for restaurant properties;
- POS, returns, voids, cash-up, inventory, expenses, and staff flows still pass the existing financial/offline regression tests;
- restaurant-specific regression tests cover nav, route guarding, reports, exports, and PWA visibility;
- release notes and marketing copy describe the product honestly as POS-first.
- external card, mobile-money, voucher, bank, and delivery-platform settlements can be reconciled against recorded POS totals without changing the POS ledger;
- table deposits are held through an online, role-gated, idempotent contract and remain visibly separate from a completed sale;
- the exact supported printer, drawer, scanner, display, and payment-terminal bundle has passed an operator smoke run, including offline/recovery and end-of-day close;
- customer feedback is captured, visible to managers, and used as an operational follow-up signal rather than an untracked message.

## Strategic Recommendation

Build the restaurant product inside the same Boroko codebase, using `property_type = restaurant` as the switch.

Do not fork the app unless hardware packaging, branding, or update channels later require a separate installer. Even then, the business logic should remain shared.

The first commercial milestone should not be recipe costing. The first milestone should be a clean restaurant-facing experience over the POS foundation that already exists. Recipe costing, table management, kitchen display, and loyalty can then become sellable upgrades.

## Branch and Work Management Recommendation

Build this on top of `codex/tsa-bonno-enterprise-foundation` while restaurant mode is still part of the broader property-type/module-gating work.

Reason:

- restaurant mode uses the same `property_type`, module catalog, entitlement, navigation, reporting, POS, and Manager PWA foundations as the Enterprise/property-aware work;
- a separate branch would increase merge conflicts across `App.jsx`, `desktopNav.js`, `moduleCatalog.js`, `Reports.jsx`, `Layout.jsx`, Manager PWA pages, tests, and migration planning;
- the restaurant cleanup is mostly curation and guardrails, so it belongs with the current architecture branch until the shared foundation is ready to merge.

Recommended workflow:

- keep the current branch;
- implement one phase at a time;
- make a clear commit/checkpoint after each phase;
- keep phase-specific tests in separate files so later agents can run and extend them;
- avoid mixing restaurant changes with unrelated hotel/Enterprise feature work in the same commit;
- update `PROJECT_STATE.md` only when a phase materially changes current architecture, release state, deployment assumptions, or sellability status.

Create a separate branch only if:

- a phase becomes high-risk enough to block the Enterprise branch;
- a release must go out from Enterprise before restaurant work is ready;
- two agents need to edit the same core files at the same time;
- restaurant branding/installer/update-channel work starts.
