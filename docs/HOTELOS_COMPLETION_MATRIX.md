# HotelOS Completion Truth Matrix

As of: 2026-07-14  
Phase: 0 baseline + Phase 1 freeze + Phase 9–13 offline/provider/truth reconciliation  
Authority: live source files, not historical status tables alone.

Classification states (implementation completeness only):

| State | Meaning |
|---|---|
| `Complete locally` | Real workflow + RPC path + focused tests in repo; linked DB / packaged smoke not proved here |
| `Complete and linked-database verified` | Above + linked Supabase deployment evidence in PROJECT_STATE / migrations |
| `Complete except external-provider certification` | Internal product complete; live OTA/payment/SMS provider not certified |
| `Partial` | Usable path exists with material gaps (workflow, offline, audit, entitlements, or tests) |
| `Foundation only` | Tables/routes/domains/config shells exist; end-to-end operational runtime incomplete |
| `Missing` | Required product behaviour not present |
| `Intentionally unavailable` | Explicit product exclusion |
| `Blocked by owner/provider decision` | Waiting on legal/provider/commercial decision |

Commercial catalogue labels (`active` / `requestable` / `planned`) are **not** completeness states.

---

## 0.1 Sources read

- `AGENTS.md`, `PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`, `docs/SHIP_READY_RUNBOOK.md`, `docs/TSA_BONNO_HOSPITALITY_OS_MANIFEST.md`, `docs/OFFLINE_MATRIX.md`
- `src/renderer/src/components/hotel/hotelNav.js`, `src/renderer/src/App.jsx`
- `src/shared/moduleCatalog.js`, `enterpriseAddons.js`, `commercialEntitlements.js`, `accessControl.js`, `entitlementMerge.js`
- `src/main/domains/subscriptionState.js` plan feature map
- Domain modules under `src/main/domains/*`, preload surface, enterprise tests, commercial SQL catalog

---

## 0.2 HotelOS navigation inventory

### Primary rail / groups (`hotelNav.js`)

