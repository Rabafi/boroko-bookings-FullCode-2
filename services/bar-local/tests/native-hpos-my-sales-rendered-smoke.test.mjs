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
import { AuthContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import HposMySales from './src/renderer/src/components/hospitality-pos/HposMySales.jsx'

window.__salesFixture = { queries: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'cashier-1', role: 'cashier', device_id: 'device-1' }
const bridge = { async query(name, filters) {
  window.__salesFixture.queries.push([name, filters])
  if (name !== 'sales.mine') throw new Error('Unexpected local query ' + name)
  return { complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope,
    snapshot_watermark: 3, as_of: '2026-11-05T10:00:00.000Z', data: [{ id: 'sale-1', actor_staff_id: 'cashier-1', receipt_number: '3',
      receipt_series: 'BAR', business_date: '2026-11-05', status: 'completed', total: 10, subtotal: 10, tax: 0, tip_total: 0,
      created_at: '2026-11-05T09:00:00.000Z', table_name: null, service_mode: 'Counter',
      payment_breakdown: [{ method: 'cash', amount: 10 }], pos_order_items: [{ id: 'line-1', item_name: 'Water', quantity: 1, net_subtotal: 10 }] }] }
} }
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, pos: rejectCloud }
createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={{ user: { id: 'cashier-1', name: 'Cashier One', role: 'cashier', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', outlet_id: 'outlet-1', currency: 'BWP', timezone: 'Africa/Gaborone' }, setSettings() {} }}>
      <HposMySales />
    </SettingsContext.Provider>
  </AuthContext.Provider>
)
`

test('rendered original My Sales reads own receipts locally and exposes no hosted correction action', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true,
    write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Open receipt 3' }).waitFor()
  await page.getByRole('button', { name: 'Open receipt 3' }).click()
  await page.getByText('Local sale corrections are pending.', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Authorised approver PIN').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.__salesFixture.queries.map(([name]) => name)), ['sales.mine'])
  assert.deepEqual(errors, [])
})
