import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const boundary = source('manager-pwa/src/components/BarLocalProjectionBoundary.jsx')
const app = source('manager-pwa/src/App.jsx')
const owner = source('manager-pwa/src/pages/RestaurantOwner.jsx')
const dashboard = source('manager-pwa/src/pages/Dashboard.jsx')
const freshness = source('manager-pwa/src/components/DataFreshness.jsx')
const shell = source('manager-pwa/src/lib/productShell.js')
const css = source('manager-pwa/src/index.css')
const control = source('manager-pwa/src/pages/Control.jsx')
const more = source('manager-pwa/src/pages/More.jsx')

test('Bar owner analytics routes stop before legacy cloud POS and stock pages mount', () => {
  assert.match(boundary, /user\?\.product_family === 'hospitality_pos'/)
  assert.match(boundary, /user\?\.hospitality_mode.*bar_only/)
  assert.match(boundary, /if \(!isLocalBar\) return children/)
  for (const path of ['/alerts', '/reports', '/performance', '/money', '/expenses', '/staff', '/inventory', '/pos']) {
    assert.match(app, new RegExp(`<Route path="${path}" element=\\{<BarLocalProjectionBoundary>`), `${path} must be gated before its cloud-backed reader mounts`)
  }
  assert.match(boundary, /no older cloud POS or stock records are shown/i)
  assert.match(boundary, /Bar sales, stock and financial changes remain on the local Bar computer/)
  const syncBanner = app.slice(app.indexOf('function SyncBanner()'), app.indexOf('/** @param {{side?: string'))
  assert.match(syncBanner, /if \(!user\?\.lodge_id \|\| barOnly\) return undefined/)
  assert.match(syncBanner, /Bar sync is not connected/)
  assert.match(control, /if \(barOnly\) \{\s*showToast\(\{ title: 'Bar sync unavailable'/)
  assert.match(control, /Queued messages have been left untouched/)
  assert.match(more, /isRestaurant && !barOnly && <SectionCard to="\/restaurant\/menu-production"/)
  assert.match(more, /isRestaurant && !barOnly && <SectionCard to="\/restaurant\/cash-close"/)
  assert.match(shell, /'\/restaurant\/menu-production'/)
})

test('Bar dashboard and owner page do not request legacy cloud POS or stock snapshots', () => {
  const ownerBarGuard = owner.slice(owner.indexOf('if (barOnly) {'), owner.indexOf('const [posSnap, transactions, inventory]'))
  const dashboardBarGuard = dashboard.slice(dashboard.indexOf('if (barOnly) {'), dashboard.indexOf('const [snapshotResult, bookingRows]'))
  assert.match(ownerBarGuard, /verified local sync projection/)
  assert.doesNotMatch(ownerBarGuard, /getManagerPosSnapshot|getManagerPosTransactions|listInventory/)
  assert.match(dashboardBarGuard, /verified local sync projection/)
  assert.doesNotMatch(dashboardBarGuard, /getManagerPosSnapshot|listInventory/)
  assert.doesNotMatch(owner, /Lodging receivables are outside this workspace/)
})

test('verified Bar sessions receive Bar copy and freshness accepts the existing timestamp prop', () => {
  assert.match(shell, /getPwaAuthenticatedShellConfig/)
  assert.match(shell, /brandTitle: 'Tsa Bonno Bar Manager'/)
  assert.match(freshness, /updatedAt, lastUpdated/)
  assert.match(freshness, /effectiveUpdatedAt = updatedAt \|\| lastUpdated/)
  assert.match(owner, /<MobileBoundaryNotice productFamily=\{user\.product_family\} hospitalityMode=\{user\.hospitality_mode\}/)
  assert.match(app, /if \(barOnly\) return undefined[\s\S]*?subscribeRuntimeEvent\('boroko:pwa-notifications'/)
  assert.match(app, /Bar sync alerts are not connected yet/)
  assert.match(more, /label=\{barOnly \? 'Bar support replies' : 'Front-desk replies'\}/)
})

test('the same PWA navigation adapts from phone bottom bar to desktop sidebar', () => {
  assert.match(css, /@media \(min-width: 1024px\)/)
  assert.match(css, /\.pwa-bottom-nav\s*\{[\s\S]*?flex-direction: column/)
  assert.match(css, /\.pwa-page-shell\s*\{[\s\S]*?max-width: 1600px/)
  assert.match(css, /@media print[\s\S]*?\.pwa-bottom-nav\s*\{[\s\S]*?display: none/)
})
