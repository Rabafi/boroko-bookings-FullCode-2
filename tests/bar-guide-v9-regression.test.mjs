import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { test, before, after } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const root = process.cwd()
const sourceCandidate = path.join(root, 'docs/bar-manual/build/remediation-candidate-2026-10-09-v9')
const temp = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v9-regressions-'))
const suppliedCandidate = process.env.BAR_GUIDE_V9_CANDIDATE_DIR
const candidate = path.resolve(suppliedCandidate || path.join(temp, 'frozen-v9-copy'))
if (candidate === path.resolve(sourceCandidate)) throw new Error('Refusing to let this test write into frozen candidate v9.')
if (!suppliedCandidate) fs.cpSync(sourceCandidate, candidate, { recursive: true, errorOnExist: true })
process.env.BAR_GUIDE_V9_CANDIDATE_DIR = candidate
for (const [rel, replacement] of [
  ['evidence/build_ui_control_census_v9.cjs', 'const CAND=path.resolve(process.env.BAR_GUIDE_V9_CANDIDATE_DIR || path.join(ROOT,"docs/bar-manual/build/remediation-candidate-2026-10-09-v9"));'],
  ['evidence/build_global_event_census_v9.cjs', "const CAND=path.resolve(process.env.BAR_GUIDE_V9_CANDIDATE_DIR || path.join(ROOT,'docs/bar-manual/build/remediation-candidate-2026-10-09-v9'))"],
  ['evidence/build_action_inventory_v9.py', "CAND=Path(os.environ.get('BAR_GUIDE_V9_CANDIDATE_DIR', str(ROOT/'docs/bar-manual/build/remediation-candidate-2026-10-09-v9')))"]
]) {
  const target = path.join(candidate, rel)
  if (!fs.existsSync(target)) continue
  const rows = fs.readFileSync(target, 'utf8').split(/\r?\n/)
  const at = rows.findIndex((line) => /^const CAND\s*=/.test(line) || /^CAND=ROOT\//.test(line))
  if (at < 0) throw new Error(`Census builder has no recognized candidate output root: ${rel}`)
  rows[at] = replacement
  if (rel.endsWith('.py') && !rows.some((line) => /^import os\b/.test(line))) rows.splice(1, 0, 'import os')
  fs.writeFileSync(target, rows.join('\n'), 'utf8')
}
// Disclosed relocation in the disposable census copy only. A further source
// change fails this pin and requires another handler review, not a count change.
const reviewedTillHash = 'DFBFA30961F09C600DB443769C160F84E45DA8ED1BEC9B8580B2664B46CA7B3D'
const tillBytes = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposTerminal.jsx'))
assert.equal(crypto.createHash('sha256').update(tillBytes).digest('hex').toUpperCase(), reviewedTillHash,
  'Till source changed after the 2026-10-12 listener review; review handlers before relocating census mappings.')
const clonedEventBuilder = path.join(candidate, 'evidence/build_global_event_census_v9.cjs')
let clonedEvents = fs.readFileSync(clonedEventBuilder, 'utf8')
for (const [oldLine, currentLine, event, callback] of [
  [1858, 1859, 'visibilitychange', 'handleVisible'],
  [1901, 1902, 'visibilitychange', 'handleVisible'],
  [2639, 2640, 'keydown', 'onKeyDown'],
  [3433, 3434, 'keydown', 'handler'],
  [3481, 3482, 'pointerdown', 'onPointerDown'],
  [3524, 3525, 'keydown', 'trapTab'],
]) {
  const line = tillBytes.toString('utf8').split(/\r?\n/)[currentLine - 1]
  assert.match(line, new RegExp(`addEventListener\\(["']${event}["'], ${callback}`))
  const priorAnchor = `HposTerminal.jsx:${oldLine}'`
  const currentAnchor = `HposTerminal.jsx:${currentLine}'`
  if (clonedEvents.includes(priorAnchor)) {
    assert.equal(clonedEvents.split(priorAnchor).length - 1, 1)
    clonedEvents = clonedEvents.replace(priorAnchor, currentAnchor)
  } else assert.equal(clonedEvents.split(currentAnchor).length - 1, 1)
}
fs.writeFileSync(clonedEventBuilder, clonedEvents, 'utf8')
const prior = path.join(root, 'docs/bar-manual/build/remediation-candidate-2026-10-08-v8-review2')
const harness = path.join(sourceCandidate, 'evidence/guide-component-harness.jsx')
const boardHarness = path.join(sourceCandidate, 'evidence/bar-board-component-harness-v9.jsx')
const verifier = path.join(candidate, 'evidence/verify_v9_candidate.py')
const bundle = path.join(temp, 'guide-component.js')
const boardBundle = path.join(temp, 'bar-board-component.js')
const cssFile = path.join(temp, 'guide-component.css')
const testEvidence = path.join(candidate, 'evidence/test-red-green')
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
let server, browser, base
const pageErrors = []

before(async () => {
  fs.mkdirSync(testEvidence, { recursive: true })
  await build({
    entryPoints: [harness], bundle: true, outfile: bundle, jsx: 'automatic',
    nodePaths: [path.join(root, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
  })
  await build({
    entryPoints: [boardHarness], bundle: true, outfile: boardBundle, jsx: 'automatic',
    nodePaths: [path.join(root, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
  })
  const stylePaths = ['src/renderer/src/index.css', 'src/renderer/src/styles/hospitality-pos.css']
  const styleText = stylePaths.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
  const compiled = await postcss([tailwind({ config: path.join(root, 'tailwind.config.js') }), autoprefixer()])
    .process(styleText, { from: path.join(root, stylePaths[0]) })
  fs.writeFileSync(cssFile, compiled.css, 'utf8')
  server = createServer((req, res) => {
    if (req.url.startsWith('/guide-component.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(bundle)); return }
    if (req.url.startsWith('/bar-board-component.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(boardBundle)); return }
    if (req.url.startsWith('/guide-component.css')) { res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(cssFile)); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url.startsWith('/bar-board')) { res.end('<!doctype html><html data-product="hospitality-pos"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide-component.css"></head><body><div id="root"></div><script src="/bar-board-component.js"></script></body></html>'); return }
    res.end('<!doctype html><html data-product="hospitality-pos"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide-component.css"></head><body><div id="root"></div><script src="/guide-component.js"></script></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  const launch = { headless: true }
  const executablePath = String(process.env.LUNA_CHROMIUM_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe').trim()
  if (executablePath) launch.executablePath = executablePath
  browser = await chromium.launch(launch)
})
after(async () => {
  if (browser) await browser.close()
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  fs.rmSync(temp, { recursive: true, force: true })
})

async function openPage(query) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort())
  await page.goto(`${base}/?${query}`)
  return { context, page }
}
const bridgeCalls = (page) => page.evaluate(() => window.__BAR_GUIDE_CALLS__)
async function openBoardPage(query) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort())
  await page.goto(base + '/bar-board?' + query)
  return { context, page }
}
async function selectReceipt(page) {
  await page.getByRole('button', { name: 'Open receipt FIC-R-00037', exact: true }).click()
  await page.getByRole('dialog', { name: 'Receipt and reversal details' }).waitFor({ state: 'visible' })
}
async function fillVoidForm(page, { stock = 'return_to_stock', reason = 'Fictional correction reason' } = {}) {
  await page.getByLabel('Authorised approver PIN', { exact: true }).fill('2468')
  await page.getByLabel('Reason and detail', { exact: true }).fill(reason)
  const stockSelect = page.locator('label').filter({ hasText: 'Packaged stock outcome' }).locator('select')
  if (await stockSelect.count()) await stockSelect.selectOption(stock)
}

// Actual HposReports component; the injected bridge is fictional, in-memory and blocks external requests.
test('actual HposReports own-sale correction uses the selected receipt, real labels, stock choice, and Cancel safely', async () => {
  const { context, page } = await openPage('screen=correction&mode=own&scenario=success')
  try {
    await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
    await selectReceipt(page)
    const dialog = page.getByRole('dialog', { name: 'Receipt and reversal details' })
    await dialog.getByRole('heading', { name: 'Request supervisor correction', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).count(), 1)
    assert.equal(await page.getByLabel('Reason template', { exact: true }).count(), 0, 'own-sale correction mode does not load the report-only template')
    assert.equal(await page.locator('label').filter({ hasText: 'Packaged stock outcome' }).locator('select').count(), 1)
    assert.equal(await page.getByRole('option', { name: 'Returned unopened — restore packaged stock', exact: true }).count(), 1)
    assert.equal(await page.getByRole('option', { name: 'Broken, opened or damaged — keep stock depleted', exact: true }).count(), 1)
    await fillVoidForm(page, { stock: 'consumed_or_damaged' })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await bridgeCalls(page).then((calls) => calls.filter((call) => call.name === 'approveVoidWithPin').length), 0, 'Cancel must not call the void bridge')
    assert.equal(await page.getByRole('dialog', { name: 'Receipt and reversal details' }).count(), 0)
    await selectReceipt(page)
    await fillVoidForm(page, { stock: 'consumed_or_damaged' })
    await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).click()
    await page.getByText('Sale voided. The receipt and stock history have been updated.', { exact: true }).waitFor({ state: 'visible' })
    const submit = (await bridgeCalls(page)).find((call) => call.name === 'approveVoidWithPin')
    assert.ok(submit)
    assert.equal(submit.payload.order_id, 'fictional-order-v9-037')
    assert.equal(submit.payload.pin, '2468')
    assert.equal(submit.payload.reason, 'Fictional correction reason')
    assert.equal(submit.payload.direct_stock_disposition, 'consumed_or_damaged')
    assert.equal(submit.payload.outlet_id, 'fictional-outlet-v9')
    assert.equal(pageErrors.length, 0)
  } finally { await context.close() }
})

test('actual HposReports normal Sales report has its separate gate, optional template, direct stock outcome, and pending replay notice', async () => {
  {
    const { context, page } = await openPage('screen=correction&mode=report&scenario=success')
    try {
      await page.getByRole('heading', { name: 'Bar sales & control report', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      await page.getByRole('heading', { name: 'Void this sale', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Authorise void', exact: true }).count(), 1)
      const templateSelect = page.locator('label').filter({ hasText: 'Reason template' }).locator('select')
      await templateSelect.waitFor({ state: 'visible' })
      const templateCalls = await bridgeCalls(page)
      const templateLabels = await page.locator('label').allTextContents()
      assert.ok(templateCalls.some((call) => call.name === 'getVoidReasonTemplates'), JSON.stringify({ templateCalls, templateLabels }))
      assert.equal(await templateSelect.count(), 1, JSON.stringify({ templateCalls, templateLabels }))
      await templateSelect.selectOption('wrong_item')
      assert.equal(await page.getByLabel('Reason and detail', { exact: true }).inputValue(), 'Wrong item: ')
      await page.getByLabel('Reason and detail', { exact: true }).fill('Wrong item: fictional duplicate line')
      await page.locator('label').filter({ hasText: 'Packaged stock outcome' }).locator('select').selectOption('return_to_stock')
      await page.getByLabel('Authorised approver PIN', { exact: true }).fill('2468')
      await page.getByRole('button', { name: 'Authorise void', exact: true }).click()
      await page.waitForTimeout(300)
      const reportBody = await page.locator('body').innerText()
      const reportCalls = await bridgeCalls(page)
      assert.ok(reportBody.includes('Sale voided. The receipt and stock history have been updated.'), JSON.stringify({ body: reportBody.slice(-1800), reportCalls }))
      const submit = reportCalls.find((call) => call.name === 'approveVoidWithPin')
      assert.equal(submit.payload.order_id, 'fictional-order-v9-037')
      assert.equal(submit.payload.reason, 'Wrong item: fictional duplicate line')
      assert.equal(submit.payload.direct_stock_disposition, 'return_to_stock')
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=correction&mode=own&scenario=pending')
    try {
      await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      await page.getByText(/has not synced yet: the correction queues behind it and applies on the server in order/i).waitFor({ state: 'visible' })
      await fillVoidForm(page)
      await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).click()
      await page.getByText('Void approval is pending server confirmation.', { exact: true }).waitFor({ state: 'visible' })
      const submit = (await bridgeCalls(page)).find((call) => call.name === 'approveVoidWithPin')
      assert.equal(submit.payload.order_id, 'fictional-order-v9-037')
      assert.equal(submit.payload.direct_stock_disposition, 'return_to_stock')
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'approveVoidWithPin').length, 1, 'the provisional submit remains one original action')
    } finally { await context.close() }
  }
})

test('actual correction form requires PIN and reason, and only offers packaged-stock choice for direct stock', async () => {
  {
    const { context, page } = await openPage('screen=correction&mode=own&scenario=recipe')
    try {
      await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      assert.equal(await page.locator('label').filter({ hasText: 'Packaged stock outcome' }).locator('select').count(), 0)
      await page.getByText(/Food, cocktails and recipe items remain consumed/i).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).click()
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'approveVoidWithPin').length, 0, 'browser required-field validation prevents submission without PIN and reason')
      assert.equal(await page.getByLabel('Authorised approver PIN', { exact: true }).getAttribute('required'), '')
      assert.equal(await page.getByLabel('Reason and detail', { exact: true }).getAttribute('required'), '')
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=correction&mode=own&scenario=mixed')
    try {
      await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      assert.equal(await page.locator('label').filter({ hasText: 'Packaged stock outcome' }).locator('select').count(), 1, 'a mixed sale exposes the packaged-stock choice for its direct-stock line')
      await page.getByText(/Food, cocktails and recipe items remain consumed/i).waitFor({ state: 'visible' })
    } finally { await context.close() }
  }
})

test('actual HposReports preserves refusal and warns against submitting a settled-sale void', async () => {
  {
    const { context, page } = await openPage('screen=correction&mode=own&scenario=refused')
    try {
      await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      await fillVoidForm(page)
      await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).click()
      await page.getByText('Fictional refused void', { exact: true }).waitFor({ state: 'visible' })
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'approveVoidWithPin').length, 1, 'a refused result remains one selected original attempt')
      assert.equal(await page.getByRole('dialog', { name: 'Receipt and reversal details' }).count(), 1, 'refusal preserves selected receipt context')
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=correction&mode=own&scenario=settled')
    try {
      await page.getByRole('heading', { name: 'Request a sale correction', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      await page.getByText(/This receipt is settled\. Use the protected return workflow in Till/i).waitFor({ state: 'visible' })
      assert.equal(await page.getByRole('heading', { name: 'Request supervisor correction', exact: true }).count(), 0, 'settled receipts do not render the own-sale void form')
      assert.equal(await page.getByRole('heading', { name: 'Void this sale', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Authorise void', exact: true }).count(), 0)
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'approveVoidWithPin').length, 0, 'settled sale cannot reach the void bridge')
    } finally { await context.close() }
  }
})

test('shared PIN-verified My sales hides the void form and the POS-view permission gates the actual selected-receipt form', async () => {
  {
    const { context, page } = await openPage('screen=correction&mode=shared&scenario=success')
    try {
      await page.getByRole('heading', { name: 'My Till sales', exact: true }).waitFor({ state: 'visible' })
      const period = page.locator('input[type="date"]')
      await period.nth(0).fill('2026-10-09')
      await period.nth(1).fill('2026-10-09')
      await selectReceipt(page)
      assert.equal(await page.getByRole('heading', { name: 'Void this sale', exact: true }).count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Request supervisor correction', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Ask approver to confirm', exact: true }).count(), 0)
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'approveVoidWithPin').length, 0)
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=correction&mode=report&scenario=success&void=off')
    try {
      await page.getByRole('heading', { name: 'Bar sales & control report', exact: true }).waitFor({ state: 'visible' })
      await selectReceipt(page)
      assert.equal(await page.getByRole('heading', { name: 'Void this sale', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Authorise void', exact: true }).count(), 0)
    } finally { await context.close() }
  }
})

test('actual PrepDisplay Bar board advances the same ticket and leaves payment untouched', async () => {
  {
    const { context, page } = await openBoardPage('scenario=success')
    try {
      await page.getByRole('heading', { name: 'Bar board', exact: true }).waitFor({ state: 'visible' })
      const ticket = page.locator('article').filter({ hasText: 'Fictional Table 4' })
      await page.getByText('Fictional tonic', { exact: true }).waitFor({ state: 'visible' })
      assert.equal(await ticket.getByRole('button', { name: 'Preparing', exact: true }).count(), 1)
      await ticket.getByRole('button', { name: 'Preparing', exact: true }).click()
      await page.getByText('preparing', { exact: true }).waitFor({ state: 'visible' })
      await ticket.getByRole('button', { name: 'Ready', exact: true }).click()
      await page.getByText('ready', { exact: true }).waitFor({ state: 'visible' })
      await ticket.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('heading', { name: 'No open tickets', exact: true }).waitFor({ state: 'visible' })
      const calls = await page.evaluate(() => window.__BAR_BOARD_CALLS__)
      const updates = calls.filter((call) => call.name === 'updateTicketStatus')
      assert.deepEqual(updates.map(({ id, status }) => [id, status]), [
        ['fictional-bar-ticket-v9-128', 'preparing'],
        ['fictional-bar-ticket-v9-128', 'ready'],
        ['fictional-bar-ticket-v9-128', 'served'],
      ])
      assert.ok(calls.filter((call) => call.name === 'getTickets').every((call) => call.filters.station === 'bar' && call.filters.status === 'active'))
      assert.deepEqual(calls.map((call) => call.name).filter((name) => !['getTickets', 'updateTicketStatus'].includes(name)), [], 'the board bridge invokes no sale, payment, void or inventory API')
      assert.equal(pageErrors.length, 0)
    } finally { await context.close() }
  }
  {
    const { context, page } = await openBoardPage('scenario=offline')
    try {
      await page.getByRole('heading', { name: 'Bar board', exact: true }).waitFor({ state: 'visible' })
      const ticket = page.locator('article').filter({ hasText: 'Fictional Table 4' })
      await ticket.getByRole('button', { name: 'Preparing', exact: true }).click()
      await page.getByText('new', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.getByText('Fictional tonic', { exact: true }).waitFor({ state: 'visible' })
      await page.getByText('new', { exact: true }).waitFor({ state: 'visible' })
      const calls = await page.evaluate(() => window.__BAR_BOARD_CALLS__)
      assert.deepEqual(calls.filter((call) => call.name === 'updateTicketStatus').map((call) => call.status), ['preparing'])
      assert.ok(calls.filter((call) => call.name === 'getTickets').length >= 2, 'refresh re-reads the same active Bar station')
      assert.deepEqual(calls.map((call) => call.name).filter((name) => !['getTickets', 'updateTicketStatus'].includes(name)), [])
    } finally { await context.close() }
  }
})

test('actual HposSystemHealth keeps pending, ordinary failed, peer-warning, and unconfirmed-void states distinct', async () => {
  const { context, page } = await openPage('screen=health&scenario=cancel&role=manager')
  try {
    await page.getByRole('heading', { name: 'System health', exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Waiting for confirmation', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Failed operations', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Discard', exact: true }).count(), 1)
    assert.equal(await page.getByText('Network note', { exact: true }).count(), 0, 'fixture does not mislabel an ordinary failure as a mesh identity warning')
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'discardLocalVoidRecord').length, 0, 'Cancel from the confirmation preserves the record without IPC')
    await page.getByText('Fictional duplicate entry', { exact: true }).waitFor({ state: 'visible' })
  } finally { await context.close() }
  {
    const { context, page } = await openPage('screen=health&scenario=cancel&role=cashier')
    try {
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
      assert.equal(await page.getByRole('button', { name: 'Discard', exact: true }).count(), 0, 'sync.manage controls the Discard affordance')
    } finally { await context.close() }
  }
})

test('actual HposSystemHealth preserves queue-backed, offline and server-error records and resolves confirmed state', async () => {
  for (const scenario of ['queue-backed', 'offline', 'server-error']) {
    const { context, page } = await openPage(`screen=health&scenario=${scenario}&role=manager`)
    try {
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByRole('alert').waitFor({ state: 'visible' })
      await page.getByText('Fictional duplicate entry', { exact: true }).waitFor({ state: 'visible' })
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'discardLocalVoidRecord').length, 1)
      if (scenario === 'queue-backed') {
        await page.getByText(/Retry or Clear it in System Health instead of discarding/i).waitFor({ state: 'visible' })
        assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 1)
        assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 1)
      }
      if (scenario === 'offline') await page.getByText(/Reconnect before discarding/i).waitFor({ state: 'visible' })
      if (scenario === 'server-error') await page.getByText(/server void check failed/i).waitFor({ state: 'visible' })
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=health&scenario=confirmed&role=manager')
    try {
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByText(/server already recorded that void — marked confirmed/i).waitFor({ state: 'visible' })
      assert.equal(await page.getByText('Void records awaiting confirmation', { exact: true }).count(), 0, 'confirmed void leaves the unconfirmed list after refresh')
    } finally { await context.close() }
  }
  {
    const { context, page } = await openPage('screen=health&scenario=order-stands&role=manager')
    try {
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByText(/void record discarded \(order_stands\)/i).waitFor({ state: 'visible' })
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'discardLocalVoidRecord').length, 1)
    } finally { await context.close() }
  }
  for (const [scenario, outcome] of [['orphan', 'orphan'], ['superseded', 'superseded']]) {
    const { context, page } = await openPage(`screen=health&scenario=${scenario}&role=manager`)
    try {
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByText(new RegExp(`void record discarded.*${outcome}`, 'i')).waitFor({ state: 'visible' })
      await page.getByText('Void records awaiting confirmation', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal((await bridgeCalls(page)).filter((call) => call.name === 'discardLocalVoidRecord').length, 1)
    } finally { await context.close() }
  }
  assert.equal(pageErrors.length, 0)
})

test('source-derived Bar action census re-enumerates routes, JSX controls and global events with explicit limits', () => {
  const actionBuilder = path.join(candidate, 'evidence/build_action_inventory_v9.py')
  const uiBuilder = path.join(candidate, 'evidence/build_ui_control_census_v9.cjs')
  const eventBuilder = path.join(candidate, 'evidence/build_global_event_census_v9.cjs')
  const actionRun = spawnSync('python', [actionBuilder], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(actionRun.status, 0, actionRun.stdout + '\n' + actionRun.stderr)
  const uiRun = spawnSync('node', [uiBuilder], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(uiRun.status, 0, uiRun.stdout + '\n' + uiRun.stderr)
  const eventRun = spawnSync('node', [eventBuilder], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(eventRun.status, 0, eventRun.stdout + '\n' + eventRun.stderr)
  const auditSource = String.raw`
import csv,json,hashlib,sys
from pathlib import Path
c=Path(sys.argv[1]); ev=c/'evidence'
def rows(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
s=json.loads((ev/'action-inventory-summary-v9.json').read_text(encoding='utf-8'))
ui=rows(c/'ui-control-census-v9.csv'); events=rows(c/'global-event-census-v9.csv'); inv=rows(c/'customer-action-inventory.csv')
assert s['route_declaration_rows']==90 and s['unique_route_declarations']==61 and not s['route_rows_unresolved'],s
frozen=json.loads((Path.cwd()/'docs/bar-manual/build/remediation-candidate-2026-10-09-v9/evidence/action-inventory-summary-v9.json').read_text(encoding='utf-8'))
expected_files={r['source_file'] for r in frozen['source_files']} | {'src/renderer/src/components/restaurant-accounting/trialBalanceResponse.js'}
assert {r['source_file'] for r in s['source_files']}==expected_files,'Unexpected added/omitted module; review current discovery before updating baseline'
assert s['reachable_component_file_count']==len(expected_files)==84 and s['source_ui_control_declarations']==1515
helper=next(r for r in s['source_files'] if r['source_file'].endswith('/trialBalanceResponse.js'))
assert helper['controls']==0 and helper['sha256']=='1770FC6040249319280BCB0E894F4158885DEC7BB616DC72237149861D980B6E','Trial-balance helper drift requires fresh semantic review'
assert s['source_control_rows_explicitly_unverified']==1466 and s['source_control_rows_source_excluded']==49,s
assert len(ui)==1515 and all(r['source_file'] and r['source_sha256'] for r in ui)
for r in ui:
 p=Path.cwd()/r['source_file']
 assert p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest().upper()==r['source_sha256'],r['action_id']
assert sum(r['mapping_status'].startswith('unverified action semantics; route-linked') for r in ui)==1466
assert sum(r['mapping_status']=='source-backed Bar route exclusion; current declarations are blocked or out of scope' for r in ui)==49
assert len(events)==34 and s['global_event_listener_declarations']==34
assert s['global_event_listener_rows_unverified']==2
assert {r['mapping_status'] for r in events}=={'reviewed_task_mapping','reviewed_internal_ui_behavior','source_backed_route_exclusion','unverified_shared_dialog_caller_effect'}
assert sum(r['mapping_status']=='unverified_shared_dialog_caller_effect' for r in events)==2
assert not any(r['mapping_status']=='unreviewed_source_action' for r in events)
assert s['total_action_inventory_rows']==len(inv)
ids={r['action_id'] for r in inv}
assert {'UNVERIFIED-SEMANTIC-CONTROL-MAP','UNVERIFIED-DYNAMIC-DOM-ACTIONS','UNVERIFIED-ROLE-STATE'} <= ids
out={'route_rows':90,'unique_routes':61,'reachable_component_files':84,'jsx_controls':1515,'explicitly_unverified_action_semantics':1466,'source_backed_route_exclusions':49,'global_events':34,'reviewed_task_or_internal_events':25,'source_excluded_events':7,'caller_specific_event_effects_unverified':2,'action_inventory_rows':len(inv),'route_rows_unresolved':s['route_rows_unresolved']}
print(json.dumps(out,indent=2))
`
  const check = spawnSync('python', ['-c', auditSource, candidate], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(check.status, 0, check.stdout + '\n' + check.stderr)
  const report = JSON.parse(check.stdout)
  fs.writeFileSync(path.join(candidate, 'evidence/test-source-action-census-v9.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  assert.deepEqual(report.route_rows_unresolved, [])
  assert.equal(report.jsx_controls, 1515)
  assert.equal(report.global_events, 34)
  assert.equal(report.caller_specific_event_effects_unverified, 2)
})

test('exact v8 PDF pair is red for both findings; scratch and final v9 PDF pairs are green inside real task spans', async () => {
  const redManual = path.join(prior, 'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf')
  const redQuick = path.join(prior, 'pdf/Tsa-Bonno-Bar-Quick-Start.pdf')
  const redReportPath = path.join(testEvidence, 'exact-v8-review2-red.json')
  const red = spawnSync('python', [verifier, '--manual', redManual, '--quick', redQuick, '--candidate-dir', prior, '--expect', 'red', '--report', redReportPath], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(red.status, 0, red.stdout + '\n' + red.stderr)
  const redReport = JSON.parse(red.stdout)
  assert.equal(redReport.red_evidence_validated, true)
  assert.equal(redReport.checks['BAR-DOC-037_falsely_routes_same_request_to_manager_search_inbox'], true)
  assert.equal(redReport.checks['BAR-DOC-037_missing_actual_submit_button_labels'], true)
  assert.equal(redReport.checks['BAR-DOC-037_missing_packaged_stock_decision'], true)
  assert.equal(redReport.checks['separate_unconfirmed_void_recovery_absent'], true)

  const scratch = path.join(temp, 'candidate-v9-source')
  fs.mkdirSync(path.join(scratch, 'content'), { recursive: true })
  fs.cpSync(path.join(candidate, 'content'), path.join(scratch, 'content'), { recursive: true })
  fs.cpSync(path.join(candidate, 'screenshots'), path.join(scratch, 'screenshots'), { recursive: true })
  fs.copyFileSync(path.join(candidate, 'build_candidate.py'), path.join(scratch, 'build_candidate.py'))
  fs.mkdirSync(path.join(scratch, 'evidence'), { recursive: true })
  const buildSource = String.raw`import importlib.util,json,sys
from pathlib import Path
builder_path,clone_path=map(Path,sys.argv[1:3])
spec=importlib.util.spec_from_file_location('bar_v9_scratch_builder',builder_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
clone=clone_path.resolve();module.HERE=clone;module.CONTENT=clone/'content/candidate-content.json'
data=json.loads(module.CONTENT.read_text(encoding='utf-8'))
manual,quick=module.build(data,clone/'pdf')
print(json.dumps({'manual':str(manual),'quick':str(quick)}))`
  const built = JSON.parse(execFileSync('python', ['-c', buildSource, path.join(candidate, 'build_candidate.py'), scratch], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
  const scratchDir = path.join(testEvidence, 'scratch-v9')
  fs.mkdirSync(path.join(scratchDir, 'pdf'), { recursive: true })
  const scratchManual = path.join(scratchDir, 'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf')
  const scratchQuick = path.join(scratchDir, 'pdf/Tsa-Bonno-Bar-Quick-Start.pdf')
  fs.copyFileSync(built.manual, scratchManual)
  fs.copyFileSync(built.quick, scratchQuick)
  fs.cpSync(path.join(candidate, 'content'), path.join(scratchDir, 'content'), { recursive: true })
  fs.cpSync(path.join(candidate, 'screenshots'), path.join(scratchDir, 'screenshots'), { recursive: true })
  fs.copyFileSync(path.join(scratch, 'task-page-ranges.csv'), path.join(scratchDir, 'task-page-ranges.csv'))
  fs.mkdirSync(path.join(scratchDir, 'evidence'), { recursive: true })
  fs.copyFileSync(path.join(scratch, 'evidence/quick-start-references.json'), path.join(scratchDir, 'evidence/quick-start-references.json'))
  const scratchReportPath = path.join(testEvidence, 'scratch-v9-green.json')
  const scratchCheck = spawnSync('python', [verifier, '--manual', scratchManual, '--quick', scratchQuick, '--candidate-dir', scratchDir, '--expect', 'green', '--report', scratchReportPath], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  assert.equal(scratchCheck.status, 0, scratchCheck.stdout + '\n' + scratchCheck.stderr)
  const scratchReport = JSON.parse(scratchCheck.stdout)
  assert.deepEqual(scratchReport.failed, [])

  const finalManual = path.join(candidate, 'pdf/Tsa-Bonno-Bar-Customer-Manual.pdf')
  const finalQuick = path.join(candidate, 'pdf/Tsa-Bonno-Bar-Quick-Start.pdf')
  const finalReportPath = path.join(testEvidence, 'final-v9-green.json')
  const final = spawnSync('python', [verifier, '--manual', finalManual, '--quick', finalQuick, '--candidate-dir', candidate, '--expect', 'green', '--report', finalReportPath], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  assert.equal(final.status, 0, final.stdout + '\n' + final.stderr)
  const finalReport = JSON.parse(final.stdout)
  assert.deepEqual(finalReport.failed, [])
  assert.notEqual(hash(finalManual), hash(redManual))
  assert.notEqual(hash(finalQuick), hash(redQuick))
  fs.writeFileSync(path.join(testEvidence, 'red-green-summary.json'), JSON.stringify({
    red: { exact_v8_manual_sha256: hash(redManual), exact_v8_quick_sha256: hash(redQuick), findings: redReport.required_red_findings },
    scratch: { manual_sha256: hash(scratchManual), quick_sha256: hash(scratchQuick), pages: [scratchReport.manual.pages, scratchReport.quick_start.pages], failed: scratchReport.failed },
    final: { manual_sha256: hash(finalManual), quick_sha256: hash(finalQuick), pages: [finalReport.manual.pages, finalReport.quick_start.pages], failed: finalReport.failed },
  }, null, 2) + '\n')
})
