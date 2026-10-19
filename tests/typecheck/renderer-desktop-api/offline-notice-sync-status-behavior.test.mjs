import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/OfflineNotice-before-sync-status-view-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importNotice(source, api) {
  const states = []
  const effects = []
  let statusListener
  let hook = 0
  const react = {
    useState(initial) {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useRef(initial) { const index = hook++; if (!(index in states)) states[index] = { current: initial }; return states[index] }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: Symbol.for('react.fragment')
  }
  const icon = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return { WifiOff: icon, Info: icon, FileDown: icon }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const wiredApi = {
    ...api,
    sync: {
      getStatus: api.sync.getStatus,
      onStatusChanged: (callback) => { statusListener = callback; return api.sync.unsubscribe ?? (() => {}) }
    }
  }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api: wiredApi })
  return {
    states,
    get statusListener() { return statusListener },
    render() { hook = 0; effects.length = 0; return module.exports.default({ tasks: ['Live cloud checks'] }) },
    effects,
    module
  }
}

async function mount(source, status) {
  const calls = []
  const runtime = importNotice(source, {
    sync: { getStatus: async () => status },
    reports: { exportOfflineSafetyManifest: async () => { calls.push('export'); return { success: true, filePath: 'fictional/path.xlsx' } } }
  })
  let tree = runtime.render()
  const cleanup = runtime.effects.map((effect) => effect()).filter((value) => typeof value === 'function')
  await new Promise((resolve) => setImmediate(resolve))
  tree = runtime.render()
  return { runtime, calls, cleanup, tree }
}

function findButton(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button' && typeof node.props?.onClick === 'function') return node
  for (const value of Object.values(node.props || {})) {
    if (Array.isArray(value)) {
      for (const child of value) { const found = findButton(child); if (found) return found }
    } else {
      const found = findButton(value)
      if (found) return found
    }
  }
  return null
}

test('actual OfflineNotice import preserves sync status reads, timer cleanup and export behavior', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/shared/OfflineNotice.jsx'))

  for (const status of [
    { isOnline: true }, { isOnline: false }, { isOnline: 'false' }, null, false, 'malformed-status',
    Object.assign(Object.create({ isOnline: false }), { pending: 2 })
  ]) {
    const oldResult = await mount(before, status)
    const newResult = await mount(current, status)
    assert.deepEqual(newResult.tree, oldResult.tree)
    assert.deepEqual(newResult.runtime.states.slice(0, 2), oldResult.runtime.states.slice(0, 2))
    assert.deepEqual(newResult.calls, oldResult.calls)
    assert.equal(newResult.runtime.statusListener instanceof Function, true)
    assert.equal(oldResult.runtime.statusListener instanceof Function, true)
    for (const cleanup of [...oldResult.cleanup, ...newResult.cleanup]) cleanup()
  }

  const oldResult = await mount(before, { isOnline: true })
  const newResult = await mount(current, { isOnline: true })
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const previousAlert = globalThis.alert
  const oldTimers = new Map()
  const newTimers = new Map()
  const alerts = []
  let nextTimer = 0
  try {
    globalThis.setTimeout = (callback) => { const id = ++nextTimer; oldTimers.set(id, callback); newTimers.set(id, callback); return id }
    globalThis.clearTimeout = (id) => { oldTimers.delete(id); newTimers.delete(id) }
    globalThis.alert = (message) => alerts.push(message)
    for (const result of [oldResult, newResult]) {
      result.runtime.statusListener({ isOnline: false })
      for (const callback of oldTimers.values()) callback()
      result.runtime.render()
    }
    assert.deepEqual(newResult.runtime.states.slice(0, 2), oldResult.runtime.states.slice(0, 2))
    const oldButton = findButton(oldResult.runtime.render())
    const newButton = findButton(newResult.runtime.render())
    assert.ok(oldButton)
    assert.ok(newButton)
    await oldButton.props.onClick()
    await newButton.props.onClick()
    assert.deepEqual(newResult.calls, oldResult.calls)
    assert.deepEqual(alerts, [
      'Safety manifest exported successfully to: fictional/path.xlsx',
      'Safety manifest exported successfully to: fictional/path.xlsx'
    ])
  } finally {
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    globalThis.alert = previousAlert
  }
})
