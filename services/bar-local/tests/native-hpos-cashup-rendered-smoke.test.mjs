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
import { SettingsContext, AccessContext } from './src/renderer/src/app-context.jsx'
import HposCashClose from './src/renderer/src/components/hospitality-pos/HposCashClose.jsx'

window.__cashupFixture = { approved: false, calls: [] }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'manager-1', role: 'owner', device_id: 'device-1' }
const envelope = (data) => ({ data, complete: true, unavailable: [], pagination: { next_cursor: null, has_more: false }, snapshot_watermark: 4, scope, as_of: '2026-11-05T10:00:00.000Z' })
const api = {
  async getOpenIntents() { return [] },
  async retryOperation() { throw new Error('No saved review in this fixture') },
  async query(name, filters) {
    window.__cashupFixture.calls.push({ kind: 'query', name, filters })
    if (name === 'cashup.pending') return envelope(window.__cashupFixture.approved ? [] : [{
      cashup_id: 'cashup-1', shift_id: 'shift-1', staff_id: 'cashier-1', cashier_name: 'Cashier One',
      counted_cash: '18.25', expected_cash: '18.25', variance: '0.00', counted_card: '0.00', status: 'submitted',
      notes: 'End of shift', submitted_at: '2026-11-05T09:00:00.000Z', proof_refs: [], business_date: '2026-11-05'
    }])
    if (name === 'tabs.list') return envelope([])
    throw new Error('Unexpected local query ' + name)
  },
  async requestApprovalForCommand(request) {
    window.__cashupFixture.calls.push({ kind: 'approval', request })
    return { approval_id: 'approval-1' }
  },
  async command(request) {
    window.__cashupFixture.calls.push({ kind: 'command', request })
    window.__cashupFixture.approved = true
    return { outcome: 'committed_local', result: { cashup_id: 'cashup-1', status: 'approved' } }
  }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: api, pos: rejectCloud, outlets: rejectCloud }
function App() {
  return <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', outlet_id: 'outlet-1', outlet_name: 'Main Bar', cash_model: 'personal', currency: 'P' }, setSettings() {} }}>
    <AccessContext.Provider value={{ capabilities: { 'pos.cashup': true }, effectiveCapabilities: { 'pos.cashup': true }, entitlement: { product_id: 'hospitality-pos', commercial_package_key: 'bar_pos' }, allowedOutletIds: ['outlet-1'], refreshEntitlement: async () => ({}) }}>
      <HposCashClose />
    </AccessContext.Provider>
  </SettingsContext.Provider>
}
createRoot(document.getElementById('root')).render(<App />)
`

test('rendered established Cash & Close reviews through local query and approval contracts without cloud IPC', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
  })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Cashier One', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Approve & close shift' }).click()
  await page.getByRole('textbox', { name: 'Manager PIN' }).fill('1234')
  await page.getByRole('button', { name: 'Approve & close shift' }).click()
  await page.getByText('Cash-up approved and the Till shift is closed.').waitFor()
  assert.deepEqual(errors, [])
  const calls = await page.evaluate(() => window.__cashupFixture.calls)
  const approval = calls.find((call) => call.kind === 'approval').request
  const command = calls.find((call) => call.kind === 'command').request
  assert.equal(approval.command, 'cashup.review')
  assert.equal(command.command, 'cashup.review')
  assert.equal(command.operation_id, approval.operation_id)
  assert.equal(command.payload.approval_id, 'approval-1')
  assert.equal(calls.some((call) => call.kind === 'query' && call.name === 'cashup.pending'), true)
})
