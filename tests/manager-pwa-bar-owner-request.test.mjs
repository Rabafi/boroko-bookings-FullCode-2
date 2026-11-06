import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let server
let baseUrl
let api
let mode = 'ok'
let requestCount = 0

before(async () => {
  server = createServer((req, res) => {
    requestCount += 1
    if (mode === 'stall-headers') {
      const timer = setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ ok: true, bars: [] })) }, 5000)
      res.on('close', () => clearTimeout(timer))
      return
    }
    if (mode === 'stall-body') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ok":true,')
      return
    }
    if (mode === 'oversized') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(`{"ok":true,"bars":[]} ${' '.repeat(1_000_001)}`)
      return
    }
    if (mode === 'stall-body') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ok":true,')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, bars: [] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  globalThis.__barOwnerTestUrl = baseUrl
  let source = await readFile(path.join(root, 'manager-pwa/src/lib/barOwner.js'), 'utf8')
  source = source.replace('import.meta.env.VITE_BAR_OWNER_API_URL?.trim()', 'globalThis.__barOwnerTestUrl')
  source = source.replace('const REQUEST_TIMEOUT_MS = 12_000', 'const REQUEST_TIMEOUT_MS = 80')
  assert.notEqual(source, await readFile(path.join(root, 'manager-pwa/src/lib/barOwner.js'), 'utf8'), 'the Vite API URL must be substituted in this Node HTTP test')
  api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
})

after(async () => {
  server?.closeAllConnections()
  await new Promise((resolve) => server?.close(resolve))
  delete globalThis.__barOwnerTestUrl
})

test('owner request deadline settles stalled response headers independently of fetch abort', async () => {
  mode = 'stall-headers'
  await assert.rejects(api.getBarOwnerBars('test-token'), /timed out/)
  mode = 'ok'
})

test('owner request deadline settles a stalled response body independently of reader cancellation', async () => {
  mode = 'stall-body'
  await assert.rejects(api.getBarOwnerBars('test-token'), /timed out/)
  mode = 'ok'
})

test('already-aborted callers do not start a network request', async () => {
  const beforeCount = requestCount
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(api.getBarOwnerBars('test-token', controller.signal), { name: 'AbortError' })
  assert.equal(requestCount, beforeCount)
})

test('caller cancellation interrupts a stalled body promptly', async () => {
  const controller = new AbortController()
  mode = 'stall-body'
  const pending = api.getBarOwnerBars('test-token', controller.signal)
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, { name: 'AbortError' })
  mode = 'ok'
})

test('oversized owner responses are rejected at the byte bound', async () => {
  mode = 'oversized'
  await assert.rejects(api.getBarOwnerBars('test-token'), /1 MB limit/)
  mode = 'ok'
})

test('a timed-out request does not poison a subsequent request', async () => {
  mode = 'stall-body'
  await assert.rejects(api.getBarOwnerBars('test-token'), /timed out/)
  mode = 'ok'
  assert.deepEqual(await api.getBarOwnerBars('test-token'), [])
})
