import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appJsx = readFileSync(resolve(__dirname, '../src/renderer/src/App.jsx'), 'utf8')
const settingsJsx = readFileSync(resolve(__dirname, '../src/renderer/src/components/Settings.jsx'), 'utf8')
const housekeepingJsx = readFileSync(resolve(__dirname, '../src/renderer/src/components/Housekeeping.jsx'), 'utf8')
const maintenanceJsx = readFileSync(resolve(__dirname, '../src/renderer/src/components/Maintenance.jsx'), 'utf8')
const dashboardJsx = readFileSync(resolve(__dirname, '../src/renderer/src/components/Dashboard.jsx'), 'utf8')

// Routes that have been consolidated into parent pages and are now redirects
const REDIRECT_ROUTES = [
  { route: 'room-attributes', target: '/rooms?tab=attributes' },
  { route: 'corporate-billing', target: '/corporate?tab=billing' },
  { route: 'documents', target: '/settings?tab=document-templates' },
  { route: 'hotel-roles', target: '/staff?tab=hotel-roles' },
  { route: 'night-audit-enterprise', target: '/audit' },
  { route: 'checkin-workflow', target: '/bookings?tab=checkin' },
  { route: 'early-late-checkout', target: '/bookings?tab=early-late' },
  { route: 'cancellation-policies', target: '/bookings?tab=cancellations' },
  { route: 'booking-engine', target: '/rate-plans?tab=booking-engine' },
  { route: 'rate-calendar', target: '/rate-plans?tab=calendar' },
  { route: 'housekeeping-command-center', target: '/housekeeping?tab=assignments' },
  { route: 'maintenance-enterprise', target: '/maintenance?tab=preventive' },
  { route: 'payment-gateway-config', target: '/' },
  { route: 'promo-codes', target: '/rate-plans?tab=promo-codes' },
  { route: 'hotel-dashboard', target: '/' },
  { route: 'hotel-reports', target: '/reports?tab=hotel-kpis' },
  { route: 'enterprise-reports', target: '/reports?tab=enterprise' },
  { route: 'advanced-housekeeping', target: '/housekeeping?tab=turnover' },
  { route: 'revenue-manager', target: '/rate-plans?tab=revenue' },
  { route: 'payment-links', target: '/folios' },
  { route: 'custom-website', target: '/' },
  { route: 'room-types', target: '/rooms?tab=room-types' },
  { route: 'floors', target: '/rooms?tab=floors-sections' }
]

for (const { route, target } of REDIRECT_ROUTES) {
  test(`route /${route} exists in App.jsx`, () => {
    assert.ok(appJsx.includes(`path="${route}"`), `Route /${route} should exist in App.jsx`)
  })

  test(`route /${route} redirects to ${target}`, () => {
    assert.ok(
      appJsx.includes(`Navigate to="${target}"`) || appJsx.includes(`Navigate to={'${target}'}`),
      `Route /${route} should redirect to ${target}`
    )
  })
}

// Routes that remain as distinct modules with UpgradeWall
const DISTINCT_ROUTES = [
  { route: 'group-operations', feature: 'group_operations' }
]

for (const { route, feature } of DISTINCT_ROUTES) {
  test(`route /${route} uses <UpgradeWall> wrapper`, () => {
    const marker = `path="${route}" element={<UpgradeWall `
    assert.ok(appJsx.includes(marker), `Route /${route} should use UpgradeWall wrapper`)
  })

  test(`route /${route} uses correct feature gate "${feature}"`, () => {
    const pattern = `path="${route}" element={<UpgradeWall feature="${feature}"`
    assert.ok(appJsx.includes(pattern), `Route /${route} should gate on feature="${feature}"`)
  })
}

// Distinct hotel modules that remain as sidebar items
const HOTEL_MODULES = [
  { route: 'folios', feature: 'folios' },
  { route: 'corporate', feature: 'corporate_accounts' },
  { route: 'rate-plans', feature: 'rate_plans' },
  { route: 'room-moves', feature: 'room_moves' },
  { route: 'channel-manager', feature: 'channel_manager' },
  { route: 'guest-messaging', feature: 'guest_messaging' },
  { route: 'guest-portal', feature: 'guest_portal' },
  { route: 'multi-property', feature: 'multi_property' },
  { route: 'guest-crm', feature: 'guest_crm' },
  { route: 'operations-compliance', feature: 'operations_compliance' },
  { route: 'multi-outlet-pos', feature: 'multi_outlet_pos' }
]

for (const { route, feature } of HOTEL_MODULES) {
  test(`distinct hotel route /${route} uses <UpgradeWall> with "${feature}"`, () => {
    const pattern = `path="${route}" element={<UpgradeWall feature="${feature}"`
    assert.ok(appJsx.includes(pattern), `Route /${route} should gate on feature="${feature}"`)
  })
}

// All redirect target features should be present in entitlement map
const ALL_REDIRECT_FEATURES = [
  'room_attributes', 'corporate_accounts', 'documents', 'hotel_roles',
  'night_audit_enterprise', 'checkin_workflow', 'early_late_checkout',
  'cancellation_policies', 'advanced_booking_engine', 'advanced_rates',
  'advanced_housekeeping', 'maintenance_enterprise', 'payment_gateway',
  'front_desk_dashboard', 'hotel_kpis', 'advanced_reports'
]

test('All redirect target features are present in entitlement feature map', () => {
  const enterpriseFeatures = getPlanFeatureMap('Enterprise')
  for (const feature of ALL_REDIRECT_FEATURES) {
    assert.ok(Object.prototype.hasOwnProperty.call(enterpriseFeatures, feature),
      `Feature "${feature}" should be in subscriptionState`)
  }
})

// ── Real destination tests: parent pages define the redirected tab IDs ──────

test('/documents redirects to Settings with document-templates tab', () => {
  assert.ok(settingsJsx.includes("id: 'document-templates'") || settingsJsx.includes("id:'document-templates'") || settingsJsx.includes("'document-templates'"),
    'Settings.jsx should define a document-templates tab')
})

test('/advanced-housekeeping redirects to Housekeeping with turnover tab', () => {
  assert.ok(housekeepingJsx.includes("'turnover'") || housekeepingJsx.includes('"turnover"'),
    'Housekeeping.jsx should support turnover tab')
})

test('/maintenance-enterprise redirects to Maintenance with preventive tab', () => {
  assert.ok(maintenanceJsx.includes("'preventive'") || maintenanceJsx.includes('"preventive"'),
    'Maintenance.jsx should support preventive tab')
})

test('/hotel-dashboard redirects to Dashboard which embeds hotel dashboard', () => {
  assert.ok(dashboardJsx.includes('HotelDashboard') || dashboardJsx.includes('hotel-dashboard'),
    'Dashboard.jsx should import or reference HotelDashboard')
})