| Label | Route | Component | Feature key | Add-on key | Capability (primary) | Main domain(s) | Preload | Offline | Status |
|---|---|---|---|---|---|---|---|---|---|
| Front desk | `/`, `/hotel-dashboard` | `hotel/HotelHome.jsx` | `front_desk_dashboard` | — | `front_desk_dashboard.view` | `hotel.js` | `hotel.getDashboardStats` + arrivals/etc. | Cached reads; partial failures warned; balances labelled estimates | **Partial** (board contract tests pass 2026-07-13; not night-audit authoritative KPIs) |
| Check-in / out | `/checkin-workflow` | `CheckinWorkflow.jsx` | `checkin_workflow` | — | `checkin.manage`, `checkout.manage` | `checkinWorkflow.js` | `checkinWorkflow.*` | **online_only** step complete/reset + hotel check-in/out (not queued) | **Partial** |
| Room moves | `/room-moves` | `RoomMoves.jsx` | `room_moves` | — | `room_moves.view/manage` | `roomMoves.js` | `roomMoves.*` | **queueable** with stable idempotency key | **Partial** |
| Guests | `/guests` | `Guests.jsx` | (core guests) | — | `guests.view` | `customers.js` | customers/guests APIs | Queueable profile edits | **Partial** |
| Reservations | `/bookings` | Bookings surface | `bookings` | — | `bookings.view` | `bookings.js` | bookings APIs | Queueable create + stable op IDs | **Partial** (strong foundation) |
| Calendar | `/calendar` | Calendar | `bookings` | — | bookings | bookings/rooms | calendar IPC | Cached | **Partial** |
| Quotations | `/quotations` | Quotations | `quotations` | — | `quotations.view` | quotation domains | quotations | Queueable lifecycle | **Partial** |
| Invoices | `/invoices` | Invoices | `invoices` | — | `invoices.view` | finance/bookings | invoices | Mixed | **Partial** |
| Advances | `/prepayments` | Prepayments / credit | customer credit | — | finance | `customerCredit.js` | customer credit APIs | Queueable receipt/alloc/refund | **Complete and linked-database verified** (core credit path) |
| Rooms | `/rooms` | Rooms | `rooms` / `physical_inventory` | — | `rooms.view` | `rooms.js`, `roomTypes.js`, `floorSections.js` | rooms | Queueable updates | **Partial** |
| Room grid | `/roomgrid` | Room grid | rooms | — | rooms | rooms/hotel | rooms | Cached | **Partial** |
| Housekeeping | `/housekeeping` (+ advanced routes) | `Housekeeping.jsx`, `AdvancedHousekeeping.jsx`, `HousekeepingCommandCenter.jsx` | `housekeeping`, `advanced_housekeeping` | mobile productivity not re-sold for same feature | `housekeeping.manage`, assign/inspect | `housekeepingCommandCenter.js` | housekeeping APIs | Assign/inspect **RPC-only** (no device queue yet) | **Partial** |
| Maintenance | `/maintenance` (+ enterprise) | Maintenance, `MaintenanceEnterprise.jsx` | `maintenance`, `maintenance_enterprise` | premium asset pack planned | `maintenance.*` | `maintenance.js`, `maintenanceEnterprise.js` | maintenance | Tickets queueable; **OOO/OOS online_only** | **Partial** |
| Supplies | `/supplies` | Supplies | `supplies` | — | `supplies.view` | `supplies.js` | supplies | Queueable | **Partial** |
| Folios | `/folios` | `Folios.jsx` | `folios` | — | `folios.view/manage` | `folioLedger.js`, `folios.js`, `masterFolios.js` | `folios` + ledger RPCs | **online_only** mutations (requireOnline; no queue) | **Partial** (UUID ledger present; dual surface risk) |
| Rate plans | `/rate-plans` (+ calendar/revenue/promo tabs) | `RatePlans.jsx`, `RateCalendar.jsx`, `RevenueManager.jsx` | `rate_plans` / `advanced_rates` / `rate_calendar` | `advanced_rates` premium | `rate_plans.*` | `ratePlans.js`, `rateCalendar.js`, `revenueManager.js` | ratePlans + related | Mixed | **Partial** (basic rates core) / **Foundation only** (yield/revenue) |
| Corporate | `/corporate` | `CorporateAccounts.jsx`, `CorporateBilling.jsx` | `corporate_accounts` | premium multi-property debtor depth | corporate.* | `corporateAccounts.js`, `corporateBilling.js` | corporate APIs | **online_only** charge/pay/suspend (fixed 2026-07-14) | **Partial** |
| Channels | `/channel-manager` | `ChannelManager.jsx` | `channel_manager` | `channel_manager` | channel.* | `channelManager.js`, **`channelProviderAdapter.js` fail-closed + ManualExport** | channelManager.* | Sync online_only; live OTA never fakes success; manual local export only | **Partial** (internal foundation; **not** provider-certified OTA) |
| Night audit | `/night-audit-enterprise` | `NightAuditEnterprise.jsx` | `night_audit_enterprise` | — | `night_audit.*` | `nightAudit.js` | `nightAudit.*` | **online_only** close/reopen/resolve | **Partial** (live close smoke unproved) |
| Reports | `/reports` (+ hotel-kpis / enterprise-reports) | Reports, `HotelKpis.jsx`, advanced reports domain | `reports`, `hotel_kpis`, `advanced_reports` | `advanced_reports` | `reports.view` | `reports.js`, `advancedReports.js`, `hotel.js` | reports | online reads | **Partial** |
| Expenses | `/expenses` | Expenses | `expenses` | — | `expenses.view` | `expenses.js` | expenses | Queueable | **Partial** |
| Outlet POS | `/pos` | POS | `pos` | — | `pos.view` | `pos.js` | pos | Queueable orders | **Partial** (hotel outlet posting path needs invariant proof) |
| Inventory | `/inventory` | Inventory | `inventory` | — | `inventory.view` | `inventory.js` | inventory | Queueable | **Partial** |
| Team | `/staff` | Staff (+ hotel roles tab) | `staff`, `hotel_roles` | hotel roles now Core | `staff.view` | `users.js`, `hotelRoles.js` | users/roles | online for grants | **Partial** |

### More / discovery (`HOTEL_MORE_ITEMS`)

