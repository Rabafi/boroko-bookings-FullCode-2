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
import { AccessContext, AuthContext, SettingsContext } from './src/renderer/src/app-context.jsx'
import HposExpenses from './src/renderer/src/components/hospitality-pos/HposExpenses.jsx'

window.__expenseFixture = { queries: [], commands: [], approvals: [], expenseStatus: 'none' }
const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'manager-1', role: 'manager', device_id: 'device-1' }
const bridge = {
  async query(name, filters) {
    window.__expenseFixture.queries.push([name, filters])
    const data = name === 'expenses.list' ? window.__expenseFixture.expenseStatus === 'none' ? [] : [{ expense_id: '11111111-1111-4111-8111-111111111111', expense_date: '2026-11-05', category: 'Utilities', description: 'Ice delivery', amount: '25.00', reference: null, status: window.__expenseFixture.expenseStatus, version: window.__expenseFixture.expenseStatus === 'voided' ? 2 : 1 }] : name === 'accounting.accounts.list' && filters.type === 'expense'
      ? [{ account_code: '5000', name: 'Utilities', type: 'expense', active: true }]
      : [{ account_code: '1000', name: 'Cash', type: 'asset', active: true }, { account_code: '5000', name: 'Utilities', type: 'expense', active: true }]
    return { data, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope, snapshot_watermark: 3, as_of: '2026-11-05T10:00:00.000Z' }
  },
  async requestApprovalForCommand(request) { window.__expenseFixture.approvals.push(request); return { approval_id: '22222222-2222-4222-8222-222222222222' } },
  async command(request) { window.__expenseFixture.commands.push(request); window.__expenseFixture.expenseStatus = request.command === 'expense.void' ? 'voided' : 'posted'; return { outcome: 'committed_local', result: { expense_id: 'expense-1' }, receipt: { expense_id: 'expense-1' } } }
}
const rejectCloud = new Proxy({}, { get(_target, name) { throw new Error('Cloud API accessed: ' + String(name)) } })
window.api = { barLocal: bridge, expenses: rejectCloud, data: rejectCloud }
const access = { capabilities: { 'accounting.manage': true, 'accounting.read': true }, effectiveCapabilities: { 'accounting.manage': true, 'accounting.read': true }, entitlement: { enterprise_addons: [] } }
createRoot(document.getElementById('root')).render(
  <AuthContext.Provider value={{ user: { id: 'manager-1', name: 'Manager One', role: 'manager', localAuthority: true }, logout: async () => {} }}>
    <SettingsContext.Provider value={{ settings: { authority_mode: 'bar_local', currency: 'BWP' }, setSettings() {} }}>
      <AccessContext.Provider value={access}><HposExpenses /></AccessContext.Provider>
    </SettingsContext.Provider>
  </AuthContext.Provider>
)
`

test('rendered original Expenses posts through the local atomic journal command only', {
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
  await page.getByRole('heading', { name: 'Record expense' }).waitFor()
  await page.getByLabel('Description', { exact: false }).fill('Ice delivery')
  await page.getByLabel('Amount (BWP)').fill('25.00')
  await page.getByLabel('Expense account').selectOption('5000')
  await page.getByLabel('Payment account').selectOption('1000')
  await page.getByRole('button', { name: 'Post local expense' }).click()
  await page.getByText('Expense posted to the local journal.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Request approved reversal' }).click()
  await page.getByLabel('Reason', { exact: false }).fill('Duplicate receipt')
  await page.getByLabel('Different manager PIN').fill('1234')
  await page.getByRole('button', { name: 'Approve and reverse' }).click()
  await page.getByText('Expense reversal was approved and posted by the local authority.', { exact: false }).waitFor()
  const result = await page.evaluate(() => window.__expenseFixture)
  assert.deepEqual(result.commands.map((request) => request.command), ['expense.create', 'expense.void'])
  assert.deepEqual(result.commands[0].payload, {
    expense_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date()),
    category: 'Food & beverage', description: 'Ice delivery', amount: '25.00',
    expense_account_code: '5000', payment_account_code: '1000'
  })
  assert.ok(result.commands[0].operation_id)
  assert.equal(result.approvals.length, 1)
  assert.equal(result.approvals[0].command, 'expense.void')
  assert.deepEqual(result.approvals[0].payload, { expense_id: '11111111-1111-4111-8111-111111111111', expected_version: 1, reason: 'Duplicate receipt' })
  assert.equal(result.commands[1].payload.approval_id, '22222222-2222-4222-8222-222222222222')
  assert.ok(result.queries.some(([name]) => name === 'expenses.list'))
  assert.ok(result.queries.filter(([name]) => name === 'accounting.accounts.list').length >= 2)
  assert.deepEqual(errors, [])
})
