import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
const dir = path.resolve('docs/bar-manual/build')
const root = path.resolve(dir, '..', '..', '..')
const outDir = path.join(root, 'docs', 'bar-manual', 'assets', 'screenshots', 'raw')
mkdirSync(outDir, { recursive: true })
const bundle = path.join(dir, 'hpos-harness.capture.bundle.js')
const css = path.join(dir, 'hpos-harness.capture.bundle.css')
await build({ entryPoints: [path.join(root, 'tests/browser/hpos-harness.jsx')], bundle: true, outfile: bundle, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'css' }, logLevel: 'warning' })
const server = createServer((req, res) => {
  if (req.url.startsWith('/hpos-harness.bundle.js')) { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(bundle)); return }
  if (req.url.startsWith('/hpos-harness.bundle.css') && existsSync(css)) { res.setHeader('content-type', 'text/css'); res.end(readFileSync(css)); return }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/hpos-harness.bundle.css"></head><body><div id="root"></div><script src="/hpos-harness.bundle.js"></script></body></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const shots = [
  ['15-tab-recovery-inbox.png', '?suite=recovery&scenario=split-unknown-replay&script=unknown', 'recovery-inbox'],
]
for (const [file, query, testId] of shots) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await page.goto(`${base}/${query}`)
  await page.waitForFunction(() => document.fonts?.status === 'loaded')
  if (testId) await page.getByTestId(testId).waitFor({ state: 'visible' })
  else await page.getByText(/expense|permission|access/i).first().waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(outDir, file), fullPage: true })
  await context.close()
}
await browser.close()
await new Promise((resolve) => server.close(resolve))
console.log('Captured validated recovery screenshot')
