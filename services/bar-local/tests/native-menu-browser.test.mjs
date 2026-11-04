import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHarness } from './harness.mjs'
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

test('rendered local Menu creates, edits, changes availability and archives against disposable PostgreSQL', {
  timeout: 120000,
  skip: !process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH && 'Set BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH to run the rendered Chromium integration.'
}, async (t) => {
  const h = await createHarness(t)
  const build = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
  })
  const bundle = build.outputFiles[0].text
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><div id="root"></div><script>
        window.api={barLocal:{
          query:async(name,filters)=>{const r=await fetch('/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,filters})});return r.json()},
          command:async(request)=>{const r=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});return r.json()},
          getOpenIntents:async()=>[],retryOperation:async()=>({outcome:'refused',error:{message:'No open local operation.'}})
        }}
      </script><script src="/app.js"></script>`)
    } else if (req.url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
    } else if (req.method === 'POST' && (req.url === '/query' || req.url === '/command')) {
      let raw = ''
      for await (const part of req) raw += part
      const body = JSON.parse(raw)
      try {
        if (req.url === '/query') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await h.query(body.name, body.filters)))
        } else {
          const fn = body.command === 'catalogue.upsert' ? 'cmd_catalogue_upsert' : body.command === 'catalogue.availability.set' ? 'cmd_catalogue_availability_set' : null
          if (!fn) throw new Error('Disallowed command in rendered menu test.')
          const result = await h.call(fn, h.envelope(body.command, body.payload, body.operation_id))
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result.ok
            ? { outcome: 'committed_local', result: result.result }
            : { outcome: 'refused', error: result.error }))
        }
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } }))
      }
    } else res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const executable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH
  const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('heading', { name: 'Menu and availability' }).waitFor()

  await page.getByLabel('SKU').fill('BROWSER-MENU-1')
  await page.getByLabel('Name').fill('Browser Menu Product')
  await page.getByLabel('Category').fill('Drinks')
  await page.getByLabel('Price').fill('12.50')
  await page.getByLabel('Tax (%)').fill('14')
  await page.getByRole('button', { name: 'Save locally' }).click()
  const row = page.getByRole('row').filter({ hasText: 'BROWSER-MENU-1' })
  await row.waitFor()
  let products = await h.query('menu.list', { include_inactive: true })
  const product = products.data.find((item) => item.sku === 'BROWSER-MENU-1')
  assert.ok(product)
  assert.equal(product.tax_rate, '0.1400')
  assert.equal(Number(product.version), 1)

  await row.getByRole('button', { name: 'Mark sold out' }).click()
  await row.getByRole('button', { name: 'Make available' }).waitFor()
  const availability = await h.query('menu.availability', { include_inactive: true })
  assert.equal(availability.data.find((item) => item.product_id === product.product_id).available, false)

  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Name').fill('Browser Menu Product Updated')
  await page.getByRole('button', { name: 'Save locally' }).click()
  await page.getByRole('row').filter({ hasText: 'Browser Menu Product Updated' }).waitFor()
  products = await h.query('menu.list', { include_inactive: true })
  const edited = products.data.find((item) => item.product_id === product.product_id)
  assert.equal(edited.name, 'Browser Menu Product Updated')
  assert.equal(Number(edited.version), 2)

  const editedRow = page.getByRole('row').filter({ hasText: 'BROWSER-MENU-1' })
  await editedRow.getByRole('button', { name: 'Archive' }).click()
  await editedRow.getByText('Archived').waitFor()
  products = await h.query('menu.list', { include_inactive: true })
  assert.equal(products.data.find((item) => item.product_id === product.product_id).active, false)
  const audit = await h.migrator.query("SELECT count(*)::int AS count FROM bar_local.audit_log WHERE action = 'catalogue.upsert' AND after->>'sku' = 'BROWSER-MENU-1'")
  assert.ok(audit.rows[0].count >= 3)
  assert.deepEqual(pageErrors, [])
})
