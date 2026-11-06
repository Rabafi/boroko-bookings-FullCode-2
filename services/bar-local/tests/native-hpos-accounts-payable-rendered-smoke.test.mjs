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
  for (const name of readdirSync(cache).filter(x => /^chromium_headless_shell-\d+$/.test(x)).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))) {
    const candidate = join(cache, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(candidate)) return candidate
  }
  return ''
})()

const entry = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AccessContext,AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Ap from'./src/renderer/src/components/restaurant-accounting/RestaurantAccountsPayable.jsx';
window.__apFixture={queries:[],commands:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333',device_id:'44444444-4444-4444-8444-444444444444'};const ids={invoice:'55555555-5555-4555-8555-555555555555',supplier:'66666666-6666-4666-8666-666666666666',payment:'77777777-7777-4777-8777-777777777777'};const rows={ap_invoices:[{id:ids.invoice,supplier_id:ids.supplier,invoice_number:'INV-1',invoice_date:'2026-11-01',due_date:'2026-12-01',total:'100.00',status:'approved'}],ap_payments:[{id:ids.payment,ap_invoice_id:ids.invoice,amount:'25.00',status:'posted'}],suppliers:[{id:ids.supplier,name:'Local Supplier',active:true}],accounts:[{account_code:'5000',name:'Food purchases',type:'expense',active:true},{account_code:'2100',name:'Accounts payable',type:'liability',active:true}],lines:[{description:'Produce',expense_account_code:'5000',quantity:'1',unit_price:'100.00',tax_rate:'0.00'}]};const bridge={async query(name,filters){window.__apFixture.queries.push([name,filters]);if(name==='accounting.accounts.list')return{data:rows.accounts,complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:7};return{data:filters.record_id? [{...rows.ap_invoices[0],lines:rows.lines}]:rows[filters.kind],complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:7}},async getOpenIntents(){return[]},async command(request){window.__apFixture.commands.push(request);return{outcome:'committed_local',result:{id:ids.invoice}}},async refreshReadiness(){return{ready:true,blockers:[]}}};window.api={barLocal:bridge,restaurantAccountingV2:{invoke(...args){window.__apFixture.cloud.push(args);throw Error('hosted Accounting API accessed')}}};const access={role:'manager',capabilities:{'accounting.read':true,'accounting.manage':true,'accounting.ap_pay':true},effectiveCapabilities:{'accounting.read':true,'accounting.manage':true,'accounting.ap_pay':true},features:{},entitlement:{enterprise_addons:['bar_accounting_workforce']}};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><AccessContext.Provider value={access}><Ap/></AccessContext.Provider></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original Accounts Payable saves a local draft and never calls hosted Accounting', {
  timeout: 60000,
  skip: !browserExecutable && 'No installed Chromium found; this smoke never downloads a browser.'
}, async (t) => {
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } })
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('cell', { name: /Local Supplier/ }).waitFor()
  await page.getByText(/can capture invoice drafts/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Submit' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Record payment' }).count(), 1)
  assert.equal(await page.getByLabel('Complete accounting exports').count(), 0)
  await page.getByLabel('Payable liability').selectOption('2100')
  const createForm = page.locator('form').filter({ hasText: 'Create supplier bill' })
  await createForm.getByLabel('Supplier').selectOption('66666666-6666-4666-8666-666666666666')
  await page.getByLabel('Invoice number').fill('INV-2')
  await page.getByLabel('Description').fill('Produce')
  await page.getByLabel('Unit cost').fill('10.25')
  await page.getByLabel('Expense / asset account').selectOption('5000')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await page.getByText(/Draft bill and its complete line set were created atomically/).waitFor()
  const result = await page.evaluate(() => window.__apFixture)
  assert.ok(result.queries.some(([name, filters]) => name === 'accounting.records' && filters.kind === 'ap_invoices'))
  assert.equal(result.commands.length, 1)
  assert.equal(result.commands[0].command, 'accounting.ap.invoice.upsert')
  assert.equal(result.commands[0].payload.total, '10.25')
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
