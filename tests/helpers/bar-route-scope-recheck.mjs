import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parse } from '@babel/parser'
import { BAR_POS_ADDON_CATALOG, COMMERCIAL_PRODUCT_IDS } from '../../src/shared/commercialEntitlements.js'
import { getCommercialFeatureSet } from '../../src/shared/commercialAccess.js'
import { getRoleCapabilities } from '../../src/shared/accessControl.js'
import { getBarAddonFeatureForPath, isBarOnlyBlockedPath } from '../../src/shared/barModeProfile.js'
import { getVisibleWorkspaceTabs } from '../../src/shared/workspaceTabAccess.js'

const files = {
  app: 'src/renderer/src/App.jsx',
  layout: 'src/renderer/src/components/hospitality-pos/HposLayout.jsx',
  manage: 'src/renderer/src/components/hospitality-pos/HposManageHub.jsx',
  workspace: 'src/renderer/src/components/restaurant/RestaurantWorkspace.jsx',
  stations: 'src/renderer/src/components/restaurant/RestaurantStations.jsx',
  preload: 'src/preload/index.js',
  service: 'src/renderer/src/components/hospitality-pos/HposServiceReservations.jsx',
  growth: 'src/renderer/src/components/restaurant/RestaurantGrowthControls.jsx',
  ipc: 'src/main/index.js',
  domain: 'src/main/domains/pos.js',
  policySql: 'supabase/migrations/20260710190000_restaurant_growth_controls.sql',
  profile: 'src/shared/barModeProfile.js',
  entitlements: 'src/shared/commercialEntitlements.js',
  access: 'src/shared/commercialAccess.js',
  tabAccess: 'src/shared/workspaceTabAccess.js',
  acceptance: 'docs/BAR_CAPABILITY_ACCEPTANCE_MATRIX.md',
}

function source(root, key) {
  return fs.readFileSync(path.join(root, files[key]), 'utf8')
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase()
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node.type === 'string') visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key) && value && typeof value === 'object') walk(value, visit)
  }
}

function property(object, name) {
  return object?.properties?.find((item) => item.type === 'ObjectProperty'
    && ((item.key.type === 'Identifier' && item.key.name === name)
      || (item.key.type === 'StringLiteral' && item.key.value === name)))?.value
}

function stringValue(node) {
  return node?.type === 'StringLiteral' ? node.value : null
}

function extractWorkspaceTabs(text, workspaceName) {
  const ast = parse(text, { sourceType: 'module', plugins: ['jsx'] })
  let definition = null
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.name === 'WORKSPACES') definition = node.init
  })
  const workspace = property(definition, workspaceName)
  const tabs = property(workspace, 'tabs')
  if (tabs?.type !== 'ArrayExpression') throw new Error(`Could not extract WORKSPACES.${workspaceName}.tabs from current source`)
  return tabs.elements.map((entry) => ({
    key: stringValue(property(entry, 'key')),
    label: stringValue(property(entry, 'label')),
    feature: stringValue(property(entry, 'feature')),
    capability: stringValue(property(entry, 'capability')),
  }))
}

function routeMarkup(app, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = app.match(new RegExp(`<Route\\s+path="${escaped}"[^>]*element=\\{(.+?)\\}\\s*/>`, 's'))
  if (!match) throw new Error(`Current App.jsx route not found: ${routePath}`)
  return match[1]
}

function requireIncludes(text, fragment, description) {
  if (!text.includes(fragment)) throw new Error(`Current source contract missing: ${description}`)
}

function sourceLine(text, fragment) {
  return text.split(/\r?\n/).find((line) => line.includes(fragment)) || ''
}

function ipcHandler(text, channel) {
  const start = text.indexOf(`ipcMain.handle('pos:${channel}'`)
  if (start < 0) return ''
  const next = text.indexOf('\n  ipcMain.handle(', start + 1)
  return text.slice(start, next < 0 ? undefined : next)
}

