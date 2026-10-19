import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const v11 = path.join(root, 'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01')
const v12 = path.join(root, 'docs/audits/2026-10-12/bar-v11-continuation/draft-v12-receipt-recovery-01')
const selectedPdf = process.env.BAR_GUIDE_RECEIVING_PDF || path.join(v12, 'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf')
const selectedRanges = process.env.BAR_GUIDE_RECEIVING_TASK_RANGES || path.join(v12, 'task-page-ranges.csv')
const selectedQuickPdf = process.env.BAR_GUIDE_RECEIVING_QUICK_PDF || path.join(v12, 'pdf/Tsa-Bonno-Bar-Quick-Start.pdf')

const sourcePdfReader = [
  'import csv, hashlib, json, sys',
  'from pypdf import PdfReader',
  'pdf_path, ranges_path = sys.argv[1], sys.argv[2]',
  'with open(ranges_path, encoding="utf-8-sig", newline="") as stream:',
  ' row = next(r for r in csv.DictReader(stream) if r["id"] == "BAR-DOC-062")',
  'reader = PdfReader(pdf_path)',
  'start, end = int(row["first_printed_page"]), int(row["last_printed_page"])',
  'print(json.dumps({"sha256": hashlib.sha256(open(pdf_path, "rb").read()).hexdigest().upper(), "page_count": len(reader.pages), "range": row["manual_range"], "start": start, "end": end, "pages": [{"page": n, "text": reader.pages[n-1].extract_text() or ""} for n in range(start, end+1)]}))'
].join('\n')

