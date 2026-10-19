import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createSignedPeerIdentityConflictSnapshot } from '../../../tests/helpers/mesh-identity-conflict-scenario.mjs'

const dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dir, '..', '..', '..')
const captureRoot = process.env.BAR_GUIDE_CAPTURE_DIR ? path.resolve(process.env.BAR_GUIDE_CAPTURE_DIR) : path.join(root, 'docs', 'bar-manual', 'assets', 'screenshots')
const outDir = path.join(captureRoot, 'raw')
mkdirSync(outDir, { recursive: true })
const evidenceDir = process.env.BAR_GUIDE_EVIDENCE_DIR ? path.resolve(process.env.BAR_GUIDE_EVIDENCE_DIR) : path.join(root, 'tmp', 'bar-guide-evidence')
mkdirSync(evidenceDir, { recursive: true })
const evidence = await createSignedPeerIdentityConflictSnapshot()
if (evidence.syncDetails.pendingCount !== 1 || evidence.syncDetails.failedCount !== 0 || evidence.quarantine.length !== 1) throw new Error('Signed peer identity evidence did not preserve pending/quarantine/failed counts.')
const evidencePath = path.join(evidenceDir, 'mesh-identity-conflict-snapshot.json')
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
const evidenceJson = JSON.stringify(evidence).replaceAll('<', '\\u003c')
const buildDir = path.join(captureRoot, '.build')
mkdirSync(buildDir, { recursive: true })
const bundle = path.join(buildDir, 'capture-luna-bar-warning.bundle.js')
const css = path.join(buildDir, 'capture-luna-bar-warning.bundle.css')
await build({
  entryPoints: [path.join(dir, 'capture-harness.jsx')],
  bundle: true,
  outfile: bundle,
  jsx: 'automatic',
  nodePaths: [path.join(root, 'node_modules')],
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' },
  logLevel: 'warning'
})
const server = createServer((req, res) => {
  if (req.url.startsWith('/capture-luna-bar-warning.bundle.js')) {
    res.setHeader('content-type', 'text/javascript')
    res.end(readFileSync(bundle))
    return
  }
  if (req.url.startsWith('/capture-luna-bar-warning.bundle.css') && existsSync(css)) {
    res.setHeader('content-type', 'text/css')
    res.end(readFileSync(css))
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/capture-luna-bar-warning.bundle.css"></head><body><div id="root"></div><script>window.__BAR_MESH_GUIDE_EVIDENCE__=' + evidenceJson + ';</script><script src="/capture-luna-bar-warning.bundle.js"></script></body></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => console.error('PAGEERROR', error.message))
  await page.goto(base + '/?page=system-health')
  await page.getByRole('heading', { name: 'System health', exact: true }).waitFor({ state: 'visible' })
  await page.getByText('Mesh queue identity conflict is quarantined.', { exact: false }).waitFor({ state: 'visible' })
  await page.getByText('Waiting for confirmation', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('create pos order v3', { exact: true }).waitFor({ state: 'visible' })
  if (await page.getByRole('heading', { name: 'Failed operations', exact: true }).count()) throw new Error('Identity-quarantine capture incorrectly shows a Failed operations row.')
  await page.evaluate(() => document.fonts?.ready)
  const screenshot = path.join(outDir, '27-mesh-identity-warning.png')
  const operationQueue = page.locator(".hpos-sync-list.is-pending").first()
  await operationQueue.screenshot({ path: screenshot })
  const networkWarning = page.locator('section[aria-label="Other tills on this network"] .hpos-sync-list.is-pending')
  await networkWarning.waitFor({ state: 'visible' })
  const networkScreenshot = path.join(outDir, '28-mesh-network-warning.png')
  await networkWarning.screenshot({ path: networkScreenshot })
  console.log('Captured actual isolated signed-peer identity state:', screenshot)
  console.log('Evidence snapshot:', evidencePath)
  await context.close()
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}