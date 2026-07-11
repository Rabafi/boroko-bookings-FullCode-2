import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'
import { HOSPITALITY_MODES, getHospitalityMode, isBarOnlyMode } from '../src/shared/propertyTypes.js'

const root = process.cwd()
const products = [
  ['lodge-camp', 'com.boroko.lodgecamp', 'Boroko Lodge & Camp', 'boroko-lodge-camp-releases'],
  ['hotel', 'com.boroko.hotel', 'Boroko Hotel', 'boroko-hotel-releases'],
  ['hospitality-pos', 'com.boroko.hospitalitypos', 'Boroko Restaurant & Bar POS', 'boroko-hospitality-pos-releases']
]

test('each physical product app has an independent installer identity', () => {
  const appIds = new Set()
  for (const [id, appId, productName, releaseRepo] of products) {
    const appDir = path.join(root, 'apps', id)
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'product.json'), 'utf8'))
    const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
    const builder = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder.json'), 'utf8'))
    assert.equal(manifest.id, id)
    assert.equal(builder.appId, appId)
    assert.equal(builder.productName, productName)
    assert.equal(builder.publish?.repo, releaseRepo)
    assert.ok(packageJson.scripts.build.includes(`product-app.mjs ${id} build`))
    assert.ok(packageJson.scripts.dist.includes(`product-app.mjs ${id} dist`))
    assert.ok(packageJson.scripts['dist:publish'].includes(`product-app.mjs ${id} publish`))
    appIds.add(builder.appId)
  }
  assert.equal(appIds.size, products.length)
})

test('product build configuration is injected into all Electron runtimes', () => {
  const config = fs.readFileSync(path.join(root, 'electron.vite.config.js'), 'utf8')
  const identity = fs.readFileSync(path.join(root, 'src/shared/productIdentity.js'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  assert.match(config, /__BOROKO_PRODUCT__/)
  assert.match(identity, /hospitality-pos/)
  assert.match(main, /app:getProduct/)
  assert.match(setup, /PRODUCT_PROPERTY_TYPES\.map/)
})

test('Hospitality POS persists Bar Only as an explicit operating mode', () => {
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  assert.equal(getHospitalityMode({ operating_profile: {} }), HOSPITALITY_MODES.RESTAURANT_BAR)
  assert.equal(isBarOnlyMode({ operating_profile: { hospitality_mode: 'bar_only' } }), true)
  assert.match(setup, /hospitality_mode: IS_HOSPITALITY_POS_PRODUCT \? hospitalityMode : null/)
  assert.match(setup, /Bar Only/)
})

test('Bar Only hides restaurant-only navigation while preserving core POS operations', () => {
  const access = { allowedByRole: { 'pos.view': true, 'pos.manage': true, 'pos.cashup': true, 'inventory.view': true, 'staff.view': true, 'reports.view': true } }
  const items = getDesktopNavItems('restaurant', access, 'restaurant', 'Pro', [], { hospitality_mode: 'bar_only' })
  const routes = new Set(items.map((item) => item.to))
  assert.equal(routes.has('/pos'), true)
  assert.equal(routes.has('/restaurant/stock-purchasing'), true)
  assert.equal(routes.has('/restaurant/cash-close'), true)
  assert.equal(routes.has('/restaurant/floor'), false)
  assert.equal(routes.has('/restaurant/kitchen-workspace'), false)
  assert.equal(routes.has('/restaurant/menu-production'), false)
})