| Label | Route | Component | Feature / addon | Status |
|---|---|---|---|---|
| Group operations | `/group-operations` | `GroupOperations.jsx` | `group_operations` addon | **Foundation only** / **Partial** (small domain 2.7KB) |
| Guest CRM | `/guest-crm` | `GuestCRM.jsx` | `guest_crm` addon | **Partial** |
| Guest messaging | `/guest-messaging` | `GuestMessaging.jsx` | `guest_messaging` addon | **Partial** (email when SMTP configured; SMS/WhatsApp `not_configured`; never marks sent without provider) |
| Guest portal | `/guest-portal` | `GuestPortalConfig.jsx` (hotel config) + booking-site `/portal` | `guest_portal` addon | **Partial** (config + public portal shell; full self-service incomplete) |
| Compliance | `/operations-compliance` | Operations compliance workspace | `operations_compliance` | **Partial** (errors no longer swallowed; depth incomplete) |
| Multi-property | `/multi-property` | Multi-property UI | `multi_property` | **Partial** (switch fails closed; dual-lodge smoke unproved) |
| Multi-outlet POS | `/multi-outlet-pos` | Multi-outlet surface | `multi_outlet_pos` | **Partial** |
| Day use | `/dayuse` | Day use | `pool` / dayuse | **Partial** |
| Conference | `/conference` | Conference/events | `conference` | **Partial** |
| Early / late stays | bookings tab | Early/late policies | `early_late_checkout` | **Partial** |
| Cancellation policies | bookings tab | Cancellation policies | `cancellation_policies` | **Partial** |
| Data import | `/data-management` | Data management | `import` | **Partial** |
| Ops AI | `/ai` | AI assistant | none | Out of Hotel Core completeness scope |

### Module catalogue items not always on primary nav

| Module key | Catalog status | Implementation note |
|---|---|---|
| `documents` | addon / active catalog | Domain `documentSystem.js` + UI; **Partial**; sold as add-on despite core document needs |
| `room_attributes` | addon | Domain present; **Partial**; essential attributes should be core |
| `payment_gateway` | requestable | Webhook security tests exist; merchant certification open → **Complete except external-provider certification** or **Partial** |
| `custom_website` | planned / foundation | Checklist/config, not full deployment product → **Foundation only** |
| `advanced_booking_engine` | planned/active mixed | Domain + booking-site; **Partial** |
| `linen_laundry`, `lost_found`, `incident_log`, `visitor_register`, `emergency_list` | planned addons | Routes/domains uneven; many **Foundation only** |
| `subscription_builder` | active | Commercial quote path → **Partial** (activation live proof separate) |

---

## 0.3 False completion signals (detected)

| Signal | Evidence | Impact |
|---|---|---|
| Provider adapter no-op / fail-closed stub | `channelProviderAdapter.js` always `notConnected` | Channel Manager cannot claim provider completeness |
| Config without full runtime | Desktop Guest Portal is `GuestPortalConfig.jsx`; guest app lives under booking-site `/portal` | Do not treat config screen as full Guest Portal product |
| Error → empty success data | `HotelHome.jsx` uses `.catch(() => [])` per board query | Empty board can look “healthy” |
| Local KPI estimates | Front-desk occupancy / outstanding balances computed client-side from room/booking fields | Not authoritative night-audit / ledger KPIs |
| Catalog vs feature map drift | Sales copy: “rates… and night audit”; `HOTEL_CORE_FEATURES` omits `rate_plans`, `night_audit_enterprise`, `checkin_workflow` | Clean Hotel Core licence may lock essential ops |
| Double-charge ambiguity | `advanced_housekeeping` in Hotel Core features **and** `advanced_housekeeping_mobile` sellable addon mapping to same feature key | Commercial confusion |
| Rate plans sold as add-on | `rate_plans` addon + `PLAN_FEATURE_MAP.Enterprise.rate_plans = false` | Normal hotel day requires rates |
| Documents / hotel roles as add-ons | Catalog addon keys while operational docs/roles are basic necessities | Core/add-on ambiguity |
| `group_operations` missing from `entitlementMerge` addon map | `entitlementMerge.js` has no `group_operations` feature grant | Activation may not unlock module |
| Enterprise plan grants planned modules | e.g. `channel_manager: true`, `linen_laundry: true` on Enterprise map while addons planned | Feature wall does not match commercial intent |
| Contract-name tests | Many `enterprise-*.test.mjs` assert SQL/source string presence | Not financial invariant / replay proof |
| `hotelRoles.js` silent empty catch | RPC failures return `[]` | Empty roles look like “no templates” not error |
| Dual folio surfaces | `folios.js` (legacy) + `folioLedger.js` (UUID) | Risk of incomplete UI wiring to full ledger RPCs |
| Commercial SQL hotel_core features | Migration `20260712170000` mirrors incomplete `HOTEL_CORE_FEATURES` list | Server activation can under-entitle |

