import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('Legacy local stock panel submits approved exact-lot waste and inspected quarantine release', { timeout: 90000 }, async () => {
  const component = fileURLToPath(new URL('../../legacy-pos/src/renderer/src/components/BarLocalOperationsPanel.jsx', import.meta.url))
  const businessId = '42000000-0000-4000-8000-000000000001'
  const outletId = '42000000-0000-4000-8000-000000000002'
  const productId = '42000000-0000-4000-8000-000000000003'
  const lotId = '42000000-0000-4000-8000-000000000004'
  const quarantineId = '42000000-0000-4000-8000-000000000005'
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Operations from ${JSON.stringify(component)};
      const product='${productId}',lot='${lotId}',quarantine='${quarantineId}';
      window.api={pos:{barLocal:{query:async()=>({data:[],complete:true,scope:{business_id:'${businessId}',outlet_id:'${outletId}'},unavailable:[]}),requestApproval:async(command,payload,pin)=>{const result={command,payload,pin};approvals.push(result);return{approval_id:'approval-1'}}}}};
      const approvals=window.__approvals=[];const commands=window.__commands=[];
      function App(){return <Operations section="stock" onCommand={async(command,payload)=>{commands.push({command,payload});return{outcome:'committed_local'}}} busy={false} pending={null} localReady={true} capabilities={['inventory.view','inventory.manage']} staff={{staff_id:'staff-1'}} shift={null} stock={[{product_id:product,name:'Synthetic tonic',sku:'SYN-TONIC',quantity:'10.000000',track_stock:true}]} stockLotBalanceRows={[{lot_id:lot,product_id:product,name:'Synthetic tonic',sku:'SYN-TONIC',lot_code:'WASTE-A',remaining_quantity:'3.000000',sale_eligible:true,version:2,expiry_status:'in_date'},{lot_id:quarantine,product_id:product,name:'Synthetic tonic',sku:'SYN-TONIC',lot_code:null,remaining_quantity:'1.000000',sale_eligible:false,version:1,expiry_status:'quarantined'}]} authority={{business_id:'${businessId}',outlet_id:'${outletId}'}} panelVersion={1}/>};
      createRoot(document.getElementById('root')).render(<App/>);`
        .replace('const approvals=window.__approvals=[];const commands=window.__commands=[];', 'const approvals=window.__approvals=[];const commands=window.__commands=[];'),
      resolveDir: process.cwd(),
      loader: 'jsx'
    },
    bundle: true,
    write: false,
    alias: {
      react: fileURLToPath(new URL('../../node_modules/react/index.js', import.meta.url)),
      'react/jsx-runtime': fileURLToPath(new URL('../../node_modules/react/jsx-runtime.js', import.meta.url)),
      'react-dom/client': fileURLToPath(new URL('../../node_modules/react-dom/client.js', import.meta.url))
    },
    jsx: 'automatic',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' }
  })
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle.outputFiles[0].text)
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const executable = process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH ?? process.env.LUNA_CHROMIUM_EXECUTABLE_PATH
    browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) })
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForTimeout(500)
    if (pageErrors.length) throw new Error(`Legacy component failed to render: ${pageErrors.join('; ')}`)
    assert.match(await page.locator('body').innerText(), /Stock movement/)

    const movement = page.getByLabel('Movement').locator('xpath=ancestor::form')
    await movement.locator('select').nth(0).selectOption('waste')
    await movement.locator('select').nth(1).selectOption(productId)
    await movement.getByRole('textbox', { name: 'Quantity' }).fill('1.250000')
    await movement.locator('select').nth(2).selectOption(lotId)
    await movement.getByRole('textbox', { name: 'Reason' }).fill('Damaged seal')
    await movement.getByLabel('Different manager PIN').fill('5678')
    await movement.getByRole('button', { name: 'Approve and record waste' }).click()

    const release = page.getByLabel('Quarantined lot').locator('xpath=ancestor::form')
    await release.locator('select').nth(0).selectOption(quarantineId)
    await release.getByRole('textbox', { name: 'Verified lot code' }).fill('INSPECTED-A')
    await release.getByLabel('I verified the item has no expiry date').check()
    await release.getByRole('textbox', { name: 'Different manager PIN' }).fill('5678')
    await release.getByRole('textbox', { name: 'Inspection result and reason' }).fill('Packaging checked; no expiry label')
    await release.getByRole('button', { name: 'Approve and release inspected lot' }).click()

    await page.waitForFunction(() => window.__commands?.length === 2)
    const commands = await page.evaluate(() => window.__commands)
    const approvals = await page.evaluate(() => window.__approvals)
    assert.deepEqual(commands.map(({ command }) => command), ['stock.lot.waste', 'stock.lot.release'])
    assert.equal(commands[0].payload.expected_version, 2)
    assert.equal(commands[0].payload.lot_id, lotId)
    assert.equal(commands[0].payload.quantity, '1.250000')
    assert.equal(commands[0].payload.approval_id, 'approval-1')
    assert.equal(commands[1].payload.lot_id, quarantineId)
    assert.equal(commands[1].payload.expected_version, 1)
    assert.equal(commands[1].payload.no_expiry_confirmed, true)
    assert.equal(commands[1].payload.approval_id, 'approval-1')
    assert.deepEqual(approvals.map(({ command, pin }) => [command, pin]), [['stock.lot.waste', '5678'], ['stock.lot.release', '5678']])
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
