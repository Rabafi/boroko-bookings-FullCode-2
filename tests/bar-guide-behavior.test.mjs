import './bar-guide-v7-regression.test.mjs'
import './bar-guide-v8-regression.test.mjs'
import './bar-guide-v9-regression.test.mjs'
import './bar-guide-stock-v11.test.mjs'
import './bar-guide-product-v11.test.mjs'
import './bar-guide-cashup-v11.test.mjs'
import './bar-guide-v12-receiving.test.mjs'
import './bar-guide-v12-route-scope.test.mjs'
import './bar-guide-v13-reservation-scope.test.mjs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createSignedPeerIdentityConflictSnapshot } from './helpers/mesh-identity-conflict-scenario.mjs'
import { createOrdinaryReplayFailureSnapshot } from './helpers/ordinary-replay-failure-scenario.mjs'

const root = process.cwd()
const harness = path.join(root, 'docs', 'bar-manual', 'build', 'capture-harness.jsx')
const builder = fs.readFileSync(path.join(root, 'docs', 'bar-manual', 'build', 'build_manual.py'), 'utf8')
const plainBuilder = builder.replace(/<[^>]+>/g, ' ')
const manuscript = fs.readFileSync(path.join(root, 'docs', 'bar-manual', 'manuscript.md'), 'utf8')
const quickStart = fs.readFileSync(path.join(root, 'docs', 'bar-manual', 'quick-start-manuscript.md'), 'utf8')
const captureSource = fs.readFileSync(harness, 'utf8')

// These two historical rebuild checks execute the source-less precompiled
// layout engine. Skip only those checks when this machine's Python magic does
// not match that bytecode; the reason remains visible in the TAP summary.
function historicalLayoutEngineBlocker() {
  const enginePath = path.join(root, 'docs', 'bar-manual', 'build', 'build_manual_engine.pyc')
  try {
    const currentMagic = execFileSync('python', ['-c', 'import importlib.util; print(importlib.util.MAGIC_NUMBER.hex())'], { cwd: root, encoding: 'utf8' }).trim()
    const engineMagic = fs.readFileSync(enginePath).subarray(0, 4).toString('hex')
    return currentMagic === engineMagic ? null : `historical source-less engine requires Python magic ${engineMagic}; available Python reports ${currentMagic}`
  } catch (error) {
    return `historical source-less engine compatibility could not be checked: ${error.message}`
  }
}

