# Agent C rendered walkthrough — evidence (LodgingOS property adaptation)

Date: 2026-10-15. Harness: `evidence/render-walkthrough.mjs` (Playwright +
system Edge headless, full-page PNG). Fixtures are synthetic and isolated;
the live profile was never read or relabelled.

## What was actually rendered

Each page calls the REAL production resolvers with a fixture input:

- `getPropertyPresentation({ propertyType, accommodationMix })`,
  `summarizeAccommodationMix`, `describePresentationDiff`,
  `mapPropertyTransitionError`, `getLodgingBusinessLabel`
  (src/shared/propertyPresentation.js — read-only use);
- `getVisibleModules` / `getLockedModules` / `resolveModuleVisibility`
  (src/shared/moduleCatalog.js — includes the Agent C catalog extension);
- `computeStayTotal`, `describeRateMode`, `validateCampsiteOccupancy`,
  `getCampsiteOccupancyDefaults`, `normalizeAccommodationKind`
  (src/shared/accommodation.js — includes the Agent C helpers);
- `getUiVocabulary` (src/shared/uiVocabulary.js).

Sections per page: Settings transition journey (target select limited to the
five same-product types, advisory preview copy, explicit-confirm copy, a
blocker example, timeout-recovery copy) · navigation/search (live catalog
lists for the fixture plan) · inventory (fixture units, mix kind/source,
board/readiness/dashboard/exclusive-use wording) · booking estimates per
rate mode (live `computeStayTotal` numbers, validation + defaults proof) ·
quotation→booking carry note.

The transition API states on these pages are MOCKED and labelled as such:
they demonstrate the required journey copy, not a live preview/commit RPC
round-trip (server RPC ownership sits with Agent B; Settings.jsx with
Agent A). Full React screens (Settings.jsx, Bookings.jsx) are not mounted:
they require the Electron IPC/vite stack. The numbers, labels, lists and
wording on every page are real resolver outputs, not hand-written copy.

## Results per type

| Page | Evidence PNG | Result |
|---|---|---|
| guest_house (Standard, rooms-only, explicit) | `walkthrough-guest_house.png` (168 KB) | Rooms · Room Board · “Full guest house” · conference/pool VISIBLE, pos/inventory LOCKED (plan) · estimates site 300 / person 450 / tent 200 / vehicle 120 / composite 1010 (2n, BWP) |
| bnb (Standard, rooms-only, explicit) | `walkthrough-bnb.png` (168 KB) | Same alignment shape as guest_house; B&B wording; plan locks intact |
| lodge (Pro, mixed, explicit) | `walkthrough-lodge.png` (156 KB) | Sites & Units · Stay Board · mixed readiness · all four services VISIBLE |
| camp (Pro, sites-only, explicit) | `walkthrough-camp.png` (179 KB) | Sites · Site Board · site readiness · “Full camp”; variant panel: sites→Sites/Site Board, mixed→Sites & Units/Stay Board, rooms→Rooms/Room Board |
| motel (Standard, rooms-only, explicit) | `walkthrough-motel.png` (168 KB) | Rooms · Room Board; conference/pool HIDDEN (unchanged scope), pos/inventory per plan |

Booked fixture units render inline with their kind/status on every page
(e.g. “Room 103 · occupied”, “Campsite A2 · occupied”): booked inventory is
never hidden by type. HTML sources (`walkthrough-<type>.html`) and
`render-manifest.json` sit alongside the PNGs for re-verification.

## Limitations (honest)

1. Harness pages, not full app screens: layout/chrome differ from
   Bookings.jsx/Settings.jsx; journey API states are mocked.
2. Fixture inventory (2–4 units) stands in for live rooms-table reads.
3. ~~Single-room server quotation conversion still carries adults/children only
   (server `convert_quotation_to_booking` scope — migration-owned, recorded
   as a residual gap for the parent, not silently fixed client-side).~~
   RESOLVED 2026-10-15 (parent pass): migration
   `20261014030000_campsite_quotation_conversion_carry.sql` carries a lone
   campsite line (tents/vehicles/adults/children) with server-verified totals
   and persists the accommodation details row; the multi-room comparison now
   matches actual tents/vehicles instead of forcing 0. Behavioral proof in
   `tests/campsite-quotation-conversion.test.mjs` (5/5) plus migration guard
   (3/3); live proof in `tests/campsite-quotation-conversion-sql.test.mjs`
   (disposable DB, SKIPs without credentials).
4. No live Supabase round-trip was performed from this harness; RPC truth is
   covered by the node test suites listed in the Agent C report instead.

