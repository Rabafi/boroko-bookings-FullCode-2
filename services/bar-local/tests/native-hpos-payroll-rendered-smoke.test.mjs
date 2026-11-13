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
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{AccessContext,AuthContext,SettingsContext}from'./src/renderer/src/app-context.jsx';import Payroll from'./src/renderer/src/components/restaurant-accounting/RestaurantPayroll.jsx';
window.__payrollFixture={queries:[],commands:[],approvals:[],cloud:[]};const scope={business_id:'11111111-1111-4111-8111-111111111111',outlet_id:'22222222-2222-4222-8222-222222222222',actor_staff_id:'33333333-3333-4333-8333-333333333333'};const runId='66666666-6666-4666-8666-666666666666';let watermark=1;let runs=[];const accounts=[{account_code:'6000',name:'Payroll expense',type:'expense',active:true,version:1},{account_code:'2100',name:'Payroll payable',type:'liability',active:true,version:1}];const bridge={async query(name,filters){window.__payrollFixture.queries.push([name,filters]);const data=name==='accounting.accounts.list'?accounts:filters.record_id?runs.filter(row=>row.id===filters.record_id).map(row=>({...row,lines:row.lines})):runs.map(({lines,...row})=>row);return{data,complete:true,unavailable:[],pagination:{has_more:false,next_cursor:null},scope,snapshot_watermark:watermark}},async refreshReadiness(){return{ready:true,blockers:[]}},async getOpenIntents(){return[]},async retryOperation(){throw Error('Unexpected retry')},async requestApprovalForCommand(request){window.__payrollFixture.approvals.push(request);return{approval_id:'77777777-7777-4777-8777-777777777777'}},async command(request){window.__payrollFixture.commands.push(request);const p=request.payload;if(request.command==='accounting.payroll_run.create'){const total=p.lines.reduce((sum,line)=>sum+Number(line.gross),0),ded=p.lines.reduce((sum,line)=>sum+Number(line.deductions),0);runs=[{id:runId,period_start:p.period_start,period_end:p.period_end,pay_date:p.pay_date,status:'draft',version:1,gross_total:total.toFixed(2),deductions_total:ded.toFixed(2),net_total:(total-ded).toFixed(2),snapshot_hash:null,journal_entry_id:null,payment_status:'external_required',filing_status:'external_required',lines:p.lines.map(line=>({...line,net:(Number(line.gross)-Number(line.deductions)).toFixed(2)}))}]}if(request.command==='accounting.payroll_run.prepare'){runs=runs.map(row=>row.id===p.payroll_run_id?{...row,status:'prepared',version:2,snapshot_hash:'a'.repeat(64)}:row)}if(request.command==='accounting.payroll_run.finalise'){runs=runs.map(row=>row.id===p.payroll_run_id?{...row,status:'finalised',version:3,journal_entry_id:'88888888-8888-4888-8888-888888888888'}:row)}watermark++;return{outcome:'committed_local',result:{payroll_run_id:runId}}}};window.api={barLocal:bridge,restaurantAccountingV2:{invoke(...args){window.__payrollFixture.cloud.push(args);throw Error('hosted Accounting API accessed')}}};const access={role:'manager',capabilities:{'accounting.read':true,'accounting.manage':true,'accounting.approve':true},effectiveCapabilities:{'accounting.read':true,'accounting.manage':true,'accounting.approve':true},features:{},entitlement:{enterprise_addons:['bar_accounting_workforce']}};createRoot(document.getElementById('root')).render(<MemoryRouter><AuthContext.Provider value={{user:{id:scope.actor_staff_id,role:'manager',localAuthority:true,lodge_id:scope.business_id}}}><SettingsContext.Provider value={{settings:{authority_mode:'bar_local',property_type:'bar',lodge_id:scope.business_id,outlet_id:scope.outlet_id,currency:'BWP'}}}><AccessContext.Provider value={access}><Payroll/></AccessContext.Provider></SettingsContext.Provider></AuthContext.Provider></MemoryRouter>);`

test('rendered original Accounting Pro Payroll uses local runs and approved local commands only', {
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
  await page.getByRole('heading', { name: 'Payroll' }).waitFor()
  try { await page.getByText(/does not calculate statutory pay/).waitFor() }
  catch (error) { throw new Error(`${error.message}\nRendered body: ${await page.locator('body').innerText()}\nBrowser errors: ${errors.join(' | ')}`) }
  await page.getByLabel('Period start').fill('2026-11-01')
  await page.getByLabel('Period end').fill('2026-11-30')
  await page.getByLabel('Pay date').fill('2026-12-05')
  await page.getByLabel('Payroll expense account').selectOption('6000')
  await page.getByLabel('Net payable account').selectOption('2100')
  await page.getByLabel('Opaque employee ref').fill('STAFF-001')
  await page.getByLabel('Gross').fill('1000.00')
  await page.getByRole('textbox', { name: 'Deductions' }).fill('100.00')
  await page.getByRole('button', { name: 'Save local draft run' }).click()
  await page.getByText('STAFF-001').waitFor()
  await page.getByRole('button', { name: 'Prepare snapshot' }).click()
  await page.getByLabel('Different manager PIN for finalisation').fill('1234')
  await page.getByRole('button', { name: 'Finalise with another manager' }).click()
  await page.getByRole('cell', { name: /^finalised/ }).waitFor()
  const result = await page.evaluate(() => window.__payrollFixture)
  const payrollQueries = result.queries.filter(([name]) => name === 'accounting.records')
  assert.equal(payrollQueries.length, 7)
  assert.equal(payrollQueries.filter(([, filters]) => Boolean(filters.record_id)).length, 3)
  assert.ok(payrollQueries.every(([, filters]) => filters.kind === 'payroll_runs'))
  assert.deepEqual(result.commands.map(request => request.command), ['accounting.payroll_run.create', 'accounting.payroll_run.prepare', 'accounting.payroll_run.finalise'])
  assert.equal(result.commands[2].payload.approval_id, '77777777-7777-4777-8777-777777777777')
  assert.equal(result.approvals.length, 1)
  assert.deepEqual(result.cloud, [])
  assert.deepEqual(errors, [])
})