export function collectBarRouteScopeRecheck(root = process.cwd()) {
  const content = Object.fromEntries(Object.keys(files).map((key) => [key, source(root, key)]))
  const addonKeys = BAR_POS_ADDON_CATALOG.map((addon) => addon.addonKey)
  const baseFeatures = getCommercialFeatureSet(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos', [])
  const allAddonFeatures = getCommercialFeatureSet(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos', addonKeys)
  const routePredicate = (route, featureSet) => isBarOnlyBlockedPath(route, [...featureSet])
  const blockedHistoricalRoutes = [
    '/restaurant/floor', '/restaurant/tables', '/restaurant/kitchen',
    '/restaurant/reservations', '/restaurant/combos', '/restaurant/kitchen-analytics',
  ]
  const blockedRouteMatrix = Object.fromEntries(blockedHistoricalRoutes.map((route) => [route, {
    noAddon: routePredicate(route, baseFeatures),
    allDeclaredBarAddons: routePredicate(route, allAddonFeatures),
  }]))
  const floorTabs = extractWorkspaceTabs(content.workspace, 'floor')
  const kitchenTabs = extractWorkspaceTabs(content.workspace, 'kitchen')
  const manager = { role: 'manager', capabilities: getRoleCapabilities('manager') }
  const visibleFloorTabs = getVisibleWorkspaceTabs('floor', floorTabs, {
    access: manager,
    features: Object.fromEntries([...baseFeatures].map((feature) => [feature, true])),
  }).map((tab) => tab.key)

  const floorRoute = routeMarkup(content.app, 'restaurant/floor-workspace')
  const kitchenWorkspaceRoute = routeMarkup(content.app, 'restaurant/kitchen-workspace')
  const stationsRoute = routeMarkup(content.app, 'restaurant/stations')
  const serviceRoute = routeMarkup(content.app, 'hpos/service')
  const growthRoute = routeMarkup(content.app, 'hpos/growth-tools')
  const floorReservationsTab = floorTabs.find((tab) => tab.key === 'reservations')
  const stationTab = kitchenTabs.find((tab) => tab.key === 'stations')
  const barGrowthAddon = BAR_POS_ADDON_CATALOG.find((addon) => addon.addonKey === 'bar_growth_multi_outlet')
  const stockAddon = BAR_POS_ADDON_CATALOG.find((addon) => addon.addonKey === 'bar_stock_purchasing_pro')
  const stockAddonFeatures = getCommercialFeatureSet(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos', [stockAddon.addonKey])

  requireIncludes(content.app, 'isBarOnlyBlockedPath(appPath, enabledFeatures)', 'Bar-only path redirect uses the shared path predicate')
  requireIncludes(content.app, '<Navigate to={redirectTo} replace />', 'Bar-only guard redirects blocked paths')
  requireIncludes(content.app, '<BarOnlyBlockedRedirect>{children}</BarOnlyBlockedRedirect>', 'RestaurantGuard delegates children to the Bar-only path guard')
  requireIncludes(floorRoute, '<UpgradeWall feature="pos">', 'floor workspace is mounted by the admitted pos route')
  requireIncludes(floorRoute, '<RestaurantWorkspace workspace="floor" defaultTab="tables" />', 'floor route chooses the floor workspace')
  requireIncludes(stationsRoute, '<UpgradeWall feature="pos">', 'station workspace route uses the broad pos gate')
  requireIncludes(stationsRoute, '<RestaurantWorkspace workspace="kitchen" defaultTab="stations" />', 'station route selects the stations tab')
  requireIncludes(serviceRoute, '<UpgradeWall feature="tables">', 'service route uses the Tables UpgradeWall')
  requireIncludes(serviceRoute, '<HposServiceReservations />', 'service route selects the reservations/waitlist screen')
  requireIncludes(growthRoute, '<BarAddonFeatureRoute feature="vouchers">', 'growth controls are routed through the vouchers add-on')
  requireIncludes(growthRoute, '<RestaurantGrowthControls tabKey="growth" />', 'growth controls select the growth panel')

  const reservationIpcNames = [
    'getRestaurantReservations', 'createRestaurantReservation', 'updateRestaurantReservation',
    'cancelRestaurantReservation', 'seatRestaurantReservation', 'markRestaurantReservationNoShow',
    'getRestaurantWaitlist', 'createRestaurantWaitlistEntry', 'updateRestaurantWaitlistEntry',
    'removeRestaurantWaitlistEntry', 'seatRestaurantWaitlistEntry', 'serviceRestaurantReservationAction',
  ]
  const reservationIpcGates = Object.fromEntries(reservationIpcNames.map((name) => {
    return [name, /requireCommercialFeature\('tables'\)/.test(ipcHandler(content.ipc, name))]
  }))
  const reservationPreloadExposures = Object.fromEntries(reservationIpcNames.map((name) => [
    name,
    new RegExp(`\\b${name}\\s*:`).test(content.preload) && content.preload.includes(`invoke('pos:${name}'`),
  ]))
  const stationIpcGates = Object.fromEntries(['getStations', 'saveStation', 'deleteStation'].map((name) => {
    const start = content.ipc.indexOf(`'pos:${name}'`)
    const segment = start < 0 ? '' : content.ipc.slice(start, content.ipc.indexOf('\n  ipcMain.handle(', start + 1) < 0 ? undefined : content.ipc.indexOf('\n  ipcMain.handle(', start + 1))
    return [name, /requireCommercialFeature\('kitchen_tickets'\)/.test(segment)]
  }))
  const policyHandlerStart = content.ipc.indexOf("'pos:saveReservationPolicy'")
  const policyHandler = policyHandlerStart < 0 ? '' : content.ipc.slice(policyHandlerStart, content.ipc.indexOf('\n  ipcMain.handle(', policyHandlerStart + 1) < 0 ? undefined : content.ipc.indexOf('\n  ipcMain.handle(', policyHandlerStart + 1))
  const hposSearch = content.layout
  const policySql = content.policySql
  const acceptance = content.acceptance
  const policySave = content.domain.match(/export async function saveRestaurantReservationPolicy[^\n]*/)?.[0] || ''

  const addonGate = getBarAddonFeatureForPath('/hpos/growth-tools')
  const routeFacts = {
    reservationDeepLink: {
      path: '/restaurant/floor-workspace?tab=reservations',
      pathPredicateBlocked: routePredicate('/restaurant/floor-workspace?tab=reservations', allAddonFeatures),
      routeLeafFeaturePosIncluded: allAddonFeatures.has('pos'),
      nestedTab: floorReservationsTab,
      managerVisibleFloorTabs: visibleFloorTabs,
      navSearchHasRestaurantOnlyActionWithoutBarFeature: (() => { const line = sourceLine(hposSearch, "route: '/restaurant/floor-workspace?tab=reservations'"); return line.includes('restaurantOnly: true') && !line.includes('barFeature:') })(),
      ipcAllRequireTables: Object.values(reservationIpcGates).every(Boolean),
      ipcHandlerCount: Object.keys(reservationIpcGates).length,
      preloadExposesAllMethods: Object.values(reservationPreloadExposures).every(Boolean),
      preloadMethodCount: Object.keys(reservationPreloadExposures).length,
      disposition: 'INTERNAL_ROUTE_UI_AND_BACKEND_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW',
    },
    stations: {
      path: '/restaurant/stations',
      pathPredicateBlocked: routePredicate('/restaurant/stations', allAddonFeatures),
      routeLeafFeaturePosIncluded: allAddonFeatures.has('pos'),
      nestedTab: stationTab,
      kitchenTicketsInAnyBarPackage: allAddonFeatures.has('kitchen_tickets'),
      allStationIpcHandlersRequireKitchenTickets: Object.values(stationIpcGates).every(Boolean),
      emptyReadIsPresentedAsNoStationsConfigured: content.stations.includes('catch { setStations([]) }') && content.stations.includes('No stations configured. Kitchen and bar are used by default.'),
      navSearchMarksRestaurantOnlyWithoutBarFeature: (() => { const line = sourceLine(hposSearch, "route: '/restaurant/kitchen-workspace?tab=stations'"); return line.includes('restaurantOnly: true') && !line.includes('barFeature:') })(),
      navSearchTargetIsKitchenWorkspace: sourceLine(hposSearch, "route: '/restaurant/kitchen-workspace?tab=stations'").includes('/restaurant/kitchen-workspace?tab=stations'),
      kitchenWorkspaceRouteRequiresKitchenTickets: kitchenWorkspaceRoute.includes('<UpgradeWall feature="kitchen_tickets">'),
      disposition: 'APP_ROUTE_UI_AND_KITCHEN_TICKETS_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW',
    },
    service: {
      path: '/hpos/service',
      pathPredicateBlocked: routePredicate('/hpos/service', allAddonFeatures),
      tablesInAnyBarPackage: allAddonFeatures.has('tables'),
      upgradeWallRequiresTables: serviceRoute.includes('<UpgradeWall feature="tables">'),
      navSearchMarksRestaurantOnlyWithoutBarFeature: (() => { const line = sourceLine(hposSearch, "route: '/hpos/service'"); return line.includes('restaurantOnly: true') && !line.includes('barFeature:') })(),
      disposition: 'ROUTE_ADMITTED_BY_PATH_PREDICATE_BUT_BLOCKED_BY_TABLES_PACKAGE_GATE',
    },
    growthReservationPolicy: {
      path: '/hpos/growth-tools',
      addonFeatureFromActualPathMap: addonGate,
      pathBlockedWithoutFeature: isBarOnlyBlockedPath('/hpos/growth-tools', []),
      pathAllowedWithGrowthAddon: !routePredicate('/hpos/growth-tools', getCommercialFeatureSet(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos', [barGrowthAddon.addonKey])),
      growthAddonIncludesVouchers: barGrowthAddon.includedFeatures.includes('vouchers'),
      growthAddonIncludesTables: barGrowthAddon.includedFeatures.includes('tables'),
      growthAddonIncludesKitchenTickets: barGrowthAddon.includedFeatures.includes('kitchen_tickets'),
      policyVisibleInGrowthTab: content.growth.includes("showPolicy = tabKey === 'growth'"),
      saveButtonPresent: /Save reservation policy/.test(content.growth),
      ipcRequiresPosManage: /requireCapability\('pos.manage'\)/.test(policyHandler),
      ipcRequiresCommercialFeature: /requireCommercialFeature/.test(policyHandler),
      domainCallsOnlineRpc: policySave.includes('state.isOnline') && policySave.includes('upsert_restaurant_reservation_policy'),
      localSqlLimitsRoles: policySql.includes("app_require_restaurant_lodge(v_lodge,array['admin','manager'])"),
      productCopyClaimsReservationSupport: /reservat/i.test(barGrowthAddon.description) || /reservation/i.test(barGrowthAddon.salesCopy || ''),
      currentAcceptanceMatrixExcludesReservations: acceptance.includes('Floor/kitchen/tables/reservations/production') && acceptance.includes('stay blocked in Bar mode with every add-on'),
      navMoreItemUsesVouchersFeature: content.profile.includes("route: '/hpos/growth-tools', label: 'Vouchers', capability: 'pos.manage', feature: 'vouchers'"),
      disposition: 'VISIBLE_CONTROL_CONFLICTS_WITH_BAR_ACCEPTANCE; NOT A SUPPORTED BAR WORKFLOW',
    },
  }

  const rootRoute = routeMarkup(content.app, '/')
  const result = {
    generatedAt: new Date().toISOString(),
    scope: 'Source-derived Bar route admission, workspace tab, navigation, commercial package, capability, preload exposure, IPC/domain and local-SQL trace. This is local source evidence only; it does not prove released binary, live entitlement, deployed SQL or live authorization.',
    candidate: {
      manualSha256: '21102463AA7ECC75143D47033E58341F99F0BA7F84431E4C63B0CDFDD0064795',
      quickStartSha256: 'DD07F37F6C9D74C62F2C091C107E84544804F9542D0D6900B69B547FBAD20CDB',
      pdfsModified: false,
    },
    parentGuard: {
      rootRouteFound: Boolean(rootRoute),
      protectedChainInSource: (() => { const order = ['ProtectedRoute', 'ProductShellGuard', 'RestaurantGuard', 'HposAwareLayout'].map((name) => rootRoute.indexOf(name)); return order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])) })(),
      pathRedirectUsesActualPredicate: content.app.includes('isBarOnlyBlockedPath(appPath, enabledFeatures)'),
    },
    package: {
      packageKey: 'bar_pos',
      baseFeatures: [...baseFeatures].sort(),
      declaredAddonKeys: addonKeys,
      allDeclaredBarFeatures: [...allAddonFeatures].sort(),
      tablesBase: baseFeatures.has('tables'),
      tablesAllAddons: allAddonFeatures.has('tables'),
      kitchenTicketsBase: baseFeatures.has('kitchen_tickets'),
      kitchenTicketsAllAddons: allAddonFeatures.has('kitchen_tickets'),
      blockedHistoricalRoutes,
      blockedRouteMatrix,
      allowedActualAddonException: {
        path: '/restaurant/inventory',
        addonKey: stockAddon.addonKey,
        feature: 'inventory_advanced',
        blockedWithoutAddon: isBarOnlyBlockedPath('/restaurant/inventory', []),
        blockedWithMatchingAddon: isBarOnlyBlockedPath('/restaurant/inventory', [...stockAddonFeatures]),
      },
    },
    routeFacts,
    sourceHashes: Object.fromEntries(Object.entries(content).map(([key, text]) => [files[key], hash(text)])),
  }

  return result
}

export function assertBarRouteScopeRecheck(result) {
  if (!result.parentGuard.rootRouteFound || !result.parentGuard.protectedChainInSource || !result.parentGuard.pathRedirectUsesActualPredicate) {
    throw new Error('Current App.jsx no longer proves the complete parent Bar route guard')
  }
  if (Object.values(result.package.blockedRouteMatrix).some((row) => !row.noAddon || !row.allDeclaredBarAddons)) {
    throw new Error('A historically misclassified route is not blocked by the current shared Bar path predicate')
  }
  const positive = result.package.allowedActualAddonException
  if (!positive.blockedWithoutAddon || positive.blockedWithMatchingAddon) throw new Error('The route verifier failed to preserve a real add-on exception')
  if (result.package.tablesAllAddons || result.package.kitchenTicketsAllAddons) throw new Error('Declared Bar packages now include Tables/Kitchen Tickets; re-evaluate scope')
  if (result.routeFacts.reservationDeepLink.disposition !== 'INTERNAL_ROUTE_UI_AND_BACKEND_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW'
    || result.routeFacts.reservationDeepLink.pathPredicateBlocked
    || result.routeFacts.reservationDeepLink.ipcAllRequireTables !== true
    || result.routeFacts.reservationDeepLink.preloadExposesAllMethods !== true
    || !result.routeFacts.reservationDeepLink.managerVisibleFloorTabs.includes('reservations')) {
    throw new Error('The reservation deep-link/UI/backend mismatch is no longer accurately classified')
  }
  if (result.routeFacts.stations.disposition !== 'APP_ROUTE_UI_AND_KITCHEN_TICKETS_FEATURE_MISMATCH; NOT A BAR CUSTOMER WORKFLOW') {
    // Exact current expected result is checked below; this branch intentionally
    // gives a clear failure if the report schema is changed without review.
    throw new Error('Station route finding schema changed; review the scope decision again')
  }
  if (result.routeFacts.stations.pathPredicateBlocked || result.routeFacts.stations.kitchenTicketsInAnyBarPackage
    || !result.routeFacts.stations.allStationIpcHandlersRequireKitchenTickets
    || !result.routeFacts.stations.navSearchMarksRestaurantOnlyWithoutBarFeature
    || !result.routeFacts.stations.kitchenWorkspaceRouteRequiresKitchenTickets
    || !result.routeFacts.stations.emptyReadIsPresentedAsNoStationsConfigured) {
    throw new Error('The station route/feature mismatch is no longer accurately classified')
  }
  if (result.routeFacts.service.tablesInAnyBarPackage || !result.routeFacts.service.upgradeWallRequiresTables) {
    throw new Error('The service route package gate is no longer accurately classified')
  }
  const policy = result.routeFacts.growthReservationPolicy
  if (!policy.policyVisibleInGrowthTab || !policy.saveButtonPresent || !policy.domainCallsOnlineRpc || policy.ipcRequiresCommercialFeature
    || !policy.currentAcceptanceMatrixExcludesReservations
    || policy.disposition !== 'VISIBLE_CONTROL_CONFLICTS_WITH_BAR_ACCEPTANCE; NOT A SUPPORTED BAR WORKFLOW') {
    throw new Error('Reservation-policy action scope changed; refresh the manual scope and application mismatch review')
  }
  return true
}
