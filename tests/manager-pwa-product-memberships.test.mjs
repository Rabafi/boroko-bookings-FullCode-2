import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  isHospitalityPosProductFamily,
  isHotelProductFamily,
  isLodgeCampProductFamily,
  isProductCompatiblePropertyType,
  resolveProductFamily,
  getProductFamilyLabel,
  normalizePropertyTypeForProduct
} from '../src/shared/productIdentity.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260712200000_manager_pwa_product_memberships.sql'),
  'utf8'
)
const api = fs.readFileSync(path.join(root, 'manager-pwa/src/lib/api.js'), 'utf8')
const auth = fs.readFileSync(path.join(root, 'manager-pwa/src/contexts/AuthContext.jsx'), 'utf8')
const login = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/Login.jsx'), 'utf8')
const shell = fs.readFileSync(path.join(root, 'manager-pwa/src/lib/productShell.js'), 'utf8')
const bottomNav = fs.readFileSync(path.join(root, 'manager-pwa/src/components/BottomNav.jsx'), 'utf8')
const hotelFrontDesk = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/HotelFrontDesk.jsx'), 'utf8')
const hotelFolios = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/HotelFolios.jsx'), 'utf8')
const propertyOperations = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/PropertyOperations.jsx'), 'utf8')
const restaurantOperations = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/RestaurantOperations.jsx'), 'utf8')
const hotelStayWorkflow = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/HotelStayWorkflow.jsx'), 'utf8')
const hotelNightAudit = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/HotelNightAudit.jsx'), 'utf8')
const restaurantFloorKitchen = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/RestaurantFloorKitchen.jsx'), 'utf8')
const restaurantMenu = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/RestaurantMenu.jsx'), 'utf8')
const prepayments = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/Prepayments.jsx'), 'utf8')
const managerApp = fs.readFileSync(path.join(root, 'manager-pwa/src/App.jsx'), 'utf8')
const hotelRevenue = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/HotelRevenue.jsx'), 'utf8')
const roomSupplies = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/RoomSupplies.jsx'), 'utf8')
const pwaAccess = fs.readFileSync(path.join(root, 'manager-pwa/src/lib/access.js'), 'utf8')
const more = fs.readFileSync(path.join(root, 'manager-pwa/src/pages/More.jsx'), 'utf8')

test('product family mapping: motel is Lodge & Camp; pos_only is hospitality-pos', () => {
  assert.equal(resolveProductFamily('motel'), 'lodge-camp')
  assert.equal(isLodgeCampProductFamily('motel'), true)
  assert.equal(isHotelProductFamily('motel'), false)

  assert.equal(normalizePropertyTypeForProduct('pos_only'), 'restaurant')
  assert.equal(resolveProductFamily('pos_only'), 'hospitality-pos')
  assert.equal(isHospitalityPosProductFamily('pos_only'), true)
  assert.equal(isProductCompatiblePropertyType('hospitality-pos', 'pos_only'), true)

  assert.equal(resolveProductFamily('hotel'), 'hotel')
  assert.equal(resolveProductFamily('resort'), 'hotel')
  assert.equal(resolveProductFamily('camp'), 'lodge-camp')
  assert.equal(getProductFamilyLabel('hospitality-pos'), 'Tsa Bonno Restaurant & Bar POS')
})

test('SQL exposes list memberships without sessions and issue session after selection', () => {
  assert.match(migration, /create or replace function public\.resolve_product_family/)
  assert.match(migration, /when 'motel' then 'lodge-camp'/)
  assert.match(migration, /when 'pos_only' then 'restaurant'/)
  assert.match(migration, /create or replace function public\.list_manager_pwa_memberships/)
  assert.match(migration, /create or replace function public\.issue_manager_pwa_session/)
  assert.match(migration, /product_family text/)
  assert.match(migration, /product_family_label text/)
  assert.match(migration, /package_label text/)
  assert.match(migration, /effective_features jsonb/)
  // List path must not call issue_app_session
  const listFn = migration.slice(
    migration.indexOf('create or replace function public.list_manager_pwa_memberships'),
    migration.indexOf('create or replace function public.issue_manager_pwa_session')
  )
  assert.doesNotMatch(listFn, /issue_app_session/)
  // Issue requires lodge id and mints once
  assert.match(migration, /A company must be selected before a manager mobile session can be issued/)
  assert.match(migration, /issue_app_session/)
  // Compatibility authenticate path does not bulk-mint when lodge is null
  assert.match(migration, /if p_lodge_id is null then/)
  assert.match(migration, /null::text as session_token/)
})

