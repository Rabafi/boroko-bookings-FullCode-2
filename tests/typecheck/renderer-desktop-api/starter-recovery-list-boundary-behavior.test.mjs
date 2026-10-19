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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/StarterRecoveryWorkspace-before-recovery-list-boundary-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/StarterRecoveryWorkspace.jsx')
const read = (path) => readFileSync(path, 'utf8')

function evaluate(source, mockRequire, windowValue) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}
function importComponent(source, api) {
  const states = []
  const effects = []
  let cursor = 0
  const react = {
    useState(initial) {
      const slot = cursor++
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
      return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }]
    },
    useEffect(effect) { effects.push(effect) }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const icons = Object.fromEntries(['AlertTriangle', 'CheckCircle2', 'Eye', 'EyeOff', 'FileArchive', 'Loader2', 'RefreshCw', 'ShieldAlert', 'Trash2'].map((name) => [name, name]))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const imported = evaluate(source, mockRequire, { api })
  const render = () => { cursor = 0; return imported.default({ companies: [], unlocked: false }) }
  return { render, states, effects }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
async function snapshot(source, response, reject = false) {
  const calls = []
  const api = { backup: { recoveryList: async (...args) => {
    calls.push(['recoveryList', ...args])
    if (reject) throw new Error('recovery unavailable')
    return response
  } } }
  const runtime = importComponent(source, api)
  let tree = runtime.render()
  for (const effect of runtime.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = runtime.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls, states: runtime.states, tree, renderError }
}

test('actual StarterRecoveryWorkspace import preserves raw recovery-list rows and container fallback', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const validRows = [{ operation_id: 'op-1', status: 'draft', lodge_id: 'lodge-1', created_at: '2026-10-15' }]
  const malformedRows = [{ operation_id: 'op-malformed', status: 7, lodge_id: null, created_at: { value: 1 } }, 'row-without-fields']
  for (const response of [
    { success: true, operations: validRows },
    { success: true, operations: malformedRows },
    { success: true, operations: [null] },
    { success: true, operations: { rows: validRows } },
    { success: true, operations: null },
    { success: false, error: 'not authorized', operations: validRows },
    null,
    'malformed-response'
  ]) {
    const oldState = await snapshot(before, response)
    const newState = await snapshot(current, response)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states, oldState.states)
    assert.equal(newState.renderError, oldState.renderError)
  }
  const oldRows = await snapshot(before, { success: true, operations: malformedRows })
  const newRows = await snapshot(current, { success: true, operations: malformedRows })
  assert.equal(oldRows.states[0], malformedRows)
  assert.equal(newRows.states[0], malformedRows)
  const oldRejected = await snapshot(before, undefined, true)
  const newRejected = await snapshot(current, undefined, true)
  assert.deepEqual(newRejected.calls, oldRejected.calls)
  assert.deepEqual(newRejected.states, oldRejected.states)
  assert.equal(newRejected.renderError, oldRejected.renderError)
})
