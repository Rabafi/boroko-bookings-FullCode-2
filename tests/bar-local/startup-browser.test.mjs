import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const html = await readFile(new URL('../../src/renderer/index.html', import.meta.url), 'utf8')
const fallback = await readFile(new URL('../../src/renderer/public/startup-fallback.js', import.meta.url), 'utf8')

async function startServer(moduleHandler) {
  let pageLoads = 0
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      pageLoads += 1
      res.writeHead(200, { 'content-type': 'text/html' }).end(html)
    } else if (req.url === '/startup-fallback.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(fallback)
    } else if (req.url === '/src/main.jsx') {
      await moduleHandler(req, res)
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, url: `http://127.0.0.1:${address.port}`, pageLoads: () => pageLoads }
}

test('cold offline renderer paints local progress before the application module and replaces it on first UI commit', { timeout: 120000 }, async () => {
  let allowModule
  let moduleStarted
  const entered = new Promise((resolve) => { moduleStarted = resolve })
  const release = new Promise((resolve) => { allowModule = resolve })
  const fixture = await startServer(async (_req, res) => {
    moduleStarted()
    await release
    res.writeHead(200, { 'content-type': 'text/javascript' })
      .end("document.getElementById('root').innerHTML='<main role=\"main\">Usable Bar setup screen</main>'")
  })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH })
  try {
    const context = await browser.newContext()
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(fixture.url, { waitUntil: 'commit' })
    await page.getByRole('heading', { name: 'Starting the application…' }).waitFor()
    await entered
    assert.match(await page.locator('#startup-message').textContent(), /without an internet connection/)
    assert.equal(await page.getByRole('button', { name: 'Try again' }).isVisible(), false)
    allowModule()
    await page.getByRole('main').getByText('Usable Bar setup screen').waitFor()
    assert.deepEqual(pageErrors, [])
  } finally {
    allowModule?.()
    await browser.close()
    await new Promise((resolve) => fixture.server.close(resolve))
  }
})

test('a failed renderer module exposes an actionable local retry instead of a blank screen', { timeout: 120000 }, async () => {
  const fixture = await startServer(async (_req, res) => { res.writeHead(500).end('module unavailable') })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH })
  try {
    const page = await browser.newPage()
    await page.goto(fixture.url, { waitUntil: 'commit' })
    await page.getByRole('heading', { name: 'Starting the application…' }).waitFor()
    await page.getByText('The application screen could not be loaded. Your saved records are unchanged. Try again.').waitFor({ timeout: 10000 })
    const retry = page.getByRole('button', { name: 'Try again' })
    assert.equal(await retry.isVisible(), true)
    await retry.click()
    await page.waitForFunction(() => Number(document.documentElement.dataset.retryCount || 0) > 0, { timeout: 1000 }).catch(() => {})
    assert.ok(fixture.pageLoads() >= 2, 'retry reloads the same local application page')
  } finally {
    await browser.close()
    await new Promise((resolve) => fixture.server.close(resolve))
  }
})