---

## 0.4 Hotel Core boundary decision (input to Phase 1)

### Essential Hotel Core (must not require optional purchase)

Operational: front desk, reservations/calendar, quotations/invoices, advances/credit, guests, rooms/types/floors, essential room attributes, room grid, check-in/out workflow, room moves, basic housekeeping (dirty/clean/inspect/assign), basic maintenance tickets + OOO, guest folios/ledger, **basic rate plans + assignment**, night audit, core reports, expenses, staff + **basic hotel role templates**, operational document generation (quote/invoice/folio/receipt/registration), data import/export, basic inventory/supplies, outlet POS charge posting, manager visibility.

### Premium depth (remain add-ons after completion)

| Area | Core | Premium |
|---|---|---|
| Rates | Seasons, weekday/weekend, room-type rates, restrictions, overrides | Yield automation, promo engine, revenue recommendations, competitor notes |
| Corporate | Profile, billing contact, terms, charge to company, invoice/statement, payment allocation | Central credit limits, multi-property debtor, aging workflows |
| Housekeeping | Status, assign, inspect, blockers, turnaround timestamps | Mobile optimisation pack, productivity analytics |
| Attributes | Bed/view/accessibility essentials on inventory | Attribute-driven selling / advanced merchandising |
| Roles | Hotel desk/HK/maintenance role templates | Workforce scheduling & productivity |
| Documents | Operational templates + PDF for normal stay docs | Advanced template marketplace / multi-brand packs |
| Night audit | Daily close, exceptions, posting, reopen, pack | Advanced analytics packs only if separate |
| Channels / OTA | — | Full channel manager + provider adapters |
| Guest exp | — | CRM, messaging, portal, payment gateway |
| Groups/events | Multi-room stay invoice (existing) | Group operations suite, advanced events |
| Multi-property | — | Group dashboard |

---

## 0.5 Prioritised backlog (post-Phase 0)

### P0 — Contract freeze (Phase 1)

1. Expand Hotel Core included features (client + commercial SQL + plan map).
2. Move basic `rate_plans`, `night_audit_enterprise`, `checkin_workflow`, `early_late_checkout`, `cancellation_policies`, `documents`, `hotel_roles`, essential `room_attributes` into Core entitlements.
3. Split premium packaging: `advanced_rates`, mobile HK, full corporate debtor, channel, guest*, multi-property, group_ops.
4. Fix `entitlementMerge` (`group_operations` + consistent maps).
5. Align nav locks, UpgradeWall, module catalog `isAddon` flags, tests.

### P1 — Hotel day operational close (Phase 2)

1. Front desk: no silent empty data; actionable exceptions; real blockers (dirty/OOO/balance/VIP).
2. Reservations: multi-room, rate snapshots, concurrency, offline stable IDs (prove end-to-end).
3. Check-in/out: identity, deposits, readiness, registration, manager override audit.
4. Room moves: rate/folio/HK consequences.
5. Housekeeping + maintenance core workflows + PWA where promised.

### P2 — Financial core (Phase 3)

1. Folio ledger full mutation set via RPCs; split/transfer/void/lock.
2. POS→folio idempotent posting + checkout blockers.
3. Deposits/credit edge cases.
4. Core corporate settlement.
5. Night audit invariant tests (replay, force, reopen, date lock).

### P3 — Reports & documents (Phase 4)

1. Core KPI reconciliation to ledgers.
2. Document generation for all operational types + immutable finals.
3. Advanced reports remain premium.

### P4 — Revenue & distribution (Phase 5)

1. Complete basic rate plans in core.
2. Advanced rate/revenue/booking engine premium paths.
3. Channel internal queues + one real provider adapter (no fake success).

### P5 — Guest experience (Phase 6)

1. CRM, messaging (email transport), guest portal runtime, booking website, online payments.

### P6 — Remaining enterprise modules, offline matrix, multi-property, verification, truth reconciliation

Phases 7–13 per master plan. **Phase 14 commercial bundling blocked** until completion report accepted.

