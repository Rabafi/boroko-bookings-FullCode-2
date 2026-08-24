import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'
import {
  COMMERCIAL_PRODUCT_IDS,
  getCommercialOffer
} from '../src/shared/commercialEntitlements.js'
import { getModuleByKey } from '../src/shared/moduleCatalog.js'
import { isProductRouteAllowed } from '../src/shared/productIdentity.js'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('Lodge Starter includes only the view-only basic report boundary', () => {
  const starter = getCommercialOffer(COMMERCIAL_PRODUCT_IDS.LODGE_CAMP, 'starter')
  assert.ok(starter.includedFeatures.includes('basic_reports'))
  assert.ok(!starter.includedFeatures.includes('reports'))

  const basicModule = getModuleByKey('basic_reports')
  const fullModule = getModuleByKey('reports')
  assert.equal(basicModule.requiredPlan, 'Starter')
  assert.deepEqual(basicModule.routes, ['/basic-reports'])
  assert.ok(!basicModule.allowedPropertyTypes.includes('restaurant'))
  assert.equal(fullModule.requiredPlan, 'Standard')

  const manager = buildCapabilitySnapshot({
    role: 'manager',
    features: {
      ...Object.fromEntries(starter.includedFeatures.map((feature) => [feature, true])),
      reports: false
    }
  })
  assert.equal(manager.capabilities['reports.basic_view'], true)
  assert.equal(manager.capabilities['reports.view'], false)
  assert.equal(manager.capabilities['reports.export'], false)
})

test('Starter basic report exposes a distinct read-only bridge and server range guard', () => {
  const preload = read('src/preload/index.js')
  const index = read('src/main/index.js')
  const domain = read('src/main/domains/restaurantAccountingV2.js')
  assert.match(preload, /basicSummary: \(rangeDays = 1\) => invoke\('reports:basicSummary', rangeDays\)/)
  assert.match(index, /ipcMain\.handle\('reports:basicSummary'/)
  assert.match(index, /requireCapability\('reports\.basic_view'\)/)
  assert.match(domain, /getStarterBasicReport/)
  assert.match(domain, /\[1, 7, 30\]\.includes\(days\)/)
  assert.match(domain, /result\.data\.schema_version !== 'starter-basic-report-v1'/)
})

test('Starter SQL is lodge-scoped, ledger-derived, timezone-aware, and fail-closed', () => {
  const sql = read('supabase/migrations/20260824050000_starter_basic_report.sql')
  assert.match(sql, /get_starter_basic_report\(\s*p_lodge_id uuid,\s*p_range_days integer/)
  assert.match(sql, /reports\.basic_view/)
  assert.match(sql, /get_lodge_entitlement\(p_lodge_id\)/)
  assert.match(sql, /product_id[\s\S]*not in \('', 'lodge-camp', 'hotel'\)/)
  assert.match(sql, /effective_features'->>'basic_reports'/)
  assert.match(sql, /p_range_days not in \(1, 7, 30\)/)
  assert.match(sql, /commercial_package_prices[\s\S]*\["basic_reports"\]/)
  assert.match(sql, /commercial_package_entitlements/)
  assert.match(sql, /on conflict \(lodge_id, feature_name\) do nothing/)
  assert.match(sql, /commercial_entitlement_backfill/)
  assert.match(sql, /s\.timezone/)
  assert.match(sql, /sum\(p\.amount\)/i)
  assert.match(sql, /left join public\.payments p[\s\S]*p\.booking_id = b\.id/)
  assert.match(sql, /b\.created_at at time zone v_timezone/)
  assert.match(sql, /b\.check_out between v_start and v_end/)
  assert.match(sql, /'certified', true/)
  assert.match(sql, /'gross_collections', null/)
  assert.match(sql, /grant execute on function public\.get_starter_basic_report\(uuid, integer\)[\s\S]*to anon, authenticated, service_role/)
  assert.doesNotMatch(sql, /amount_paid/i)
  assert.doesNotMatch(sql, /insert into public\.(payments|bookings)/i)
})

test('Renderer unwrap contract withholds missing money instead of coercing NULL to zero', () => {
  const ui = read('src/renderer/src/components/BasicReports.jsx')
  const app = read('src/renderer/src/App.jsx')
  const nav = read('src/renderer/src/navigation/desktopNav.js')
  assert.match(ui, /value === null \|\| value === undefined \|\| value === ''/)
  assert.match(ui, /report\?\.dataset_status === 'certified'/)
  assert.match(ui, /financial\?\.certified === true/)
  assert.match(ui, /financial\.by_payment_method/)
  assert.match(ui, /exports are not available in Starter/)
  assert.match(app, /path="basic-reports"[\s\S]*capability="reports\.basic_view"[\s\S]*feature="basic_reports"/)
  assert.match(nav, /to: '\/basic-reports'[\s\S]*capability: 'reports\.basic_view'/)
  assert.equal(isProductRouteAllowed('/basic-reports', 'lodge-camp'), true)
  assert.equal(isProductRouteAllowed('/basic-reports', 'hotel'), true)
  assert.equal(isProductRouteAllowed('/basic-reports', 'hospitality-pos'), false)
})
