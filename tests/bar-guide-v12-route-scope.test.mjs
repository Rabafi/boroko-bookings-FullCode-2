import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertBarRouteScopeRecheck, collectBarRouteScopeRecheck } from './helpers/bar-route-scope-recheck.mjs'

test('Bar route scope rejects the old false-open paths and preserves a real add-on exception', () => {
  const evidence = collectBarRouteScopeRecheck()
  assert.equal(assertBarRouteScopeRecheck(evidence), true)
  for (const [route, matrix] of Object.entries(evidence.package.blockedRouteMatrix)) {
    assert.deepEqual(matrix, { noAddon: true, allDeclaredBarAddons: true }, `${route} is blocked by the actual Bar path predicate`)
  }
  assert.deepEqual(evidence.package.allowedActualAddonException, {
    path: '/restaurant/inventory',
    addonKey: 'bar_stock_purchasing_pro',
    feature: 'inventory_advanced',
    blockedWithoutAddon: true,
    blockedWithMatchingAddon: false,
  })
})

test('Bar direct-link reservations and stations remain classified as app gate mismatches, not supported workflows', () => {
  const evidence = collectBarRouteScopeRecheck()
  const reservation = evidence.routeFacts.reservationDeepLink
  assert.equal(reservation.pathPredicateBlocked, false, 'the path predicate does not hide the direct floor workspace')
  assert.equal(reservation.routeLeafFeaturePosIncluded, true)
  assert.equal(reservation.nestedTab.feature, 'pos')
  assert.equal(reservation.nestedTab.capability, 'pos.service')
  assert.ok(reservation.managerVisibleFloorTabs.includes('reservations'), 'the actual workspace tab helper allows a manager to render it')
  assert.equal(reservation.ipcHandlerCount, 12)
  assert.equal(reservation.ipcAllRequireTables, true, 'every reservation and waitlist IPC is separately Tables-gated')
  assert.equal(reservation.preloadMethodCount, 12)
  assert.equal(reservation.preloadExposesAllMethods, true, 'each gated reservation and waitlist IPC is also exposed through preload')
  assert.equal(reservation.disposition, 'INTERNAL_ROUTE_UI_AND_BACKEND_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW')

  const stations = evidence.routeFacts.stations
  assert.equal(stations.pathPredicateBlocked, false)
  assert.equal(stations.routeLeafFeaturePosIncluded, true)
  assert.equal(stations.nestedTab.feature, 'pos')
  assert.equal(stations.nestedTab.capability, 'pos.menu_manage')
  assert.equal(stations.kitchenTicketsInAnyBarPackage, false)
  assert.equal(stations.allStationIpcHandlersRequireKitchenTickets, true)
  assert.equal(stations.emptyReadIsPresentedAsNoStationsConfigured, true)
  assert.equal(stations.disposition, 'APP_ROUTE_UI_AND_KITCHEN_TICKETS_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW')
  assert.equal(stations.navSearchMarksRestaurantOnlyWithoutBarFeature, true, 'the search action is marked restaurant-only and has no Bar add-on exception')
  assert.equal(stations.navSearchTargetIsKitchenWorkspace, true)
  assert.equal(stations.kitchenWorkspaceRouteRequiresKitchenTickets, true, 'the search route itself is blocked by the absent kitchen-tickets feature')

  const service = evidence.routeFacts.service
  assert.equal(service.pathPredicateBlocked, false, 'the route path predicate alone does not decide service feature access')
  assert.equal(service.tablesInAnyBarPackage, false)
  assert.equal(service.upgradeWallRequiresTables, true)
  assert.equal(service.disposition, 'ROUTE_ADMITTED_BY_PATH_PREDICATE_BUT_BLOCKED_BY_TABLES_PACKAGE_GATE')
})

test('Growth add-on reservation policy action is documented as unsupported but still surfaced by the current app', () => {
  const evidence = collectBarRouteScopeRecheck()
  const policy = evidence.routeFacts.growthReservationPolicy
  assert.equal(policy.addonFeatureFromActualPathMap, 'vouchers')
  assert.equal(policy.pathBlockedWithoutFeature, true)
  assert.equal(policy.pathAllowedWithGrowthAddon, true)
  assert.equal(policy.growthAddonIncludesVouchers, true)
  assert.equal(policy.growthAddonIncludesTables, false)
  assert.equal(policy.growthAddonIncludesKitchenTickets, false)
  assert.equal(policy.policyVisibleInGrowthTab, true)
  assert.equal(policy.saveButtonPresent, true)
  assert.equal(policy.ipcRequiresPosManage, true)
  assert.equal(policy.ipcRequiresCommercialFeature, false)
  assert.equal(policy.domainCallsOnlineRpc, true)
  assert.equal(policy.localSqlLimitsRoles, true)
  assert.equal(policy.productCopyClaimsReservationSupport, false)
  assert.equal(policy.currentAcceptanceMatrixExcludesReservations, true)
  assert.equal(policy.disposition, 'VISIBLE_CONTROL_CONFLICTS_WITH_BAR_ACCEPTANCE; NOT A SUPPORTED BAR WORKFLOW')
})
