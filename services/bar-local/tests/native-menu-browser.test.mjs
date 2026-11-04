import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'
import { chromium } from 'playwright'
import esbuild from 'esbuild'

const root = process.cwd()
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AccessContext } from './src/renderer/src/app-context.jsx'
import BarLocalNativeMenu from './src/renderer/src/components/hospitality-pos/BarLocalNativeMenu.jsx'
function App() { return <AccessContext.Provider value={{effectiveCapabilities:{'pos.menu_manage':true}}}><BarLocalNativeMenu/></AccessContext.Provider> }
createRoot(document.getElementById('root')).render(<App/>)
`

test('rendered local Menu creates, edits, changes availability and archives through the real local service HTTP API', {
  timeout: 120000,
  skip: !process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH && 'Set BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH to run the rendered Chromium integration.'
}, async (t) => {
  const h = await createApiHarness(t)
  const setup = await h.request('/v1/setup/owner', { body: {
    setup_secret: TEST_SETUP_SECRET, business_name: 'Rendered Menu Test Bar', outlet_name: 'Main',
    owner_name: 'Test Owner', pin: '1234', device_name: 'Rendered Menu Test Till'
  } })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const session = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(session.status, 201, JSON.stringify(session.body))
  const scope = {
    authority_id: setup.body.authority_id,
    authority_epoch: setup.body.authority_epoch,
    business_id: setup.body.business_id,
    outlet_id: setup.body.outlet_id,
    device_id: setup.body.device_id
  }
  const build = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
  })
  const bundle = build.outputFiles[0].text
  const executable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH
  const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const pageErrors = []
  const serviceResponses = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  const server = createServer(async (req, res) => {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>
        window.api={barLocal:{
          query:async(name,filters)=>{const r=await fetch('/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,filters})});return r.json()},
          command:async(request)=>{const r=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});return r.json()},
          getOpenIntents:async()=>[],retryOperation:async()=>({outcome:'refused',error:{message:'No open local operation.'}})
        }}
      </script><script src="/app.js"></script>`)
    } else if (req.url === '/app.js' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
    } else if (req.method === 'POST' && (req.url === '/query' || req.url === '/command')) {
      let raw = ''
      for await (const part of req) raw += part
      const body = JSON.parse(raw)
      const auth = { token: session.body.session_token, deviceId: setup.body.device_id }
      let result
      if (req.url === '/query') {
        result = await h.request(`/v1/queries/${encodeURIComponent(body.name)}`, {
          ...auth,
          body: { contract_version: 1, authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
            query: body.name, query_version: 1, filters: body.filters }
        })
      } else {
        result = await h.request('/v1/commands', {
          ...auth,
          body: { contract_version: 1, ...scope, operation_id: body.operation_id || randomUUID(),
            command: body.command, payload: body.payload }
        })
      }
      serviceResponses.push({ route: req.url, status: result.status, body: result.body })
      const response = result.status >= 400 && req.url === '/command'
        ? { outcome: 'refused', error: { code: result.body?.code, message: result.body?.message } }
        : result.body
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response))
    } else res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('heading', { name: 'Menu and availability' }).waitFor()

  await page.getByLabel('SKU').fill('BROWSER-MENU-1')
  await page.getByLabel('Name').fill('Browser Menu Product')
  await page.getByLabel('Category').fill('Drinks')
  await page.getByLabel('Price').fill('12.50')
  await page.getByLabel('Tax (%)').fill('14')
  await page.getByRole('button', { name: 'Save locally' }).click()
  const row = page.getByRole('row').filter({ hasText: 'BROWSER-MENU-1' })
  try { await row.waitFor({ timeout: 8000 }) } catch {
    const alerts = await page.getByRole('alert').allTextContents()
    throw new Error(`Product did not appear after save. Alerts: ${JSON.stringify(alerts)}. Service responses: ${JSON.stringify(serviceResponses)}`)
  }
  let products = await h.migrator.query("SELECT id AS product_id, sku, name, tax_rate::text, version FROM bar_local.products WHERE business_id=$1 AND sku='BROWSER-MENU-1'", [setup.body.business_id])
  products = { data: products.rows }
  const product = products.data.find((item) => item.sku === 'BROWSER-MENU-1')
  assert.ok(product)
  assert.equal(product.tax_rate, '0.1400')
  assert.equal(Number(product.version), 1)

  await row.getByRole('button', { name: 'Mark sold out' }).click()
  await row.getByRole('button', { name: 'Make available' }).waitFor()
  const availability = await h.migrator.query(`SELECT available FROM bar_local.product_availability WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3`, [setup.body.business_id, setup.body.outlet_id, product.product_id])
  assert.equal(availability.rows[0].available, false)

  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Name').fill('Browser Menu Product Updated')
  await page.getByRole('button', { name: 'Save locally' }).click()
  await page.getByRole('row').filter({ hasText: 'Browser Menu Product Updated' }).waitFor()
  products = await h.migrator.query("SELECT id AS product_id, name, version FROM bar_local.products WHERE business_id=$1 AND id=$2", [setup.body.business_id, product.product_id])
  const edited = products.rows[0]
  assert.equal(edited.name, 'Browser Menu Product Updated')
  assert.equal(Number(edited.version), 2)

  const editedRow = page.getByRole('row').filter({ hasText: 'BROWSER-MENU-1' })
  await editedRow.getByRole('button', { name: 'Archive' }).click()
  await editedRow.getByText('Archived').waitFor()
  products = await h.migrator.query("SELECT active FROM bar_local.products WHERE business_id=$1 AND id=$2", [setup.body.business_id, product.product_id])
  assert.equal(products.rows[0].active, false)
  const audit = await h.migrator.query("SELECT count(*)::int AS count FROM bar_local.audit_log WHERE business_id=$1 AND action = 'catalogue.upsert' AND after->>'sku' = 'BROWSER-MENU-1'", [setup.body.business_id])
  assert.ok(audit.rows[0].count >= 3)
  assert.deepEqual(pageErrors, [])
})