function readPdfTask(pdfPath = selectedPdf, rangesPath = selectedRanges) {
  const raw = execFileSync('python', ['-c', sourcePdfReader, pdfPath, rangesPath], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(raw)
}

test('v12 applicability, review date and PDF metadata agree in both exact candidate PDFs', () => {
  const contentPath = path.join(v12, 'content/candidate-content.json')
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'))
  assert.equal(content.review_date, '2026-10-13')
  assert.match(content.scope, /inspected on 13 October 2026/)
  assert.doesNotMatch(content.scope, /12 October 2026/)
  assert.match(fs.readFileSync(path.join(v12, 'content/manual-source.md'), 'utf8'), /Applies to the Bar working build inspected on 13 October 2026/)
  assert.match(fs.readFileSync(path.join(v12, 'content/quick-start-source.md'), 'utf8'), /Applies to the Bar working build inspected on 13 October 2026/)
  const inspect = String.raw`import json,sys
from pypdf import PdfReader
out=[]
for p in sys.argv[1:]:
 r=PdfReader(p); text=' '.join((page.extract_text() or '') for page in r.pages); meta=r.metadata
 out.append({'pages':len(r.pages),'title':str(meta.get('/Title','')),'subject':str(meta.get('/Subject','')),'text':text})
print(json.dumps(out))`
  const [manual, quick] = JSON.parse(execFileSync('python', ['-c', inspect, path.join(v12, 'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf'), path.join(v12, 'pdf/Tsa-Bonno-Bar-Quick-Start.pdf')], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(manual.pages, 89)
  assert.equal(quick.pages, 6)
  for (const pdf of [manual, quick]) {
    assert.match(pdf.subject, /reviewed 13 October 2026/i)
    assert.match(pdf.text, /Candidate only/i)
    assert.doesNotMatch(pdf.text, /12 October 2026/)
  }
  assert.match(manual.text, /Applies to the Bar working build inspected on 13 October 2026/)
})

test('BAR-DOC-062 exact manual PDF describes full-order receiving and safe mismatch/uncertain-result handling', () => {
  assert.ok(fs.existsSync(selectedPdf), 'manual candidate PDF missing: ' + selectedPdf)
  assert.ok(fs.existsSync(selectedRanges), 'task range register missing: ' + selectedRanges)
  const result = readPdfTask()
  const text = result.pages.map(page => page.text).join('\n').replace(/\s+/g, ' ')
  assert.match(text, /BAR-DOC-062\s*-\s*Receive and verify a purchase order/i)
  assert.match(text, /no delivered.quantity fields/i)
  assert.match(text, /short, missing, extra, damaged or different/i)
  assert.match(text, /Confirm receipt once/i)
  assert.match(text, /full quantities on the approved purchase order/i)
  assert.match(text, /Reload purchasing data/i)
  assert.match(text, /same order/i)
  assert.match(text, /status is received/i)
  assert.match(text, /read.only movement history/i)
  assert.match(text, /result is unclear/i)
  assert.match(text, /do not create another PO/i)
  assert.match(text, /ask the manager\/provider/i)
  assert.doesNotMatch(text, /enter (?:the )?(?:actual|delivered) quantity/i)
  assert.doesNotMatch(text, /partial delivery.{0,50}(?:enter|choose|select) (?:a )?(?:quantity|amount)/i)
  assert.equal(result.sha256, crypto.createHash('sha256').update(fs.readFileSync(selectedPdf)).digest('hex').toUpperCase())
})

test('Quick Start page 6 exact PDF gives the receiving stop and same-order check', () => {
  assert.ok(fs.existsSync(selectedQuickPdf), 'quick-start candidate PDF missing: ' + selectedQuickPdf)
  const raw = execFileSync('python', ['-c', 'import hashlib,json,sys; from pypdf import PdfReader; p=sys.argv[1]; r=PdfReader(p); print(json.dumps({"sha256":hashlib.sha256(open(p,"rb").read()).hexdigest().upper(),"page_count":len(r.pages),"pages":[x.extract_text() or "" for x in r.pages]}))', selectedQuickPdf], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const result = JSON.parse(raw)
  assert.equal(result.page_count, 6, 'v12 adds one clearly titled recovery page rather than spilling a section')
  const page5 = result.pages[4].replace(/\s+/g, ' ')
  assert.match(page5, /Another till shows a persistent Network note/i)
  assert.match(page5, /A normal replay failure appears/i)
  assert.doesNotMatch(page5, /A stock count, receipt or waste entry is unclear/i)
  const text = result.pages[5].replace(/\s+/g, ' ')
  assert.match(text, /6 - Product and stock recovery/i)
  assert.match(text, /location.only receipt records every approved line quantity/i)
  assert.match(text, /no delivered.quantity fields/i)
  assert.match(text, /For a short, extra, damaged or different delivery, stop/i)
  assert.match(text, /same order/i)
  assert.match(text, /receiving location and item movement history/i)
  assert.match(text, /Do not create another PO/i)
  assert.match(text, /BAR-DOC-062/i)
})

test('actual purchasing UI and current local receiving source contract are traced with a fictional bridge', async () => {
  const componentPath = path.join(root, 'src/renderer/src/components/restaurant/RestaurantPurchasing.jsx')
  const component = fs.readFileSync(componentPath, 'utf8')
  const receiveBlock = component.match(/async function receiveOrder\(orderId, stockLocationId\)[\s\S]*?\n  async function savePurchaseOrderPdf/)
  assert.ok(receiveBlock, 'actual receiveOrder handler must remain discoverable')
  assert.match(receiveBlock[0], /setActionOrderId\(orderId\)/)
  assert.doesNotMatch(receiveBlock[0], /setSaving\(true\)/, 'the current receiving handler has no in-flight disable state')
  assert.match(component, /disabled=\{saving \|\| !receiptLocationId\}[^>]*>[\s\S]*?Confirm receipt/)
  assert.match(component, /Receiving stock location/)
  assert.match(component, /Reload purchasing data/)
  assert.match(component, /Verify receipt/)

  const preload = fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8')
  const ipc = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const domain = fs.readFileSync(path.join(root, 'src/main/domains/pos.js'), 'utf8')
  const domainBlock = domain.match(/export async function receivePurchaseOrder\(orderId, stockLocationId = null\)[\s\S]*?\n\}/)
  assert.ok(domainBlock, 'actual domain function must remain discoverable')
  assert.match(preload, /receivePurchaseOrder:\s*\(orderId, stockLocationId\) => invoke\('pos:receivePurchaseOrder', orderId, stockLocationId\)/)
  assert.match(ipc, /pos:receivePurchaseOrder'[\s\S]{0,220}requireCapability\('pos\.manage'\)[\s\S]{0,120}requireCommercialFeature\('purchasing'\)/)
  assert.match(domainBlock[0], /rpc\('receive_purchase_order'/)
  assert.match(domainBlock[0], /order_id:\s*orderId/)
  assert.match(domainBlock[0], /stock_location_id:\s*stockLocationId \|\| null/)
  assert.doesNotMatch(domainBlock[0], /quantity\s*:/, 'the UI bridge/domain send no delivered quantity')

  const migrationDir = path.join(root, 'supabase/migrations')
  const definitions = fs.readdirSync(migrationDir).sort().flatMap(name => {
    if (!name.endsWith('.sql')) return []
    const contents = fs.readFileSync(path.join(migrationDir, name), 'utf8')
    const matches = [...contents.matchAll(/create\s+or\s+replace\s+function\s+public\.receive_purchase_order\(payload\s+jsonb\)([\s\S]*?)\n\$\$;/gi)]
    return matches.map(match => ({ name, body: match[1] }))
  })
  assert.ok(definitions.length >= 3)
  const latest = definitions.at(-1)
  assert.equal(latest.name, '20260716020000_restaurant_stock_location_receiving_repairs.sql')
  assert.match(latest.body, /app_require_lodge_role\(v_lodge_id,\s*array\['manager',\s*'admin',\s*'super_admin'\]\)/)
  assert.match(latest.body, /restaurant_purchase_orders[\s\S]*?where id = v_order_id and lodge_id = v_lodge_id[\s\S]*?for update/i)
  assert.match(latest.body, /restaurant_stock_locations[\s\S]*?id = v_receiving_location_id and lodge_id = v_lodge_id and is_active/i)
  assert.match(latest.body, /restaurant_purchase_order_items[\s\S]*?poi\.quantity > 0/i)
  assert.match(latest.body, /sum\(poi\.quantity\)/i)
  assert.match(latest.body, /select exists[\s\S]*?im\.reference_type = 'restaurant_purchase_order'[\s\S]*?im\.reference_id = v_order_id[\s\S]*?im\.movement_type = 'purchase_received'/i)
  assert.match(latest.body, /if not v_already then[\s\S]*?update public\.inventory_items[\s\S]*?restaurant_apply_stock_location_balance[\s\S]*?insert into public\.inventory_movements/i)
  assert.match(latest.body, /update public\.restaurant_purchase_orders set status = 'received', stock_location_id = v_receiving_location_id/i)
  assert.match(latest.body, /'duplicate', v_received_count = 0/)
  assert.doesNotMatch(latest.body, /payload->>'quantity'/i)

  const harness = path.join(v12, 'evidence/restaurant-purchasing-behavior-harness.jsx')
  assert.ok(fs.existsSync(harness), 'fictional purchasing UI harness missing')
  const tempRoot = path.join(root, 'tmp')
  const tempDir = path.join(tempRoot, 'bar-guide-v12-receiving-' + process.pid + '-' + crypto.randomUUID())
  const relativeTemp = path.relative(path.resolve(tempRoot), path.resolve(tempDir))
  assert.ok(relativeTemp && !relativeTemp.startsWith('..') && !path.isAbsolute(relativeTemp), 'test scratch must remain under workspace tmp')
  fs.mkdirSync(tempDir, { recursive: true })
  let browser
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(fs.readFileSync(path.join(tempDir, 'bundle.js')))
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
  })
  try {
    await build({ entryPoints: [harness], bundle: true, outfile: path.join(tempDir, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], logLevel: 'warning' })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
    const page = await browser.newPage({ viewport: { width: 1360, height: 960 } })
    page.setDefaultTimeout(7000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port + '/')
    await page.getByRole('heading', { name: 'Purchasing desk', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Receive goods', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Where did these goods arrive?', exact: true })
    await dialog.waitFor({ state: 'visible' })
    assert.equal(await dialog.locator('input').count(), 0, 'the receive dialog has no delivered-quantity input')
    const locationSelect = dialog.locator('select')
    assert.equal(await locationSelect.count(), 1, 'receive dialog should contain only the location select')
    assert.match(await locationSelect.evaluate(select => [...select.labels].map(label => label.textContent).join(' ')), /Receiving stock location/i)
    await locationSelect.selectOption('stock-room-fictional')
    const confirm = dialog.getByRole('button', { name: 'Confirm receipt', exact: true })
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
    await confirm.click()
    await page.waitForFunction(() => window.__barGuideReceivingCalls?.length === 1)
    assert.equal(await confirm.isEnabled(), true, 'the actual receiving dialog leaves Confirm receipt enabled while the promise is pending')
    assert.equal(await cancel.isEnabled(), true, 'the actual receiving dialog leaves Cancel enabled while the promise is pending')
    await cancel.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.__barGuideReceivingCalls.length), 1)
    assert.equal(await page.evaluate(() => window.__barGuideReceivingResolvers.length), 1, 'closing the dialog does not cancel the in-memory RPC promise')
    await page.evaluate(() => window.__barGuideReceivingResolvers[0]({ success: false, error: 'Fictional ambiguous timeout response' }))
    await page.getByText(/Fictional ambiguous timeout response/).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Receive goods', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Where did these goods arrive?', exact: true })
    try {
      await dialog.waitFor({ state: 'visible', timeout: 5000 })
    } catch (error) {
      const diagnostic = {
        body: await page.locator('body').innerText(),
        dialogs: await page.locator('[role=dialog]').evaluateAll(elements => elements.map(element => element.outerHTML)),
        selects: await page.locator('select').evaluateAll(elements => elements.map(element => ({ outerHTML: element.outerHTML, labels: [...element.labels].map(label => label.innerText) }))),
        calls: await page.evaluate(() => window.__barGuideReceivingCalls),
        resolvers: await page.evaluate(() => window.__barGuideReceivingResolvers.length),
        pageErrors
      }
      throw new Error('Second receive dialog did not reopen: ' + JSON.stringify(diagnostic) + '; ' + error.message)
    }
    const retrySelect = dialog.locator('select')
    assert.equal(await retrySelect.count(), 1, 'second receive dialog should contain only the location select')
    await retrySelect.selectOption('stock-room-fictional')
    await dialog.getByRole('button', { name: 'Confirm receipt', exact: true }).click()
    await page.waitForFunction(() => window.__barGuideReceivingCalls?.length === 2)
    const calls = await page.evaluate(() => window.__barGuideReceivingCalls)
    assert.deepEqual(calls, [
      { orderId: 'PO-FICTIONAL-062', stockLocationId: 'stock-room-fictional' },
      { orderId: 'PO-FICTIONAL-062', stockLocationId: 'stock-room-fictional' },
    ], 'only the same fictional order and location are resent')
    await page.evaluate(() => window.__barGuideReceivingResolvers.slice(1).forEach(resolve => resolve({ success: false, error: 'Fictional stop after second attempt' })))
    await page.getByText(/Fictional stop after second attempt/).waitFor({ state: 'visible' })
    assert.deepEqual(pageErrors, [], 'fictional component fixture should have no page errors')
    await page.close()
  } finally {
    if (browser) await browser.close()
    if (server.listening) await new Promise(resolve => server.close(resolve))
    const resolvedRoot = path.resolve(tempRoot)
    const resolvedTemp = path.resolve(tempDir)
    const relative = path.relative(resolvedRoot, resolvedTemp)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolvedTemp).startsWith('bar-guide-v12-receiving-' + process.pid + '-')) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true })
    }
  }
})