test('desktop membership SQL uses resolve_product_family including motel and pos_only', () => {
  assert.match(migration, /public\.resolve_product_family\(coalesce\(s\.property_type/)
  assert.match(migration, /list_desktop_product_memberships/)
})

test('PWA client uses list + issue split and never keeps password for chooser', () => {
  assert.match(api, /export async function listManagerPwaMemberships/)
  assert.match(api, /export async function issueManagerPwaSession/)
  assert.match(api, /list_manager_pwa_memberships/)
  assert.match(api, /issue_manager_pwa_session/)
  assert.match(api, /return \{ memberships: available, user: null \}/)
  assert.doesNotMatch(api, /const entitled =|const enabledRows =|const entitledRows =/)
  assert.match(api, /Manager mobile app access is not included or active for this business/)
  assert.doesNotMatch(api, /getSubscriptionPlan/)

  assert.match(auth, /pendingMemberships/)
  assert.match(auth, /selectMembership/)
  assert.doesNotMatch(auth, /pendingCredentials/)
  assert.doesNotMatch(auth, /pendingCredentials\.password/)
  assert.doesNotMatch(auth, /setPendingCredentials/)

  assert.match(login, /Select your business/)
  assert.match(login, /product_family/)
  assert.match(login, /selectMembership/)
})

test('multi-property PWA keeps every membership visible and switches with a fresh server session', () => {
  assert.match(api, /export function isManagerPwaMembershipSelectable/)
  assert.match(api, /const selected = rows\.find\(\(row\) => row\.lodge_id === String\(lodgeId\)\.trim\(\)\.toLowerCase\(\)\)/)
  assert.doesNotMatch(api, /const selected = rows\.find\([\s\S]{0,180}\) \|\| rows\[0\]/)
  assert.match(auth, /availableMemberships/)
  assert.match(auth, /const switchMembership = async \(membership\)/)
  assert.match(auth, /memberships = await listManagerPwaMemberships\(\)/)
  assert.match(auth, /await logoutManagerSession\(previousToken\)/)
  assert.match(auth, /await logoutManagerSession\(nextToken\)\.catch\(\(\) => \{\}\)/)
  assert.match(auth, /return startSession\(result\.user, user, memberships\)/)
  assert.match(login, /disabled=\{Boolean\(selectLoadingId\) \|\| !selectable\}/)
  assert.match(login, /Manager mobile access off/)
  assert.match(login, /Manager app not entitled/)
  assert.match(more, /availableMemberships/)
  assert.match(more, /Mobile access off/)
  assert.match(more, /Manager app not entitled/)
  assert.match(more, /switchMembership/)
  assert.match(managerApp, /<FeaturesProvider key=\{user\.lodge_id\}>/)
  assert.match(managerApp, /<InboxProvider key=\{user\.lodge_id\}>/)
  assert.match(managerApp, /<AuthenticatedShell[\s\S]{0,160}key=\{`\$\{user\.lodge_id\}/)
})

test('PWA shell adapts nav by server product_family', () => {
  assert.match(shell, /PRODUCT_FAMILY_IDS/)
  assert.match(shell, /getPwaShellConfig/)
  assert.match(shell, /to: '\/pos'/)
  assert.match(shell, /to: '\/inventory'/)
  assert.match(bottomNav, /getPwaNavItems/)
  assert.match(bottomNav, /user\?\.product_family/)
})

test('PWA route allowlist redirects incompatible direct URLs to the product home', () => {
  const app = fs.readFileSync(path.join(root, 'manager-pwa/src/App.jsx'), 'utf8')
  assert.match(shell, /const ACCOMMODATION_ONLY_ROUTES = new Set/)
  assert.match(shell, /'\/rooms'/)
  assert.match(shell, /'\/bookings'/)
  assert.match(shell, /const RESTAURANT_ONLY_ROUTES = new Set\(\['\/restaurant-owner', '\/restaurant\/service', '\/restaurant\/cash-close', '\/restaurant\/floor', '\/restaurant\/kitchen-workspace', '\/restaurant\/menu-production'\]\)/)
  assert.match(shell, /export function isPwaRouteAllowed/)
  assert.match(shell, /if \(ACCOMMODATION_ONLY_ROUTES\.has\(path\)\) return shell\.accommodationModules === true/)
  assert.match(shell, /if \(RESTAURANT_ONLY_ROUTES\.has\(path\)\) return shell\.restaurantModules === true/)
  assert.match(shell, /const HOTEL_ONLY_ROUTES = new Set\(\['\/hotel-dashboard', '\/folios', '\/checkin-workflow', '\/night-audit-enterprise', '\/hotel-revenue'\]\)/)
  assert.match(shell, /if \(HOTEL_ONLY_ROUTES\.has\(path\)\) return shell\.productFamily === PRODUCT_FAMILY_IDS\.HOTEL/)
  assert.match(app, /function ProductRouteGuard/)
  assert.match(app, /<ProductRouteGuard path="\/rooms" productFamily=\{user\?\.product_family\}/)
  assert.match(app, /<ProductRouteGuard path="\/restaurant-owner" productFamily=\{user\?\.product_family\}/)
  assert.match(app, /<ProductRouteGuard path="\/hotel-dashboard" productFamily=\{user\?\.product_family\}/)
  assert.match(app, /<ProductRouteGuard path="\/hotel-revenue" productFamily=\{user\?\.product_family\}/)
  assert.match(app, /<ProductRouteGuard path="\/supplies" productFamily=\{user\?\.product_family\}/)
})

test('Hotel has a native PWA front-desk page backed by live bookings and rooms reads', () => {
  assert.match(hotelFrontDesk, /listBookings\(user\.lodge_id, \{ forceFresh: true \}\)/)
  assert.match(hotelFrontDesk, /listRooms\(user\.lodge_id\)/)
  assert.match(hotelFrontDesk, /Today’s arrivals/)
  assert.match(hotelFrontDesk, /Today’s departures/)
  assert.match(hotelFrontDesk, /In-house guests/)
})

test('Hotel has a native read-only PWA folio workspace using authoritative RPC reads', () => {
  assert.match(api, /export async function listHotelFolios/)
  assert.match(api, /get_hotel_folios/)
  assert.match(api, /export async function getHotelFolioLines/)
  assert.match(api, /get_folio_line_items/)
  assert.match(hotelFolios, /listHotelFolios\(user\.lodge_id\)/)
  assert.match(hotelFolios, /getHotelFolioLines\(user\.lodge_id, folio\.id\)/)
  assert.match(hotelFolios, /Posting charges, payments, transfers, and settlements remains/)
})

test('Lodge property operations are native PWA pages backed by live operational contracts', () => {
  const app = fs.readFileSync(path.join(root, 'manager-pwa/src/App.jsx'), 'utf8')
  assert.match(propertyOperations, /calendar: \{ title: 'Planning'/)
  assert.match(propertyOperations, /roomgrid: \{ title: 'Room Board'/)
  assert.match(propertyOperations, /housekeeping: \{ title: 'Housekeeping'/)
  assert.match(propertyOperations, /maintenance: \{ title: 'Maintenance'/)
  assert.match(propertyOperations, /listBookings\(user\.lodge_id, \{ forceFresh: true \}\)/)
  assert.match(propertyOperations, /listRooms\(user\.lodge_id\)/)
  assert.match(propertyOperations, /listMaintenanceTickets\(user\.lodge_id, \{ forceFresh: true \}\)/)
  assert.match(propertyOperations, /createMaintenance\(user\.lodge_id/)
  assert.match(app, /<PropertyOperations mode="calendar"/)
  assert.match(app, /<PropertyOperations mode="maintenance"/)
})

test('Restaurant has native PWA service and cash-close manager workspaces using POS reporting RPCs', () => {
  const app = fs.readFileSync(path.join(root, 'manager-pwa/src/App.jsx'), 'utf8')
  assert.match(restaurantOperations, /service: \{ title: 'Service Watch'/)
  assert.match(restaurantOperations, /'cash-close': \{ title: 'Cash & Close'/)
  assert.match(restaurantOperations, /getManagerPosSnapshot\(user\.lodge_id/)
  assert.match(restaurantOperations, /getManagerPosTransactions\(user\.lodge_id/)
  assert.match(restaurantOperations, /Starting sales, voids, discounts, returns, and settlement stay/)
  assert.match(app, /<RestaurantOperations mode="service"/)
  assert.match(app, /<RestaurantOperations mode="cash-close"/)
})

test('Hotel has a server-authorized PWA check-in and check-out workflow', () => {
  assert.match(api, /export async function getHotelWorkflowChecklist/)
  assert.match(api, /get_checkin_checklist/)
  assert.match(api, /complete_hotel_checkin/)
  assert.match(api, /complete_hotel_checkout/)
  assert.match(hotelStayWorkflow, /completeHotelWorkflowStep\(user\.lodge_id, stepId, direction\)/)
  assert.match(hotelStayWorkflow, /completeHotelStayWorkflow\(user\.lodge_id, selected\.id, direction\)/)
})

test('Hotel night audit uses the authoritative live checks RPC without exposing close actions', () => {
  assert.match(api, /export async function getHotelNightAuditChecks/)
  assert.match(api, /run_night_audit_checks/)
  assert.match(hotelNightAudit, /getHotelNightAuditChecks\(user\.lodge_id\)/)
  assert.match(hotelNightAudit, /Closing, force-closing, reopening, and resolving audit exceptions remain/)
})

test('Restaurant floor and kitchen use lodge-scoped tables, tickets, and the server status RPC', () => {
  assert.match(api, /export async function listRestaurantTables/)
  assert.match(api, /pos_tables/)
  assert.match(api, /export async function listRestaurantPrepTickets/)
  assert.match(api, /pos_prep_tickets/)
  assert.match(api, /update_pos_prep_ticket_status/)
  assert.match(restaurantFloorKitchen, /updateRestaurantPrepTicket\(user\.lodge_id, ticket\.id, status\)/)
})

test('Restaurant menu is a product-scoped live PWA catalogue read', () => {
  assert.match(api, /export async function listRestaurantMenu/)
  assert.match(api, /from\('pos_menu_items'\)/)
  assert.match(restaurantMenu, /listRestaurantMenu\(user\.lodge_id\)/)
})

test('Accommodation Guest Deposits use the authoritative customer-credit summary and remain read-only', () => {
  assert.match(prepayments, /getCustomerCreditSummaryPwa\(user\.lodge_id/)
  assert.match(api, /getCustomerCreditSummaryPwa[\s\S]{0,220}assertCapability\('prepayments\.view',\s*\{\s*lodgeId\s*\}\)/)
  assert.match(api, /authoritative customer credit summary response was unavailable or malformed/)
  assert.match(pwaAccess, /productId:\s*user\?\.product_id/)
  assert.match(pwaAccess, /commercialPackageKey:\s*user\?\.commercial_package_key/)
  assert.match(shell, /ACCOMMODATION_ONLY_ROUTES[\s\S]{0,260}'\/prepayments'/)
  assert.doesNotMatch(shell, /LODGE_ONLY_ROUTES[^\n]*\/prepayments/)
  assert.match(shell, /PRODUCT_FAMILY_IDS\.HOTEL[\s\S]{0,1200}accommodationModules: true/)
  assert.match(shell, /PRODUCT_FAMILY_IDS\.HOSPITALITY_POS[\s\S]{0,1200}accommodationModules: false/)
  assert.match(managerApp, /<ProductRouteGuard path="\/prepayments" productFamily=\{user\?\.product_family\}/)
  assert.match(managerApp, /<Guard capability="prepayments\.view"><Prepayments \/><\/Guard>/)
  assert.match(more, /isAccommodation && can\('prepayments\.view'\)/)
  assert.match(prepayments, /Receiving, allocating, refunding, reversing, reconciling, exporting, matching, and configuring Guest Deposits remain/)
  assert.match(pwaAccess, /blockedOnMobile[\s\S]{0,900}'prepayments\.receive'/)
  assert.doesNotMatch(pwaAccess, /blockedOnMobile[\s\S]{0,900}'prepayments\.view'/)
  assert.doesNotMatch(api, /record_customer_credit|apply_customer_credit_to_booking|refund_customer_credit|reverse_customer_credit_entry/)
  assert.doesNotMatch(prepayments, /onSubmit|window\.api\.(?:customerCredit|prepayments)\.(?:record|apply|refund|reverse|export|setConfig)/i)
  for (const capability of ['receive', 'allocate', 'refund', 'reverse', 'reconcile', 'export', 'age', 'match', 'configure']) {
    assert.match(pwaAccess, new RegExp(`'prepayments\\.${capability}'`))
  }
})

test('Hotel rate plans and corporate accounts are live, capability-gated PWA reference workspaces', () => {
  assert.match(api, /export async function listHotelRatePlans/)
  assert.match(api, /assertCapability\('rate_plans\.view'\)/)
  assert.match(api, /export async function listCorporateAccountsPwa/)
  assert.match(api, /assertCapability\('corporate_accounts\.view'\)/)
  assert.match(hotelRevenue, /listHotelRatePlans\(user\.lodge_id\)/)
  assert.match(hotelRevenue, /listCorporateAccountsPwa\(user\.lodge_id\)/)
  assert.match(hotelRevenue, /Creating or changing rates, credit limits, corporate billing, and settlements remains/)
})

test('Accommodation room supplies are live and read-only on PWA', () => {
  assert.match(api, /export async function listRoomSuppliesPwa/)
  assert.match(api, /assertCapability\('supplies\.view'\)/)
  assert.match(api, /from\('supply_items'\)/)
  assert.match(api, /from\('room_supply_room_stock'\)/)
  assert.match(roomSupplies, /listRoomSuppliesPwa\(user\.lodge_id\)/)
  assert.match(roomSupplies, /Purchasing, adjusting, loading, using, returning, and stock-taking room supplies remain/)
})