---

# Addendum — Agent C R7 priced-family rendered verification (2026-10-16)

Harness: throwaway driver executed from the OS temp dir (Playwright 1.59.1 +
system Edge headless, full-page PNG; same launch pattern as
`evidence/render-walkthrough.mjs`). Outputs committed under `evidence/` ONLY:

| Page | Evidence PNG (HTML alongside) | Result |
|---|---|---|
| tent-kind priced contract | `r7-tent-estimates.png` (98 KB) | `CAMPSITE_PRICED_KINDS = ["campsite","tent"]`; R7 probe (tent 100/night + 70/person, 2 adults, 3 nights) estimates **BWP 420.00** — room-night fallback (300.00) gone; all 5 rate modes MATCH server shape; 2+1 vs max_occupancy=2 PASSES; adult/child/tent/vehicle overcapacity each REJECT with field-specific messages; display stays “Permanent tent T1” (`isCampsiteUnit(tent) = false`) |
| mixed room/tent/site group | `r7-mixed-group.png` (46 KB) | Per-line counts/estimates/validation for Site A1, Tent T1, Room 101 (2 nights); hostile tents=9/vehicles=9 on Room 101 zeroed by the real `buildGroupRoomLines` before the domain |
| shell/mix consistency | `r7-shell-mix.png` (61 KB) | Legacy lodge profile + loaded mixed inventory: sidebar **Sites & Units / Stay Board**, body identical — consistent; profile-only fallback stays Rooms; all five types shell==body |
| failure & recovery | `r7-failure-recovery.png` (64 KB) | Real validator messages (overcapacity, rate-mode minimum); edit restores saved `tents_count`/`vehicles_count`; stable `create-booking:<id>` keys; financial-authorship tripwire flags `amount_paid, payment_status` |

`r7-render-manifest.json` lists the four pages. Fixtures are synthetic units
T1/A1/101 only; the live profile, settings, and database were never touched.

## What was actually rendered (honest)

Each page calls the REAL production modules — the same instances the desktop
renderer and main domain import: `src/shared/accommodation.js` (priced-family
contract, estimators, validators, group-line builder, occupancy restore,
financial tripwire, kind labels), `src/shared/propertyPresentation.js`
(mix summary), and `src/renderer/src/navigation/desktopNav.js`
(`getDesktopNavItems` — the exact function `Layout.jsx` calls for sidebar
labels/keywords). Every number, label, and validation message on the pages is
a live return value of those functions, not hand-written copy.

Mounted vs harness-level: these pages are NOT mounted `Bookings.jsx`,
`Rooms.jsx`, or `Layout.jsx` React screens — mounting them requires the
Electron IPC/vite React stack, which is unavailable to a node harness in this
environment (no jsdom/testing-library; full renderer builds were out of scope
for this bounded pass). What IS production-mounted: the shared contract
modules both sides execute, the real sidebar-label function with loaded-mix
input, and the real main-domain booking functions with scripted transport
(`tests/campsite-booking-journey.test.mjs` domain tests: 20/20, including
offline queue envelopes and the online server-quote shape). Full React-screen
mounts remain a recorded residual for parent acceptance (R6).

---

# Addendum — Agent A F1 public permanent-tent parity (2026-10-16)

Scope: `supabase/migrations/20261014080000_public_priced_tent_parity.sql`
(NEW), `booking-site/src/pages/BookingPage.jsx` (priced-family checks only;
unrelated in-flight idempotency edits preserved),
`booking-site/src/test/booking-tent-parity.test.jsx` (NEW, 24 vitest),
`tests/public-tent-booking-sql.test.mjs` (NEW, genuine-skip without
`LUNA_REMEDIATION_TEST_DB_URL`). No production writes, no db:push, no
releases, no customer fixtures.

## Reassessment: the old "booking-site unaffected" claim was wrong

`20261014060000` deliberately left `create_online_booking` on its old
campsite-only branch and noted booking-site as out of scope. That note was
an integration gap, not evidence of non-impact (F1). Verified against the
working tree on 2026-10-16:

1. **Client dropped tent counts.** `BookingPage.jsx` used `isCampsiteUnit`
   (campsite-only) for count clamping, per-line tents/vehicles carry,
   estimate selection and stepper ceilings. A permanent tent fell through to
   the room path: tents/vehicles reset to zero, room-style totals shown, and
   the `max_occupancy` clamp/stepper/gate destroyed valid input (e.g. a
   valid 2-adult + 1-child tent stay at `max_occupancy: 2` could not even be
   submitted). Fixed: all pricing/occupancy/count/estimate/quote-selection
   decisions now use `isCampsitePriced`; `isCampsiteUnit` no longer appears
   in the page (display wording — "Permanent tent" badge, room titles — is
   untouched and asserted in tests).
