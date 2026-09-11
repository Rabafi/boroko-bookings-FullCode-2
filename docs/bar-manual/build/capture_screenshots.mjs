import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'

const dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dir, '..', '..', '..')
const outDir = path.join(root, 'docs', 'bar-manual', 'assets', 'screenshots', 'raw')
mkdirSync(outDir, { recursive: true })
const bundle = path.join(dir, 'capture-harness.bundle.js')
const css = path.join(dir, 'capture-harness.bundle.css')
await build({ entryPoints: [path.join(dir, 'capture-harness.jsx')], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
const server = createServer((req, res) => {
  if (req.url.startsWith('/capture-harness.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(bundle)); return }
  if (req.url.startsWith('/capture-harness.bundle.css') && existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(readFileSync(css)); return }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/capture-harness.bundle.css"></head><body><div id="root"></div><script src="/capture-harness.bundle.js"></script></body></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
async function open(page, url, readyText) {
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => console.log('PAGEERROR', url, error.stack || error.message))
  page.on('console', (message) => { if (message.type() === 'error') console.log('BROWSER-ERROR', url, message.text()) })
  await page.goto(`${base}/${url}`)
  await page.evaluate(() => document.fonts?.ready)
  await page.getByText(readyText, { exact: false }).first().waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.fonts?.status === 'loaded' && !document.body.innerText.includes('Loading…'))
  const bad = await page.evaluate(() => /Loading failed|could not be loaded|No items found/.test(document.body.innerText))
  if (bad) throw new Error(`Capture validation failed for ${url}`)
}
async function closeUnlockIfPresent(page) {
  const backdrop = page.locator('.hpos-till-unlock-backdrop')
  await backdrop.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  const dialog = page.locator('.hpos-till-unlock')
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Mpho K\./ }).click()
    for (const digit of ['1','2','3','4']) await dialog.getByRole('button', { name: digit, exact: true }).click()
    await dialog.getByRole('button', { name: 'Unlock Till' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 3000 })
    await backdrop.waitFor({ state: 'hidden', timeout: 3000 })
  }
}
async function save(context, file) {
  const page = await context.newPage()
  await page.screenshot({ path: path.join(outDir, file), fullPage: true })
  await context.close()
}
async function cropPng(file, top, height, width = null) {
  const metadata = await sharp(file).metadata()
  const cropTop = Math.max(0, Math.min(top, (metadata.height || 1) - 1))
  const cropHeight = Math.max(1, Math.min(height, (metadata.height || 1) - cropTop))
  const cropped = file.replace(/\.png$/, '-crop.png')
  await sharp(file).extract({ left: 0, top: cropTop, width: Math.min(width || metadata.width, metadata.width), height: cropHeight }).png().toFile(cropped)
  rmSync(file)
  renameSync(cropped, file)
}
async function cropStockCountTask(file) {
  const metadata = await sharp(file).metadata()
  const width = metadata.width || 568
  const height = metadata.height || 476
  const topHeight = Math.min(330, height)
  const bottomTop = Math.min(398, Math.max(topHeight, height - 1))
  const bottomHeight = Math.max(1, height - bottomTop)
  const gap = 16
  const top = await sharp(file).extract({ left: 0, top: 0, width, height: topHeight }).png().toBuffer()
  const bottom = await sharp(file).extract({ left: 0, top: bottomTop, width, height: bottomHeight }).png().toBuffer()
  const focused = file.replace(/\.png$/, '-focused.png')
  await sharp({
    create: {
      width,
      height: topHeight + gap + bottomHeight,
      channels: 3,
      background: { r: 255, g: 248, b: 239 }
    }
  }).composite([
    { input: top, top: 0, left: 0 },
    { input: bottom, top: topHeight + gap, left: 0 }
  ]).png().toFile(focused)
  rmSync(file)
  renameSync(focused, file)
}

let context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
let page = await context.newPage()
await open(page, '?page=sell', 'Sell')
await closeUnlockIfPresent(page)
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => /River Lager/.test(button.textContent || '') && !button.disabled))
await page.getByRole('button', { name: /River Lager/ }).first().click()
await page.getByRole('button', { name: /Classic Gin & Tonic/ }).first().click()
await page.getByRole('button', { name: /River Lager/ }).first().click()
await page.getByText('P 111.00', { exact: false }).first().waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '01-bar-workspace-sell.png'), fullPage: true })
await page.getByRole('button', { name: 'Cash', exact: true }).click()
await page.getByText('Collect Cash', { exact: false }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '09-payment-panel.png'), fullPage: true })
await page.getByRole('button', { name: 'Take payment', exact: true }).click()
const receiptHeading = page.getByRole('heading', { name: 'POS Receipt', exact: true })
await receiptHeading.waitFor({ state: 'visible' })
await page.getByText('Receipt No', { exact: true }).waitFor({ state: 'visible' })
await page.getByRole('button', { name: 'Print receipt', exact: true }).waitFor({ state: 'visible' })
const receiptDialog = receiptHeading.locator('xpath=../../..')
await receiptDialog.scrollIntoViewIfNeeded()
const receiptPath = path.join(outDir, '17-completed-receipt.png')
await receiptDialog.screenshot({ path: receiptPath })
await cropPng(receiptPath, 0, 999, 560)
await context.close()