test('guide copy and capture source distinguish signed identity quarantine from ordinary replay failure', () => {
  assert.match(plainBuilder, /incoming peer operation is quarantined/i)
  assert.match(plainBuilder, /original local operation remains pending/i)
  assert.match(plainBuilder, /not automatically pause its normal sync or replay/i)
  assert.match(plainBuilder, /does not create a\s+Failed operations\s+row/i)
  assert.match(plainBuilder, /ordinary replay failure is different/i)
  assert.doesNotMatch(builder, /Review date: 09 September 2026/i)
  assert.doesNotMatch(builder, /four-page/i)
  assert.match(plainBuilder, /Other tills on this network/i)
  assert.match(plainBuilder, /App issues/i)
  assert.match(manuscript, /ordinary replay failure/i)
  assert.doesNotMatch(manuscript, /manager keeps the failed item for review and checks the Network note/i)
  assert.match(manuscript, /identity.conflict path[^\n]*(?:does not create|creates no) a? ?Failed operations row/i)
  assert.match(manuscript, /ordinary replay failure only/i)
  assert.match(quickStart, /Length: \*\*5 pages\*\*/i)
  assert.match(quickStart, /candidate\.3/i)
  assert.doesNotMatch(builder, /current historical detail does not show a separate reprint button/i)
  assert.doesNotMatch(manuscript, /no separate reprint button/i)
  assert.match(builder, /cashier's own PIN-verified history/i)
  assert.match(builder, /authorized manager or finance access/i)
  assert.match(quickStart, /same saved receipt again/i)
  assert.doesNotMatch(captureSource, /mesh-review-204/)
  assert.doesNotMatch(captureSource, /identity-conflict row/)
  assert.match(captureSource, /BAR_MESH_GUIDE_EVIDENCE/)
})

test('real signed identity quarantine and ordinary replay failure render their distinct System Health UI states', async (t) => {
  const identity = await createSignedPeerIdentityConflictSnapshot()
  const ordinary = await createOrdinaryReplayFailureSnapshot()
  assert.equal(identity.syncDetails.pendingCount, 1)
  assert.equal(identity.syncDetails.pending[0]._state, 'pending')
  assert.equal(identity.syncDetails.failedCount, 0)
  assert.equal(identity.quarantine.length, 1)
  assert.equal(identity.syncDetails.pending[0].data.payload.total, 111)
  assert.equal(identity.quarantine[0].incoming_total, 112)
  assert.equal(identity.syncDetails.pending[0].data.p_idempotency_key, 'bar-sale-stable-intent-00000001')
  assert.equal(identity.quarantine[0].intent_id, 'bar-sale-stable-intent-00000001')
  assert.match(identity.meshDiagnostics.warnings.join(' '), /queue identity conflict is quarantined/i)
  assert.equal(ordinary.syncDetails.pendingCount, 0)
  assert.equal(ordinary.syncDetails.failedCount, 1)
  assert.equal(ordinary.syncDetails.failed.length, 1)
  assert.equal(ordinary.quarantine, 0)

  const directory = path.dirname(harness)
  const bundle = path.join(root, 'tmp', 'bar-guide-behavior.bundle.js')
  const css = path.join(root, 'tmp', 'bar-guide-behavior.bundle.css')
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await build({ entryPoints: [harness], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
  const server = createServer((req, res) => {
    if (req.url.startsWith('/guide-behavior.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(bundle)); return }
    if (req.url.startsWith('/guide-behavior.bundle.css') && fs.existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(css)); return }
    const variant = new URL(req.url, 'http://127.0.0.1').searchParams.get('case')
    const snapshot = variant === 'ordinary' ? ordinary : identity
    const evidence = JSON.stringify(snapshot).replaceAll('<', '\\u003c')
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/guide-behavior.bundle.css"></head><body><div id="root"></div><script>window.__BAR_MESH_GUIDE_EVIDENCE__=${evidence};</script><script src="/guide-behavior.bundle.js"></script></body></html>`)
  })
  const chromiumPath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  let browser
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: chromiumPath })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)

    await page.goto(`http://127.0.0.1:${server.address().port}/?page=system-health&case=identity`)
    await page.getByRole('heading', { name: 'System health', exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Waiting for confirmation', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText(/Mesh queue identity conflict is quarantined\./).waitFor({ state: 'visible' })
    assert.equal(await page.getByText('Failed operations', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Retry all failed', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Clear all failed', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 0)
    assert.equal(await page.getByText('Network note', { exact: true }).count(), 1)
    await page.getByRole('tab', { name: /App issues/ }).click()
    await page.getByRole('heading', { name: 'Something is wrong — get help', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Send problem to support', exact: true }).waitFor({ state: 'visible' })

    await page.goto(`http://127.0.0.1:${server.address().port}/?page=system-health&case=ordinary`)
    await page.getByRole('heading', { name: 'System health', exact: true }).waitFor({ state: 'visible' })
    await page.getByText('Failed operations', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 1)
    assert.equal(await page.getByText('Network note', { exact: true }).count(), 0)
    await context.close()
  } finally {
    if (browser) await browser.close()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('cashier and manager historical receipt paths invoke the print bridge without a business mutation', async () => {
  const bundle = path.join(root, 'tmp', 'bar-guide-receipt-behavior.bundle.js')
  const css = path.join(root, 'tmp', 'bar-guide-receipt-behavior.bundle.css')
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await build({ entryPoints: [harness], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
  const server = createServer((req, res) => {
    if (req.url.startsWith('/guide-behavior.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(bundle)); return }
    if (req.url.startsWith('/guide-behavior.bundle.css') && fs.existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(css)); return }
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/guide-behavior.bundle.css"></head><body><div id="root"></div><script src="/guide-behavior.bundle.js"></script></body></html>')
  })
  let browser
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
    const base = `http://127.0.0.1:${server.address().port}`
    for (const pageName of ['my-sales', 'reports']) {
      for (const entry of ['row', 'detail']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
        page.setDefaultTimeout(15000)
        await page.goto(`${base}/?page=${pageName}`)
        if (pageName === 'reports') {
          const managerPin = page.getByLabel('Manager PIN', { exact: true })
          await managerPin.waitFor({ state: 'visible' })
          await managerPin.fill('1234')
          await page.getByRole('button', { name: 'Unlock Manage', exact: true }).click()
          await managerPin.waitFor({ state: 'hidden' })
          const authCalls = await page.evaluate(() => window.__BAR_GUIDE_API_CALLS__)
          assert.equal(authCalls.filter((call) => call.namespace === 'pos' && call.method === 'verifyManagerPin').length, 1, 'manager Sales path must verify the manager PIN')
        }
        await page.getByRole('heading', { name: pageName === 'my-sales' ? 'My sales' : 'Bar sales & control report', exact: true }).waitFor({ state: 'visible' })
        const dateFilters = page.locator('input[type="date"]')
        await dateFilters.nth(0).fill('2026-09-08')
        await dateFilters.nth(1).fill('2026-09-08')
        await page.getByText('R-2026-0018', { exact: false }).first().waitFor({ state: 'visible' })
        await page.evaluate(() => { window.__BAR_GUIDE_API_CALLS__ = [] })
        if (entry === 'row') {
          await page.getByRole('button', { name: 'Print receipt R-2026-0018', exact: true }).click()
        } else {
          await page.getByRole('button', { name: 'Open receipt R-2026-0018', exact: true }).click()
          const detailName = pageName === 'my-sales' ? 'My sale receipt details' : 'Receipt and reversal details'
          const detail = page.getByRole('dialog', { name: detailName, exact: true })
          await detail.waitFor({ state: 'visible' })
          await detail.getByRole('button', { name: 'Print receipt', exact: true }).click()
        }
        await page.getByRole('heading', { name: 'POS Receipt', exact: true }).waitFor({ state: 'visible' })
        const receipt = page.getByRole('heading', { name: 'POS Receipt', exact: true }).locator('xpath=../../..')
        await receipt.getByRole('button', { name: 'Print receipt', exact: true }).click()
        await page.waitForFunction(() => window.__BAR_GUIDE_API_CALLS__?.some((call) => call.namespace === 'receipts' && call.method === 'printCurrent'))
        const calls = await page.evaluate(() => window.__BAR_GUIDE_API_CALLS__)
        const label = `${pageName} ${entry}`
        assert.equal(calls.filter((call) => call.namespace === 'receipts' && call.method === 'printCurrent').length, 1, `${label} must invoke the native print bridge exactly once`)
        const businessMutations = calls.filter((call) =>
          !(call.namespace === 'receipts' && call.method === 'printCurrent')
          && !/^(get|load|criticalErrors)/i.test(call.method))
        assert.deepEqual(businessMutations, [], `${label} historical printing must not create a sale, collect payment, void, return, refund or move inventory`)
        await page.close()
      }
    }
  } finally {
    if (browser) await browser.close()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('My sales keeps local history and shows the pending-confirmation state after refresh rejection', async (t) => {
  const scratch = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-my-sales-offline-'))
  const tmpRoot = path.resolve(root, 'tmp') + path.sep
  const scratchPath = path.resolve(scratch)
  assert.ok(scratchPath.startsWith(tmpRoot), 'offline fixture cleanup remains inside workspace tmp')
  t.after(() => fs.rmSync(scratchPath, { recursive: true, force: true }))
  const bundle = path.join(scratch, 'bundle.js')
  const css = path.join(scratch, 'bundle.css')
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await build({ entryPoints: [harness], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
  const server = createServer((req, res) => {
    if (req.url.startsWith('/guide-behavior.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(bundle)); return }
    if (req.url.startsWith('/guide-behavior.bundle.css') && fs.existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(css)); return }
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/guide-behavior.bundle.css"></head><body><div id="root"></div><script src="/guide-behavior.bundle.js"></script></body></html>')
  })
  let browser
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(15000)
    await page.goto(`http://127.0.0.1:${server.address().port}/?page=my-sales&record=refresh-error`)
    const warning = page.getByText('Server confirmation is pending: figures marked * are last saved on this device, not confirmed totals.', { exact: true })
    await warning.waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Open receipt R-2026-0018', exact: true }).waitFor({ state: 'visible' })
    await page.getByText('* Last saved on this device — not yet confirmed by the server.', { exact: false }).waitFor({ state: 'visible' })
    assert.equal(await page.getByText(/Offline: showing this terminal’s saved sales/).count(), 0, 'the stored Offline message is not displayed while read completeness is false')
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await warning.waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Open receipt R-2026-0018', exact: true }).waitFor({ state: 'visible' })
    const calls = await page.evaluate(() => window.__BAR_GUIDE_API_CALLS__)
    assert.equal(calls.filter((call) => call.namespace === 'pos' && call.method === 'getSharedTillHistory').length, 4, 'mount and refresh each read local history, then attempt the server refresh')
    assert.deepEqual(calls.filter((call) => ['createOrder', 'approveVoidWithPin', 'printCurrent', 'savePDF', 'createReturn'].includes(call.method)), [], 'an unclear history refresh creates no sale, correction or receipt-print action')
    await page.close()
  } finally {
    if (browser) await browser.close()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

test('settled historical receipt exposes the alternate My sales correction form and the guide warns against it', async () => {
  const truth = fs.readFileSync(path.join(root, 'src', 'shared', 'posFinancialTruth.js'), 'utf8')
  const mySales = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'hospitality-pos', 'HposMySales.jsx'), 'utf8')
  const reports = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'hospitality-pos', 'HposReports.jsx'), 'utf8')
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261005060000_luna_pos_void_intent_exact_replay.sql'), 'utf8')
  assert.match(truth, /settled[\s\S]{0,180}sale|completed[\s\S]{0,180}settled/i, 'shared transaction classification keeps settled receipts in the sale class')
  assert.match(mySales, /\(isCompleted\(selected\) \|\| transactionState\(selected\) === 'pending'\)/, 'My sales exposes its correction form from the shared completed-sale classification')
  assert.match(reports, /status \|\| ''\)\.toLowerCase\(\) !== 'settled'/, 'Sales report hides its void form for settled receipts')
  assert.match(migration, /Settled orders must be returned in the current shift, not voided/i, 'latest local SQL source rejects settled voids; deployment is not inferred')

  const bundle = path.join(root, 'tmp', 'bar-guide-settled-record-behavior.bundle.js')
  const css = path.join(root, 'tmp', 'bar-guide-settled-record-behavior.bundle.css')
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await build({ entryPoints: [harness], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
  const server = createServer((req, res) => {
    if (req.url.startsWith('/guide-behavior.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(bundle)); return }
    if (req.url.startsWith('/guide-behavior.bundle.css') && fs.existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(css)); return }
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/guide-behavior.bundle.css"></head><body><div id="root"></div><script src="/guide-behavior.bundle.js"></script></body></html>')
  })
  let browser
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(15000)
    await page.goto(`http://127.0.0.1:${server.address().port}/?page=my-sales&record=settled`)
    const dates = page.locator('input[type="date"]')
    await dates.nth(0).fill('2026-09-08')
    await dates.nth(1).fill('2026-09-08')
    const savedReceipt = page.getByRole('button', { name: 'Open receipt R-2026-SETTLED', exact: true })
    await savedReceipt.waitFor({ state: 'visible' })
    await savedReceipt.click()
    const detail = page.getByRole('dialog', { name: 'My sale receipt details', exact: true })
    await detail.waitFor({ state: 'visible' })
    await detail.getByRole('heading', { name: 'Void sale / packaged return', exact: true }).waitFor({ state: 'visible' })
    await detail.getByRole('button', { name: 'Approve void / return', exact: true }).waitFor({ state: 'visible' })
    const calls = await page.evaluate(() => window.__BAR_GUIDE_API_CALLS__)
    assert.equal(calls.filter((call) => call.namespace === 'pos' && call.method === 'approveVoidWithPin').length, 0, 'opening the settled historical receipt must not submit a correction')
    await browser.close(); browser = null
  } finally {
    if (browser) await browser.close()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }

  const v10Manual = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-09-v10', 'pdf', 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const draftManual = path.join(root, 'docs', 'audits', '2026-10-09', 'bar-v10-continuation', 'draft-v11-semantic-review-01', 'pdf', 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const extract = String.raw`import json,sys
from pypdf import PdfReader
out=[]
for p in sys.argv[1:]:
 r=PdfReader(p); out.append(' '.join((page.extract_text() or '') for page in r.pages))
print(json.dumps(out))`
  const pdfText = JSON.parse(execFileSync('python', ['-c', extract, v10Manual, draftManual], { encoding: 'utf8' }))
  const stale = pdfText[0].toLowerCase()
  const revised = pdfText[1].toLowerCase().replace(/\s+/g, ' ')
  assert.equal(stale.includes('my sales may still show a correction form'), false, 'frozen v10 is the red baseline for this discovered alternate path')
  assert.match(revised, /my sales may still show a correction form/)
  assert.match(revised, /for settled, do not submit the my sales void\/cancellation form/)
  assert.match(revised, /no current bar screen return control is verified/)
  const authoring = fs.readFileSync(path.join(root, 'docs', 'audits', '2026-10-09', 'bar-v10-continuation', 'draft-v11-semantic-review-01', 'content', 'manual-source.md'), 'utf8')
  assert.match(authoring, /My sales may still show a correction form/)
  assert.match(authoring, /For Settled, do not submit the My sales void\/cancellation form/)
})

test('candidate builder rebuilds the current review date, five-page count and recovery references', (t) => {
  const blocker = historicalLayoutEngineBlocker()
  if (blocker) return t.skip(blocker)
  const builderPath = path.join(root, 'docs', 'bar-manual', 'build', 'build_manual.py')
  const candidateRoot = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-06-v2')
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
  const scratch = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-builder-behavior-'))
  const buildAndVerify = String.raw`
import importlib.util, json, sys
from pathlib import Path
from pypdf import PdfReader
builder_path, candidate_path, output_path = map(Path, sys.argv[1:4])
spec = importlib.util.spec_from_file_location('bar_guide_behavior_builder', builder_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
candidate = candidate_path.resolve()
out = output_path.resolve()
module.engine.OUT = out
module.engine.RAW = candidate / 'screenshots' / 'raw'
module.engine.ANN = candidate / 'screenshots' / 'annotated'
module.build_manual('Tsa-Bonno-Bar-Customer-Manual.pdf', quick=False)
module.build_manual('Tsa-Bonno-Bar-Quick-Start.pdf', quick=True)
def text(reader, page): return ' '.join((reader.pages[page - 1].extract_text() or '').split())
manual = PdfReader(str(out / 'Tsa-Bonno-Bar-Customer-Manual.pdf'))
quick = PdfReader(str(out / 'Tsa-Bonno-Bar-Quick-Start.pdf'))
assert len(manual.pages) == 56 and len(quick.pages) == 5
assert 'Review date: 06 October 2026' in text(manual, 1)
assert 'Candidate revision: bar-manual-2026.10.06-candidate.2' in text(manual, 1)
assert 'five-page quick-start PDF covers' in text(manual, 3)
assert 'Review date: 06 October 2026' in text(quick, 1)
assert 'Candidate revision: bar-quick-start-2026.10.06-candidate.2' in text(quick, 1)
assert 'Use this five-page card at the Till' in text(quick, 1)
assert 'See the full steps on page 56' in text(manual, 55)
assert 'Two tills disagree?' in text(quick, 4) and 'page 5' in text(quick, 4)
print(json.dumps({'manualPages': len(manual.pages), 'quickStartPages': len(quick.pages), 'manualRevisionDate': '06 October 2026', 'quickStartPagesDisplayed': 5, 'contentsAndRecoveryPointers': 'current'}))
`
  try {
    const output = execFileSync('python', ['-c', buildAndVerify, builderPath, candidateRoot, scratch], { encoding: 'utf8' })
    assert.match(output, /"quickStartPagesDisplayed": 5/)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('candidate v2 PDFs preserve the recovery pointer, receipt procedures and exact page/bookmark metadata', () => {
  const candidate = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-06-v2', 'pdf')
  const manual = path.join(candidate, 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const quick = path.join(candidate, 'Tsa-Bonno-Bar-Quick-Start.pdf')
  const verify = String.raw`
import json, sys
from pypdf import PdfReader

def text(reader, page):
    return reader.pages[page - 1].extract_text() or ''

def destinations(reader):
    found = []
    def walk(items):
        for item in items:
            if isinstance(item, list):
                walk(item)
            elif hasattr(item, 'title'):
                found.append((item.title, reader.get_destination_page_number(item) + 1))
    walk(reader.outline)
    return found

manual = PdfReader(sys.argv[1])
quick = PdfReader(sys.argv[2])
assert len(manual.pages) == 56
assert len(quick.pages) == 5
assert 'bar-manual-2026.10.06-candidate.2' in str(manual.metadata.get('/Subject', ''))
assert 'bar-quick-start-2026.10.06-candidate.2' in str(quick.metadata.get('/Subject', ''))
assert 'Review date: 06 October 2026' in text(manual, 1)
assert 'Candidate revision: bar-manual-2026.10.06-candidate.2' in text(manual, 1)
assert 'Review date: 06 October 2026' in text(quick, 1)
assert 'Candidate revision: bar-quick-start-2026.10.06-candidate.2' in text(quick, 1)
assert '06 October 2026' in str(manual.metadata.get('/Subject', ''))
assert '06 October 2026' in str(quick.metadata.get('/Subject', ''))
assert 'Identity-conflict recovery' in text(manual, 3) and '56' in text(manual, 3)
assert 'full steps on page 56' in text(manual, 55)
assert 'Network note' in text(manual, 55)
assert 'Failed operations row' not in text(manual, 55)
assert 'does not create a Failed operations row' in text(manual, 56)
assert 'has no Retry or Clear control' in text(manual, 56)
assert 'Customer display' not in text(manual, 19)
assert 'Customer display' in text(manual, 20)
assert 'authorized manager or finance access' in text(manual, 42)
assert 'does not create a sale, payment, void or stock movement' in text(manual, 42)
assert 'Two tills disagree?' in text(quick, 4) and 'page 5' in text(quick, 4)
assert 'does not automatically pause' in text(quick, 5)
manual_marks = destinations(manual)
quick_marks = destinations(quick)
assert any('When two tills disagree' in title and page == 56 for title, page in manual_marks), manual_marks
assert any('Two tills disagree?' in title and page == 5 for title, page in quick_marks), quick_marks
print(json.dumps({'manualPages': len(manual.pages), 'quickStartPages': len(quick.pages), 'manualBookmarks': len(manual_marks), 'quickStartBookmarks': len(quick_marks)}))
`
  const output = execFileSync('python', ['-c', verify, manual, quick], { encoding: 'utf8' })
  assert.match(output, /"manualPages": 56/)
})



test('GUIDE-02 PDF contract is red for v2 scratch/final and green for v3 scratch/final', (t) => {
  const blocker = historicalLayoutEngineBlocker()
  if (blocker) return t.skip(blocker)
  const buildDir = path.join(root, 'docs', 'bar-manual', 'build')
  const v2 = path.join(buildDir, 'remediation-candidate-2026-10-06-v2')
  const v3 = path.join(buildDir, 'remediation-candidate-2026-10-06-v3')
  const v2Quick = path.join(v2, 'pdf', 'Tsa-Bonno-Bar-Quick-Start.pdf')
  const v2Manual = path.join(v2, 'pdf', 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const v3Quick = path.join(v3, 'pdf', 'Tsa-Bonno-Bar-Quick-Start.pdf')
  const v3Manual = path.join(v3, 'pdf', 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const pdfContract = path.join(root, 'tests', 'bar-guide-quick-receipt-pdf-contract.py')
  const scratchRoot = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-guide02-red-green-'))
  const buildScratch = String.raw`
import importlib.util, sys
from pathlib import Path
builder_path, output_path, raw_path, annotated_path = map(Path, sys.argv[1:5])
spec = importlib.util.spec_from_file_location('guide02_scratch_builder', builder_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.engine.OUT = output_path
module.engine.RAW = raw_path
module.engine.ANN = annotated_path
module.build_manual('Tsa-Bonno-Bar-Customer-Manual.pdf', quick=False)
module.build_manual('Tsa-Bonno-Bar-Quick-Start.pdf', quick=True)
`
  const buildPair = (label, builderPath, screenshotRoot) => {
    const outputPath = path.join(scratchRoot, label)
    fs.mkdirSync(outputPath, { recursive: true })
    execFileSync('python', ['-c', buildScratch, builderPath, outputPath, path.join(screenshotRoot, 'raw'), path.join(screenshotRoot, 'annotated')], { encoding: 'utf8' })
    return {
      quick: path.join(outputPath, 'Tsa-Bonno-Bar-Quick-Start.pdf'),
      manual: path.join(outputPath, 'Tsa-Bonno-Bar-Customer-Manual.pdf'),
    }
  }
  const checkPair = (label, pair, expectedStatus, expectedPassed) => {
    const check = spawnSync('python', [pdfContract, pair.quick, '--manual', pair.manual], { encoding: 'utf8' })
    assert.equal(check.status, expectedStatus, `${label}: ${check.stdout}\n${check.stderr}`)
    const report = JSON.parse(check.stdout)
    assert.equal(report.passed, expectedPassed, `${label}: ${check.stdout}`)
    assert.equal(report.total, 3, `${label}: all two quick-start pages and the manual cross-reference are checked`)
    return report
  }

  try {
    const v2Scratch = buildPair('v2-layout-scratch', path.join(buildDir, 'build_manual.py'), path.join(v2, 'screenshots'))
    const v2ScratchRed = checkPair('v2 scratch build', v2Scratch, 1, 0)
    const v2FinalRed = checkPair('exact v2 final PDFs', { quick: v2Quick, manual: v2Manual }, 1, 0)
    const v3Scratch = buildPair('v3-layout-scratch', path.join(buildDir, 'build_manual_candidate_v3.py'), path.join(v3, 'screenshots'))
    const v3ScratchGreen = checkPair('v3 scratch build', v3Scratch, 0, 3)
    const v3FinalGreen = checkPair('exact v3 final PDFs', { quick: v3Quick, manual: v3Manual }, 0, 3)
    assert.equal(v2ScratchRed.checks.quick_page_2_saved_record_print_and_recovery, false)
    assert.equal(v2FinalRed.checks.quick_page_4_saved_record_print_and_recovery, false)
    assert.equal(v3ScratchGreen.checks.quick_page_2_saved_record_print_and_recovery, true)
    assert.equal(v3FinalGreen.checks.quick_page_4_saved_record_print_and_recovery, true)
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  }
})

test('v5 source-derived PDF contract is red for exact v4 and green for scratch/final v5', (t) => {
  const buildDir = path.join(root, 'docs', 'bar-manual', 'build')
  const v4 = path.join(buildDir, 'remediation-candidate-2026-10-07-v4', 'pdf')
  const v5 = path.join(buildDir, 'remediation-candidate-2026-10-07-v5')
  const verifier = path.join(v5, 'evidence', 'verify_candidate.py')
  const scratchRoot = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v5-immutable-test-'))
  t.after(() => fs.rmSync(scratchRoot, { recursive: true, force: true }))
  const copiedCandidate = path.join(scratchRoot, 'candidate-v5')
  fs.cpSync(v5, copiedCandidate, { recursive: true })
  const builder = path.join(copiedCandidate, 'build_candidate.py')
  const scratch = path.join(copiedCandidate, 'scratch-v5')
  const evidence = scratchRoot
  const v4Manual = path.join(v4, 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const v4Quick = path.join(v4, 'Tsa-Bonno-Bar-Quick-Start.pdf')
  const v5Manual = path.join(v5, 'pdf', 'Tsa-Bonno-Bar-Customer-Manual.pdf')
  const v5Quick = path.join(v5, 'pdf', 'Tsa-Bonno-Bar-Quick-Start.pdf')
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
  assert.equal(hash(v4Manual), '5BD2C96C58564B0D6C592CDB8F71A29C9D8A351E523AEA853EA73261929A6031', 'reviewed v4 manual remains the exact red baseline')
  assert.equal(hash(v4Quick), 'B6E8B61AF5D5439E3049819611A65433F448BB92EEE06E1259D4BB9C35C4C76A', 'reviewed v4 quick-start remains the exact red baseline')

  const verify = (label, pair, expectedPass) => {
    const args = [verifier, '--manual', pair.manual, '--quick', pair.quick, '--source-check']
    const result = spawnSync('python', args, { encoding: 'utf8' })
    assert.equal(result.status, expectedPass ? 0 : 1, label + ': ' + result.stdout + result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.pass, expectedPass, label + ': ' + JSON.stringify(report.errors))
    fs.writeFileSync(path.join(evidence, label + '-pdf-contract.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
    return report
  }

  const v4Red = verify('exact-v4-red', { manual: v4Manual, quick: v4Quick }, false)
  assert.equal(v4Red.checks.find((item) => item.check === 'purchase receiving explains full-order effect and safe stop').pass, false, 'v4 PDF must fail the unsupported partial-receipt instruction check')
  assert.equal(v4Red.checks.find((item) => item.check === 'PDF task page embeds the exact candidate stock-only capture selected by the builder mapping').pass, false, 'v4 PDF must fail the stale stock-only screenshot check')

  fs.mkdirSync(scratch, { recursive: true })
  execFileSync('python', [builder, '--output-dir', scratch], { encoding: 'utf8' })
  const v5Scratch = verify('scratch-v5-green', {
    manual: path.join(scratch, 'Tsa-Bonno-Bar-Customer-Manual.pdf'),
    quick: path.join(scratch, 'Tsa-Bonno-Bar-Quick-Start.pdf'),
  }, true)
  const v5Final = verify('final-v5-green', { manual: v5Manual, quick: v5Quick }, true)
  for (const report of [v5Scratch, v5Final]) {
    assert.equal(report.checks.length, 35, 'all PDF, task-continuation, capture and source-derived checks must run')
    assert.equal(report.checks.find((item) => item.check === 'PDF task page embeds the exact candidate stock-only capture selected by the builder mapping').pass, true, 'v5 PDF must embed the isolated stock-only screenshot')
    assert.ok(report.checks.every((item) => item.pass), JSON.stringify(report.errors))
  }
  assert.equal(v5Scratch.manual.pages, v5Final.manual.pages, 'scratch and candidate manual pagination must agree')
  assert.equal(v5Scratch.quick_start.pages, v5Final.quick_start.pages, 'scratch and candidate quick-start pagination must agree')
})



test('Bar candidate v6 catches exact v5 defects in rendered PDFs and passes scratch/final evidence', (t) => {
  const v5Root = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-07-v5')
  const v6Root = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-08-v6')
  const helper = path.join(v6Root, 'evidence', 'verify_v6_candidate.py')
  const v5Pdfs = path.join(v5Root, 'pdf')
  const scratchPdfs = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v6-immutable-test-'))
  t.after(() => fs.rmSync(scratchPdfs, { recursive: true, force: true }))
  const finalPdfs = path.join(v6Root, 'pdf')
  fs.mkdirSync(path.join(scratchPdfs, 'reports'), { recursive: true })
  for (const name of ['Tsa-Bonno-Bar-Customer-Manual.pdf', 'Tsa-Bonno-Bar-Quick-Start.pdf']) {
    fs.copyFileSync(path.join(finalPdfs, name), path.join(scratchPdfs, name))
  }
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
  assert.equal(hash(path.join(v5Pdfs, 'Tsa-Bonno-Bar-Customer-Manual.pdf')), '6EDA880C918EA8C4E614B297985CF5B5CABA61B1D0361C710F6E77D3B5935078', 'the red baseline is the preserved exact v5 manual')
  assert.equal(hash(path.join(v5Pdfs, 'Tsa-Bonno-Bar-Quick-Start.pdf')), '79DE3626A58C525941DF8DC3F9C4A3CF438FEDC00196C6937E16A2466CD99D86', 'the red baseline is the preserved exact v5 quick-start')
  const run = (mode, pdfDir, registerDir, report) => {
    const stdout = execFileSync('python', [helper, '--mode', mode, '--pdf-dir', pdfDir, '--register-dir', registerDir, '--report', report], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    const result = JSON.parse(stdout)
    if (mode === 'red') assert.equal(result.red_evidence_validated, true)
    else assert.deepEqual(result.failed, [])
    return result
  }
  const red = run('red', v5Pdfs, v5Root, path.join(scratchPdfs, 'reports/exact-v5-red-evidence.json'))
  for (const id of ['shift_identity_separation', 'supplier_statement_reconciliation', 'bill_reference_requires_real_hash', 'credit_note_reference_and_hash', 'manual_receipt_retry_recovery', 'task_register_matches_all_tasks', 'task_ranges_cover_headings_results_and_bookmarks', 'receipt_range_covers_all_rendered_task_pages', 'quick_start_references_rendered_from_final_manual', 'quick_start_readable_source_has_complete_references', 'continued_title_not_repeated_on_same_page', 'customer_copy_has_no_audit_author_jargon', 'transfer_capture_is_current_context_and_embedded', 'shift_captures_match_current_states_and_are_embedded', 'current_search_and_navigation_routes_have_task_or_scope_disposition']) {
    assert.ok(red.failed.includes(id), `exact v5 should be red for ${id}`)
  }
  const scratch = run('green', scratchPdfs, v6Root, path.join(scratchPdfs, 'reports/prior-v6-scratch-green-evidence.json'))
  assert.equal(scratch.manual_pages, 71)
  assert.equal(scratch.quick_start_pages, 5)
  assert.equal(scratch.candidate_task_count, 123)
  const final = run('green', finalPdfs, v6Root, path.join(scratchPdfs, 'reports/prior-v6-final-green-evidence.json'))
  assert.equal(final.manual_pages, 71)
  assert.equal(final.quick_start_pages, 5)
  assert.equal(final.candidate_task_count, 123)
})

