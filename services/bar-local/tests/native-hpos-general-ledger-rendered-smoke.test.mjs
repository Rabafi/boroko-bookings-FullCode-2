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
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AccessContext,AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Ledger from'./src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx';
window.__ledgerFixture={queries:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333',device_id:'55555555-5555-4555-8555-555555555555'};const bridge={async query(name,filters){window.__ledgerFixture.queries.push([name,filters]);return{data:name==='accounting.trial_balance'?[{account_code:'1000',name:'Cash',type:'asset',debit:'12.00',credit:'0.00',balance:'12.00'}]:[{id:'44444444-4444-4444-8444-444444444444',entry_date:'2026-11-05',description:'Local sale',source_type:'pos.sale',source_id:'sale-1',posting_key:'66666666-6666-4666-8666-666666666666',lines:[{id:'line-1',account_code:'1000',account_name:'Cash',debit:'12.00',credit:'0.00',description:'Tender'}]}],complete:true,pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:7}},async refreshReadiness(){return{ready:true,blockers:[]}}};window.api={barLocal:bridge,restaurantAccountingV2:{invoke(...args){window.__ledgerFixture.cloud.push(args);throw Error('hosted Accounting API accessed')}}};const access={role:'manager',capabilities:{'accounting.read':true,'accounting.manage':true},effectiveCapabilities:{'accounting.read':true,'accounting.manage':true},features:{},entitlement:{enterprise_addons:['bar_accounting_workforce']}};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><AccessContext.Provider value={access}><Ledger/></AccessContext.Provider></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original General Ledger reads the local journal and trial balance without cloud calls or local mutation controls', {
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
  await page.getByText('Local sale').waitFor()
  await page.getByRole('heading', { name: 'Trial balance' }).waitFor()
  await page.getByText(/read-only in this build/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Submit journal' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Reverse' }).count(), 0)
  assert.equal(await page.getByLabel('Complete accounting exports').count(), 0)
  const result = await page.evaluate(() => window.__ledgerFixture)
  assert.deepEqual(result.queries.map(([name]) => name).sort(), ['accounting.journal_entries', 'accounting.trial_balance'])
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