---

## 0.6 Evidence summary for current workspace claims

| Claim in PROJECT_STATE / marketing | Verified here |
|---|---|
| UUID hotel folio ledger migrations applied | Repo + PROJECT_STATE linked apply notes; UI/domain present → **local partial + linked migration claim** |
| Night audit enterprise route is live UI | Confirmed `NightAuditEnterprise.jsx` + domain; operator smoke unproved |
| Channel manager | Internal UI + fail-closed provider → **not complete** |
| Hotel Core price P37,998 | Commercial catalog present |
| Enterprise suite tests | Many name/SQL contract tests; not full invariant suite |
| Packaged operator smoke | Explicitly unproved in PROJECT_STATE |

---

## Phase 0 exit gate

- [x] Project instructions and architecture/offline/manifest read
- [x] HotelOS nav + catalog + entitlements inventoried against code
- [x] Completion states assigned without commercial labels
- [x] False completion signals listed with file evidence
- [x] Prioritised backlog for Phases 1+

---

## Phase 1 — Hotel Core contract freeze (2026-07-13)

### Boundary encoded

| Module | Decision |
|---|---|
| `rate_plans` | **Hotel Core** (basic rates). Premium: `advanced_rates` / yield / revenue manager |
| `corporate_accounts` | **Hotel Core** (profile + settlement). Premium: multi-property debtor/aging depth |
| `documents` | **Hotel Core** operational templates |
| `hotel_roles` | **Hotel Core** role templates |
| `room_attributes` | **Hotel Core** essential attributes |
| `night_audit_enterprise`, `checkin_workflow`, `early_late_checkout`, `cancellation_policies` | **Hotel Core** |
| `advanced_housekeeping` readiness | **Hotel Core**; mobile productivity pack not re-sold for same feature |
| `channel_manager`, guest*, multi-property, advanced_rates, group_ops, payment_gateway | Remain premium / planned |

### Files updated

- `src/shared/commercialEntitlements.js` — expanded `HOTEL_CORE_FEATURES`
- `src/main/domains/subscriptionState.js` — Enterprise plan map aligned
- `src/shared/entitlementMerge.js` — premium map + `group_operations`
- `src/shared/moduleCatalog.js` / `enterpriseAddons.js` / `hotelNav.js` / `propertyTypes.js`
- Marketing: `enterprise.html`, `packages.html`
- Migration: `supabase/migrations/20260713200000_hotel_core_entitlement_boundary.sql` (**local; push separately**)
- Tests: foundation, entitlement gating, marketing contract, `tests/hotel-core-entitlement-boundary.test.mjs`

### Verification run

- `node --test tests/enterprise-foundation.test.mjs tests/commercial-catalog-authority.test.mjs tests/marketing-site-contract.test.mjs tests/enterprise-entitlement-gating.test.mjs tests/enterprise-sidebar-curation.test.mjs` → **200/200 pass**
- `node --test tests/hotel-core-entitlement-boundary.test.mjs` → **9/9 pass**
- Linked `db:push` for `20260713200000` **not yet run** in this session

### Phase 1 exit gate

- [x] Core vs premium boundary encoded in feature sets, catalogue, merge, nav locks, marketing
- [x] Focused tests prove clean Enterprise/Hotel Core unlocks hotel-day modules without add-ons
- [ ] Linked Supabase commercial catalog row updated via migration push (deployment gate)
- [ ] Manual hotel-day simulation on packaged app (later phases)

**Next:** Phase 2 operational workflows (front desk board truthfulness first).

---

## Final orchestration report (2026-07-14)

Multi-agent execution closed Phases 0–13. **Phase 14 commercial bundling not started.**

### Linked database

Migrations applied via `npm run db:push`:

1. `20260713200000_hotel_core_entitlement_boundary.sql`
2. `20260713210000_folio_charge_payment_idempotency.sql`
3. `20260714120000_hotel_reports_ledger_restore.sql`

### Module status snapshot (implementation completeness)

