import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { chromium } from 'playwright'
import esbuild from 'esbuild'

const root = process.cwd()
const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : ''
const browserExecutable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH || (() => {
  if (existsSync(chromium.executablePath())) return chromium.executablePath()
  if (!cache || !existsSync(cache)) return ''
  for (const name of readdirSync(cache).filter((entry) => /^chromium_headless_shell-\d+$/.test(entry)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const candidate = join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(candidate)) return candidate
  }
  return ''
})()

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SettingsContext, AccessContext } from './src/renderer/src/app-context.jsx'
import HposMenu from './src/renderer/src/components/hospitality-pos/HposMenu.jsx'
import { readNativeHposMenu, saveNativeHposBarProduct, retryNativeHposBarProduct } from './src/main/bar-local/nativeHposMenu.js'

const query = async (name) => {
  const fixture = window.__nativeMenuFixture
  const data = name === 'menu.availability' ? fixture.products
    : name === 'stock.list' ? fixture.stock
    : name === 'menu.modifiers' ? fixture.modifiers
    : name === 'bootstrap' ? { outlet: fixture.outlet }
    : []
  return { complete: true, unavailable: [], data, snapshot_watermark: 7,
    pagination: { has_more: false }, scope: fixture.scope }
}
const runtime = {
  query,
  command: async (request) => {
    const fixture = window.__nativeMenuFixture
    fixture.commands.push(request)
    if (request.command === 'catalogue.availability.set') {
      const product = fixture.products.find((row) => row.product_id === request.payload.product_id)
      product.available = request.payload.available
      product.override_available = request.payload.available
      product.availability_version += 1
    }
    if (request.command === 'catalogue.bar_product.save') {
      const product = fixture.products.find((row) => row.product_id === request.payload.menu_item_id)
      product.name = request.payload.name
      product.product_version += 1
    }
    return { outcome: 'committed_local', result: {
      menu_item_id: request.payload.menu_item_id || 'new-product-id',
      inventory_item_id: request.payload.inventory_item_id || 'stock-id'
    } }
  },
  retryOperation: async (operationId) => ({ outcome: 'committed_local', operation_id: operationId, result: {} })
}

window.api = { barLocal: {
  readHposMenu: (kind) => readNativeHposMenu(runtime, kind),
  saveHposBarProduct: (request) => saveNativeHposBarProduct(runtime, request),
  retryHposBarProduct: (operationId) => retryNativeHposBarProduct(runtime, operationId),
  getOpenIntents: async () => [], command: runtime.command, retryOperation: runtime.retryOperation
} }

function App() {
  return <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', hospitality_mode: 'bar_only', currency: 'P' }, setSettings() {} }}>
    <AccessContext.Provider value={{ capabilities: { 'pos.menu_manage': true, 'inventory.manage': true, 'inventory.view': true }, entitlement: { product_id: 'hospitality-pos', commercial_package_key: 'bar_pos' }, allowedOutletIds: null, refreshEntitlement: async () => ({}) }}>
      <MemoryRouter initialEntries={['/hpos/menu']}><Routes>
        <Route path='/hpos/menu' element={<HposMenu />} />
        <Route path='/restaurant/menu-production' element={<div />} />
      </Routes></MemoryRouter>
    </AccessContext.Provider>
  </SettingsContext.Provider>
}
createRoot(document.getElementById('root')).render(<App />)
`

test('rendered original Hpos Menu reopens a direct-linked pack product through stock controls after a local save refresh', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
  })
  const products = [
    { product_id: 'base-id', sku: 'BAR-WATER', name: 'Water', category: 'Drinks', price: '12.00', tax_rate: '0.14', barcode: 'WATER', track_stock: false, product_active: true, product_version: 4, inventory_item_id: 'stock-id', depletion_qty: '1', stock_version: 2, available: false, availability_version: 1, stock_quantity: '20' },
    { product_id: 'pack-id', sku: 'BAR-WATER-6', name: 'Water 6-pack', category: 'Drinks', price: '60.00', tax_rate: '0.14', barcode: 'WATER-6', track_stock: false, product_active: true, product_version: 2, inventory_item_id: 'stock-id', depletion_qty: '6', stock_version: 2, available: true, availability_version: 1, stock_quantity: '20', template_kind: 'bar_pack', template_pack_size: 6, template_parent_product_id: 'base-id' }
  ]
  const fixture = {
    products,
    stock: [{ product_id: 'stock-id', sku: 'STK-WATER', name: 'Water stock', category: 'Drinks', track_stock: true, active: true, quantity: '20', version: 2, product_version: 1, unit: 'bottle', reorder_level: '2' }],
    modifiers: { groups: [], products: [
      { product_id: 'base-id', sku: 'BAR-WATER', name: 'Water', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '1' }] },
      { product_id: 'pack-id', sku: 'BAR-WATER-6', name: 'Water 6-pack', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '6' }] },
      { product_id: 'meal-id', sku: 'BAR-MEAL', name: 'Prepared meal', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '0.25' }] }
    ], promotions: [] },
    outlet: { id: 'outlet-id', name: 'Main Bar', type: 'beverage' },
    scope: { business_id: 'business-id', outlet_id: 'outlet-id' }, commands: []
  }
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>window.__nativeMenuFixture=${JSON.stringify(fixture)}</script><script>${bundle.outputFiles[0].text}</script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: 'Drinks & products' }).waitFor()
  await page.getByRole('button', { name: 'Edit Water', exact: true }).click()
  await page.getByRole('heading', { name: 'Edit Water' }).waitFor()
  await page.getByLabel('Stock source').waitFor()
  assert.equal(await page.getByLabel('Stock source').inputValue(), 'link')
  await page.getByText('Packs (optional)', { exact: true }).waitFor()
  assert.equal(await page.getByText(/Recipe product \(Included with Stock add-on\)/).count(), 0)
  assert.equal(await page.getByRole('checkbox', { name: '6-pack', exact: true }).isChecked(), true)
  assert.equal(await page.getByRole('checkbox', { name: /^Available for sale/ }).isChecked(), false)

  await page.getByLabel('Product name').fill('Water Updated')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Water Updated', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit Water Updated', exact: true }).click()
  await page.getByRole('heading', { name: 'Edit Water Updated' }).waitFor()
  assert.equal(await page.getByLabel('Stock source').inputValue(), 'link', 'post-save snapshot still classifies the linked product as stock-backed')
  assert.equal(await page.getByRole('checkbox', { name: '6-pack', exact: true }).isChecked(), true, 'the shared pack remains visible after refresh and wizard reopen')
  assert.deepEqual(errors, [])
  const commands = await page.evaluate(() => window.__nativeMenuFixture.commands)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].command, 'catalogue.bar_product.save')
  assert.equal(commands[0].payload.pack6, true)
  assert.equal(commands[0].payload.is_available, false, 'a name edit cannot make a sold-out product available')
})
