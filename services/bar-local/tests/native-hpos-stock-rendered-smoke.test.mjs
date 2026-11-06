import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { chromium } from 'playwright'
import esbuild from 'esbuild'

function installedBrowser() {
  if (process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH) return process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH
  if (existsSync(chromium.executablePath())) return chromium.executablePath()
  const cache = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright')
  if (!cache || !existsSync(cache)) return ''
  for (const name of readdirSync(cache).filter((entry) => /^chromium_headless_shell-\d+$/.test(entry)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const executable = join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(executable)) return executable
  }
  return ''
}
const executablePath = installedBrowser()
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { SettingsContext, AccessContext } from './src/renderer/src/app-context.jsx'
import HposStock from './src/renderer/src/components/hospitality-pos/HposStock.jsx'
const f = window.__nativeStockFixture
const apply = (request) => {
  const row = f.rows[0]
  if (request.command === 'stock.batch.record') row.current_stock = request.payload.lines[0].quantity
  if (request.command === 'stock.waste') row.current_stock = String(Number(row.current_stock) - Number(request.payload.quantity))
  row.stock_version += 1; row.updated_at = String(row.stock_version)
}
window.api = { barLocal: {
  readHposMenu: async (kind) => ({ complete: true, rows: kind === 'stock' ? f.rows : kind === 'outlets' ? [f.outlet] : [], groups: [] }),
  query: async (name) => ({ complete: true, unavailable: [], data: name === 'stock.aging' ? [{ item_id: f.rows[0].id, days_since_receipt: 2 }] : [],
    snapshot_watermark: 9, pagination: { has_more: false }, scope: f.scope }),
  getOpenIntents: async () => f.pending,
  requestApprovalForCommand: async (request) => { f.approvals.push(request); return { approval_id: '44444444-4444-4444-8444-444444444444' } },
  command: async (request) => {
    f.commands.push(request)
    if (request.command === 'stock.batch.record' && f.commands.length === 1) {
      f.pending = [{ operation_id: request.operation_id, command: request.command }]
      return { outcome: 'unknown', operation_id: request.operation_id }
    }
    apply(request)
    return { outcome: 'committed_local', result: {} }
  },
  retryOperation: async (id) => {
    f.retries.push(id); apply(f.commands.find((request) => request.operation_id === id)); f.pending = []
    return { outcome: 'committed_local', result: {} }
  }
} }
createRoot(document.getElementById('root')).render(
  <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', hospitality_mode: 'bar_only', currency: 'P' }, setSettings() {} }}>
    <AccessContext.Provider value={{ capabilities: { 'inventory.manage': true, 'inventory.view': true }, allowedOutletIds: null }}>
      <MemoryRouter><HposStock /></MemoryRouter>
    </AccessContext.Provider>
  </SettingsContext.Provider>
)
`

test('rendered original Hpos Stock recovers one saved count and requires a distinct manager PIN for waste', {
  timeout: 60000, skip: !executablePath && 'No installed Chromium; no browser download is permitted.'
}, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
  const productId = '11111111-1111-4111-8111-111111111111'
  const outletId = '22222222-2222-4222-8222-222222222222'
  const fixture = { rows: [{ id: productId, name: 'Water stock', category: 'Drinks', unit: 'bottle', barcode: '000123',
    current_stock: '20', product_version: 1, stock_version: 2, updated_at: '2', is_active: true, outlet_id: outletId }],
    outlet: { id: outletId, name: 'Main Bar', type: 'beverage', is_active: true },
    scope: { business_id: 'business', outlet_id: outletId, device_id: 'device', actor_staff_id: 'actor', role: 'stock' },
    commands: [], approvals: [], pending: [], retries: [] }
  const browser = await chromium.launch({ headless: true, executablePath })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' })
    .end(`<!doctype html><div id="root"></div><script>window.__nativeStockFixture=${JSON.stringify(fixture)}</script><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const row = page.getByRole('row').filter({ hasText: 'Water stock' })
  await row.getByRole('button', { name: 'Count', exact: true }).click()
  await page.getByLabel('Physical quantity on hand').fill('15')
  await page.getByLabel('Count note / reference').fill('Counted shelf')
  await page.getByRole('button', { name: 'Post count', exact: true }).click()
  await page.getByRole('button', { name: 'Retry saved operation', exact: true }).waitFor()
  assert.equal(await row.getByRole('button', { name: 'Receive', exact: true }).count(), 0, 'new actions stay fenced while the count result is unknown')
  await page.getByRole('button', { name: 'Retry saved operation', exact: true }).click()
  await row.getByRole('button', { name: 'Waste', exact: true }).waitFor()
  await row.getByRole('button', { name: 'Waste', exact: true }).click()
  await page.getByLabel('Quantity wasted').fill('2')
  await page.getByLabel('Waste note / reference').fill('Two broken bottles')
  await page.getByRole('button', { name: 'Record waste', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__nativeStockFixture.approvals.length), 0, 'an empty PIN cannot request approval')
  await page.getByLabel('Approving manager PIN').fill('5678')
  await page.getByRole('button', { name: 'Record waste', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const result = await page.evaluate(() => window.__nativeStockFixture)
  assert.equal(result.commands.length, 2)
  assert.equal(result.commands[0].command, 'stock.batch.record')
  assert.deepEqual(result.retries, [result.commands[0].operation_id])
  assert.equal(result.commands[1].command, 'stock.waste')
  assert.equal(result.approvals[0].operation_id, result.commands[1].operation_id)
  assert.equal(result.rows[0].current_stock, '13')
  assert.deepEqual(errors, [])
})
