import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const products = [
  ['lodge-camp', 'com.boroko.lodgecamp', 'Boroko Lodge & Camp'],
  ['hotel', 'com.boroko.hotel', 'Boroko Hotel'],
  ['hospitality-pos', 'com.boroko.hospitalitypos', 'Boroko Restaurant & Bar POS']
]

test('each physical product app has an independent installer identity', () => {
  const appIds = new Set()
  for (const [id, appId, productName] of products) {
    const appDir = path.join(root, 'apps', id)
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'product.json'), 'utf8'))
    const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
    const builder = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder.json'), 'utf8'))
    assert.equal(manifest.id, id)
    assert.equal(builder.appId, appId)
    assert.equal(builder.productName, productName)
    assert.ok(packageJson.scripts.build.includes(`product-app.mjs ${id} build`))
    assert.ok(packageJson.scripts.dist.includes(`product-app.mjs ${id} dist`))
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