| Area | Status |
|---|---|
| Hotel Core entitlement contract | **Complete and linked-database verified** (feature keys) |
| Front desk board | **Partial** → improved; estimates labelled; not night-audit authoritative |
| Check-in / room moves / HK / maintenance | **Partial** (real RPC workflows; e2e operator smoke unproved) |
| Folio ledger + night audit + corporate | **Complete locally** + online_only + charge/payment idempotency linked |
| Documents + advanced reports | **Partial** / **Complete locally** for restored report RPCs |
| Channel manager | **Complete except external-provider certification** (manual export only) |
| Guest messaging/CRM/portal | **Partial** (email when SMTP; SMS/WA not configured) |
| Multi-property / group ops | **Partial** / foundation depth |
| Payment gateway live | **Complete except external-provider certification** |
| Phase 14 commercial suites | **Blocked by owner/provider decision** (await acceptance) |

### Tests evidence

- `tests/hotel-*.test.mjs` → 103 pass
- `npm run test:enterprise` → 28 suites pass
- `npm run test:commercial` → 9 pass

### Explicit non-claims

- Not every planned premium module is sellable-complete.
- No packaged HotelOS hotel-day smoke.
- No live OTA/SMS/WhatsApp merchant certification.
- Do not start suite pricing until this report is accepted.

---

## Phase 9–13 — Offline matrix, provider readiness, multi-property, verification, truth reconciliation (2026-07-14)

### Scope completed this pass

| Work item | Result |
|---|---|
| Offline classifications vs domain code | Verified; **unsafe corporate offline queue removed**; folio/night audit already online_only |
| Check-in classification | Matrix previously said queueable; **code is online_only** — matrix corrected to match safer code |
| Housekeeping queue claim | Matrix previously said queueable; **code is RPC-only** — documented |
| Provider readiness doc | `docs/HOTELOS_PROVIDER_READINESS.md` (payment, email, SMS, WhatsApp, OTA, domains) |
| Regression scenarios | `docs/HOTELOS_REGRESSION_SCENARIOS.md` — 15 scenarios (10 pass / 5 unproved / 0 fail after fix) |
| Offline safety tests | `tests/hotel-offline-entitlement-safety.test.mjs` + corrected `enterprise-offline-contract.test.mjs` |
| Commercial bundling (Phase 14) | **Not started** (blocked until completion report accepted) |

### Domain fixes (financial safety)

| File | Change |
|---|---|
| `corporateBilling.js` | charge/payment/suspend/reactivate **requireOnline**; removed `queueOperation`; offline credit check no longer invents `within_limit: true` |
| `earlyLateCheckout.js` | approve early/late **requireOnlineApproval** |
| `cancellationPolicies.js` | fee/process/approve **requireOnlineFinancial** |
| `maintenanceEnterprise.js` | OOO/OOS/return **requireOnlineAvailability** |
| `payments.js` | confirm + record webhook reject offline with `onlineOnly` |
| `abandonedPaymentRecovery.js` | recoverSession reject offline with `onlineOnly` |
| `nightAudit.js` / `folioLedger.js` | Confirmed already online_only (no change required beyond verification) |

### Documents written / updated

- `docs/OFFLINE_MATRIX.md` — reconciled to live code
- `docs/HOTELOS_PROVIDER_READINESS.md` — **new**
- `docs/HOTELOS_REGRESSION_SCENARIOS.md` — **new**
- this matrix — offline columns + multi-property risk note

### Automated verification (this session)

```
node --test tests/hotel-offline-entitlement-safety.test.mjs \
  tests/enterprise-offline-contract.test.mjs \
  tests/enterprise-lower-tier-regression.test.mjs
→ 41/41 pass

npm run test:enterprise
→ Enterprise regression gate passed (28 suites)
```

### Still unproved / not complete

- Packaged HotelOS operator smoke (full hotel day)
- POS → hotel folio idempotent posting invariant e2e
- Live multi-property dual-lodge smoke
- Live OTA provider adapter (fail-closed; ManualExport is local only)
- Payment merchant certification; SMS/WhatsApp carrier delivery
- Linked commercial catalog migration push (Phase 1 deployment gate)

### Phase 9–13 exit gate

- [x] Offline matrix matches domain enforcement for financial online_only ops
- [x] Unsafe offline queue of corporate financial ops fixed / remains fixed after Phase 3
- [x] Provider readiness matrix written from code
- [x] 15 regression scenarios documented with pass/fail/unproved
- [x] Focused offline safety tests added and passing
- [x] Full enterprise suite green (28 suites)
- [ ] Packaged operator smoke
- [ ] Phase 14 commercial bundling (blocked)