const simple = [
  ['02-products-catalogue.png', 'products', 'Products'],
  ['03-service-stock.png', 'stock', 'Service stock'],
  ['04-cash-and-close.png', 'cash', 'Cash & close'],
  ['05-open-tabs.png', 'tabs', 'Open tabs'],
  ['06-manage-workspace.png', 'manage', 'Run the bar'],
  ['10-sales-report.png', 'reports', 'Bar sales & control report'],
  ['11-customers-loyalty.png', 'customers', 'Customers & loyalty'],
  ['12-expense-register.png', 'expenses', 'Expense register'],
]
for (const [file, pageName, ready] of simple) {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page = await context.newPage()
  await open(page, `?page=${pageName}`, ready)
  if (pageName === 'stock') await page.getByRole('row', { name: /River Lager 330ml/ }).waitFor({ state: 'visible' })
  if (pageName === 'reports') await page.getByText('R-2026-0018', { exact: false }).first().waitFor({ state: 'visible' })
  if (pageName === 'customers') await page.getByText('Naledi M.', { exact: false }).first().waitFor({ state: 'visible' })
  if (pageName === 'expenses') await page.getByText('Ice delivery', { exact: false }).first().waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outDir, file), fullPage: true })
  await context.close()
}

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=shift&mode=start-shift', 'Start your shift')
await page.getByText('Opening cash float', { exact: false }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '07-opening-shift.png'), fullPage: true })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=unlock&mode=unlock', 'Unlock Till')
await page.getByRole('button', { name: 'Unlock Till', exact: true }).click()
await page.getByRole('dialog', { name: /Who is taking this order/ }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '08-till-unlock.png'), fullPage: true })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=tabs', 'Open tabs')
await page.getByRole('button', { name: 'Split' }).first().click()
await page.getByRole('dialog', { name: /Split Thabo evenly/ }).waitFor({ state: 'visible' })
const splitPath = path.join(outDir, '13-split-dialog.png')
await page.getByRole('dialog', { name: /Split Thabo evenly/ }).screenshot({ path: splitPath })
await cropPng(splitPath, 142, 255)
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=tabs', 'Open tabs')
await page.getByRole('button', { name: 'Transfer waiter' }).first().click()
await page.getByRole('dialog', { name: 'Transfer waiter' }).waitFor({ state: 'visible' })
await page.getByRole('dialog', { name: 'Transfer waiter' }).screenshot({ path: path.join(outDir, '14-transfer-waiter.png') })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=my-sales', 'My sales')
await page.getByRole('button', { name: /R-2026-0018/ }).click()
await page.getByRole('dialog', { name: /My sale receipt details/ }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '18-sale-detail-reprint.png'), fullPage: true })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=sale-correction', 'Request a sale correction')
await page.getByRole('button', { name: /Open receipt R-2026-0018/ }).click()
await page.getByText('Request supervisor correction', { exact: true }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '19-sale-correction-request.png'), fullPage: true })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=products', 'Products')
await page.getByRole('button', { name: /Edit River Lager/ }).click()
await page.getByRole('dialog', { name: /Edit River Lager/ }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '20-product-edit.png'), fullPage: true })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=stock', 'Service stock')
await page.getByRole('button', { name: 'Count All', exact: true }).click()
const countAllDialog = page.getByRole('dialog', { name: 'Review Count All', exact: true })
await countAllDialog.waitFor({ state: 'visible' })
const countAllPath = path.join(outDir, '26-count-all.png')
await countAllDialog.screenshot({ path: countAllPath })
await cropPng(countAllPath, 150, 420)
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=stock', 'Service stock')
await page.getByRole('button', { name: 'Receive delivery', exact: true }).click()
await page.getByRole('dialog', { name: /Receive a multi-line delivery/ }).waitFor({ state: 'visible' })
await page.getByLabel('Select item from current stock list').selectOption('stock-1')
await page.getByRole('dialog', { name: /Receive a multi-line delivery/ }).screenshot({ path: path.join(outDir, '21-stock-delivery.png') })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=stock', 'Service stock')
const stockRow = page.getByRole('row', { name: /River Lager 330ml/ })
await stockRow.getByRole('button', { name: 'Count', exact: true }).click()
await page.getByRole('dialog', { name: /Count River Lager 330ml/ }).waitFor({ state: 'visible' })
const countPath = path.join(outDir, '22-stock-count.png')
await page.getByRole('dialog', { name: /Count River Lager 330ml/ }).screenshot({ path: countPath })
await cropStockCountTask(countPath)
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=my-cashup', 'My cash-up')
await page.getByText('Physical cash counted', { exact: false }).waitFor({ state: 'visible' })
await page.locator('.hpos-my-cashup-card').screenshot({ path: path.join(outDir, '23-operator-cashup.png') })
await context.close()

context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page = await context.newPage()
await open(page, '?page=cash', 'Cash & close')
await page.getByText(/cash-up awaiting a decision/).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '24-manager-cashup-review.png'), fullPage: true })
await page.getByRole('button', { name: 'Approve & close shift', exact: true }).click()
await page.getByText('Approve and close shift', { exact: true }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(outDir, '25-manager-cashup-approval.png'), fullPage: true })
await context.close()
await browser.close()
await new Promise((resolve) => server.close(resolve))
console.log('Captured validated, populated Bar screens with real components')
