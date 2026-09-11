# LodgingOS Food & Beverage Progressive Activation Plan

Status: active implementation plan requested by the user on 2026-09-03.

## Product decision

Implement the complete F&B capability set, but keep the default lodge
experience compact. Core service modules are on by default. Advanced modules
are installed but off until a lodge administrator enables them inside Food &
Beverage.

Module activation is a company preference, not a licence or permission grant:

- an entitled lodge administrator can enable or disable a module;
- an entitled non-administrator sees `Ask an administrator`;
- a lodge without the required entitlement sees `Request access`;
- feature RPCs continue to enforce lodge, outlet, actor, capability, state, and
  idempotency independently of the visible toggle;
- activation requires an online, server-confirmed response and is audited.

Command Central is not part of routine module activation.

## Default experience

### Core — enabled by default

- Today overview
- Outlet context
- New order / canonical lodge POS
- Live floor and open checks
- Kitchen and bar tickets
- Basic menu availability
- Canonical F&B-filtered inventory entry
- Basic POS sales report
- Operator shift and cash-up

### Optional — visible but disabled by default

- Table reservations and waitlist
- Recipes, costing, prep batches, and recipe variance
- Purchasing, suppliers, reorder suggestions, and expiry lots
- Room-service fulfilment
- Meal plans, vouchers, and included-meal consumption
- Food-safety and temperature controls
- Team roster, performance, and tips
- Settlement and customer-funds controls
- Consolidated F&B performance reporting
- Supplier invoice three-way matching
- Occupancy-driven demand and prep planning

Disabling a module hides its operational navigation and stops new work. It
never deletes data, reverses financial records, or prevents authorised users
from reading retained audit/history where policy requires it.

## Compact interaction model

1. A single slim header contains property/outlet context and the primary
   `New order` action.
2. A `Today` landing view shows only actionable counts: open checks, waiting
   tickets, reservations due, low/expired stock, open shift, and close blockers.
3. A compact horizontal switcher contains enabled daily modules only.
4. `More tools` opens a module panel. Enabled advanced tools appear first;
   disabled tools remain visible with a short benefit statement and one clear
   activation action.
5. Each page has one title, one primary action, and no repeated hero banner.
6. Tables use sticky headers, right-aligned numbers, a single status column,
   row-level overflow actions, and responsive card fallback only below the
   table breakpoint.
7. Forms use a consistent label/control/help/error stack, 40–44px controls,
   aligned action footers, and destructive actions separated from the primary
   path.

## Visual contract

LodgingOS F&B uses only LodgingOS surface tokens:

- emerald for primary/active/success;
- slate for navigation, text, and neutral controls;
- white and light slate/emerald for surfaces;
- amber and red only for genuine warnings or destructive actions.

Restaurant plum, copper, beige gradients, and restaurant-specific typography
must not render anywhere below `.lodge-food-beverage-hub`. The standalone
Restaurant & Bar product keeps its own theme.

## Activation contract

Add a company-scoped `fnb_module_preferences` record keyed by
`(lodge_id, module_key)`, with `enabled`, `updated_by`, `updated_at`, and an
optional version for conflict detection.

Server RPCs:

- `get_fnb_module_preferences()` resolves defaults and entitlement state for
  the caller's lodge;
- `set_fnb_module_preference(module_key, enabled, expected_version)` validates
  the module allowlist, active lodge membership, `settings.manage`, commercial
  entitlement, and optimistic version before writing and auditing;
- disabling must reject when the module has an unsafe in-progress state that
  needs an explicit handover, or return the blockers for the UI to resolve.

The renderer must not infer entitlement from the toggle. The server response
returns `enabled`, `entitled`, `can_manage`, `reason`, and `version`. Offline
activation is unavailable; the UI keeps the last confirmed state and provides
a retry message.

## Implementation phases

### Phase 1 — foundation and compact UI

- finish the lodge-scoped token adapter across every embedded component;
- normalize button, field, modal, table, empty, and error hierarchy;
- add the module preference migration, RPCs, desktop domain/preload contract,
  module panel, and regression coverage;
- add shared outlet context and the Today landing view.

### Phase 2 — canonical cross-module navigation

- make Inventory consume F&B scope and outlet query state;
- make Expenses consume F&B scope and outlet query state;
- add the consolidated F&B report entry using server-confirmed sources;
- preserve filter context when returning to F&B.

### Phase 3 — guest service

- add room-service order type, delivery queue, runner assignment, preparation,
  dispatch, delivered/cancelled transitions, folio posting, kitchen routing,
  offline replay, and audit;
- add meal-plan entitlement, redemption, complimentary reason/approval, covers,
  inventory consumption, and folio/ledger rules in one atomic contract.

### Phase 4 — food and supply controls

- add food-safety check templates, temperature logs, corrective actions,
  allergen matrix, acknowledgement, and immutable audit evidence;
- add supplier invoice capture and ordered/received/invoiced three-way matching
  with variance approval and accounting handoff.

### Phase 5 — planning and intelligence

- join occupancy, events, reservations, historic covers, recipes, on-hand
  stock, and lead times into read-only demand recommendations;
- require explicit approval to create prep batches or draft purchase orders;
- add freshness, confidence, source, and exception indicators.

## Definition of done

Each phase needs server-side lodge/outlet/actor enforcement, capability checks,
idempotent mutation contracts, authoritative audit, safe retry/recovery,
explicit offline behavior, retained-history behavior when disabled, focused
regression tests, responsive and keyboard checks, affected production builds,
and an accurate deployment statement.

