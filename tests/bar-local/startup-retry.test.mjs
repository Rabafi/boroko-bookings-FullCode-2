import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { handleStartupRetry, STARTUP_RETRY_URL } from '../../src/main/startupRetry.js'

test('startup retry reloads only the existing allowed application without cache', () => {
  let reloads = 0
  let prevented = 0
  const event = { preventDefault: () => prevented++ }
  const contents = { isDestroyed: () => false, getURL: () => 'file:///app/index.html', reloadIgnoringCache: () => reloads++ }
  assert.equal(handleStartupRetry(event, STARTUP_RETRY_URL, contents, () => true), true)
  assert.equal(reloads, 1)
  handleStartupRetry(event, STARTUP_RETRY_URL, contents, () => false)
  handleStartupRetry(event, STARTUP_RETRY_URL + '?url=https://evil.test', contents, () => true)
  assert.equal(reloads, 1)
  assert.equal(prevented, 2)
})

const source = await readFile(new URL('../../src/renderer/public/startup-fallback.js', import.meta.url), 'utf8')
function fixture() {
  const listeners = {}
  const message = { textContent: '' }
  const retry = { hidden: true, addEventListener: (name, fn) => { listeners[name] = fn } }
  let watchdog
  class Script { type = 'module'; src = 'http://localhost/src/main.jsx?secret=redact' }
  const logs = []
  const window = { api: {}, location: {}, addEventListener: (name, fn) => { listeners[name] = fn } }
  vm.runInNewContext(source, { window, document: { getElementById: (id) => id === 'startup-message' ? message : id === 'startup-retry' ? retry : { querySelector: () => true } },
    performance: { now: () => 1 }, HTMLScriptElement: Script, URL, console: { info() {}, error: (...args) => logs.push(args) }, setTimeout: (fn) => { watchdog = fn } })
  return { listeners, message, retry, window, logs, Script, timeout: () => watchdog() }
}

test('module failure survives watchdog and retry uses fixed cache bypass action without secret diagnostics', () => {
  const f = fixture()
  f.listeners.error({ target: new f.Script() })
  const specific = f.message.textContent
  f.timeout()
  assert.equal(f.message.textContent, specific)
  assert.match(specific, /screen could not be loaded/)
  assert.equal(f.retry.hidden, false)
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|redact/)
  f.listeners.click()
  assert.equal(f.window.location.href, STARTUP_RETRY_URL)
})

test('stalled renderer offers product neutral recovery without changing saved data', () => {
  const f = fixture()
  f.timeout()
  assert.match(f.message.textContent, /taking longer.*saved records are unchanged/)
  assert.equal(f.retry.hidden, false)
})