2. **Server dropped tent counts.** The live inner implementation
   `create_online_booking_legacy` (20260703153000 body + 20260711200000
   patch) carried tents/vehicles ONLY on multi-room `rooms[]` lines, so tent
   singles/full-lodge persisted 0/0; its `max_occupancy` gate rejected valid
   priced stays before the campsite rules ran; its `='campsite'` total branch
   routed tents to the room rate-plan total; and it stamped the inventory
   kind instead of the desktop-agreed priced-family label. Fixed in
   `20261014080000` (patches 1–5b): single/full-lodge line carry,
   independent adult/child/tent/vehicle caps + rate-mode minimums with no
   earlier room gate, priced-family expected-total routing (full-lodge keeps
   its whole-property total), `'campsite'` family label on booking + details
   rows (desktop parity; `rooms` inventory keeps truthful `'tent'`).
3. **Receipt binding ignored occupancy.** The live `create_online_booking`
   envelope (20261005050000) verified room/adult/child binding only. Fixed
   (patches 6a–6b): per-line `tents_count`/`vehicles_count` + mandatory
   matching occupancy details rows for multi-room lines; single-room
   occupancy + details verified against the top-level payload. Mismatches
   raise `P0001` and roll back (fail closed, same as existing checks).

## Verified unaffected (with reasons, not assumptions)

- `get_available_rooms`: tent rooms already surface in the rooms leg
  (`<> 'campsite'` includes normalized `'tent'`) with full campsite
  metadata columns and a truthful `'tent'` kind; display totals come from
  `compute_accommodation_stay_total`, whose tent default was extended to the
  priced family by `20261014060000` (8). Moving tents into the campsites leg
  would mislabel them (`'campsite'::text` is hardcoded there) — rooms-leg
  placement is intentional and kept.
- `get_public_booking_offers`: a tents-only property still reports
  `offers.rooms = true`, so tents stay bookable through the rooms offer.
- `quote_room_stay`: delegates to `room_booking_expected_total`, which
  inherits tent handling via `20261014060000` (6); the booking site does not
  call it (estimates come from shared `computeStayTotal`).
- Grants: patches are `EXECUTE`d string replacements (precedent:
  `20261014060000`), so the legacy stays revoked from anon/authenticated
  (server-only) and the envelope stays granted to
  anon/authenticated/service_role. Asserted in the SQL suite.

## Fail-closed statement

No public permanent-tent path remains intentionally unsupported: single,
multi-room and full-lodge tent bookings are priced, capped, persisted and
bound. Overcapacity, zero-tent tent-mode, and mismatched-key reuse all fail
closed server-side (`booking_rejected` / `idempotency_conflict`, zero
partial rows — asserted live in the SQL suite, pending disposable
credentials). Client ceilings are guides only; server errors surface through
the existing guest-safe error mapping. Display kind stays `"Permanent tent"`.

## Evidence produced

- `booking-site` vitest: **24/24 passed** (5 rate-mode estimates, caps,
  group carry/zeroing, restoration incl. null-cap uncapped, no financial
  authorship, 7 mounted `BookingPage` journeys incl. stable-key replay
  across remount). Full booking-site suite + build counts in the Agent A
  handover (this addendum records the scope, not the final tallies).
- `tests/public-tent-booking-sql.test.mjs`: genuine `test.skip` without
  credentials (no placeholder pass); covers 5 modes, 2+1 family stay,
  overcapacity/zero-tent fail-closed, group binding, exact replay vs
  mismatch, room-path stability, full-lodge exclusivity, grants. **Live
  disposable execution is an open gate** (no `LUNA_REMEDIATION_TEST_DB_URL`
  in this environment).
- Migration fragments verified offline: all 8 `pg_get_functiondef` old
  fragments occur exactly once in their effective deployed sources
  (reconstructed from the migration chain; CRLF normalization included for
  the CRLF-encoded 20261005050000 wrapper); E-string quoting balanced
  (16 literals / 8 patches / 8 executes).

## Manual impact

No manual update required: this change is isolated to the LodgingOS public
booking path (permanent-tent pricing/occupancy parity). Bar setup,
navigation, controls, permissions, workflows, stock/financial behavior,
recovery guidance, equipment and features are untouched (no
`src/renderer/**`, `src/main/**`, `manager-pwa/**`, `legacy-pos/**` changes;
no Bar manual files touched).
