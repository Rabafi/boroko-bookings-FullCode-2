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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/MasterSetup-before-admin-result-boundary-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/MasterSetup.jsx')
const read = (path) => readFileSync(path, 'utf8')

function evaluate(source, mockRequire, windowValue) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}
function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  const children = tree.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}
function findAllNodes(tree, predicate, found = []) {
  if (!tree || typeof tree !== 'object') return found
  if (predicate(tree)) found.push(tree)
  const children = tree.props?.children
  for (const child of Array.isArray(children) ? children : [children]) findAllNodes(child, predicate, found)
  return found
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
  const icons = Object.fromEntries(['Shield', 'Eye', 'EyeOff'].map((name) => [name, name]))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: 'ErrorNotice' }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const imported = evaluate(source, mockRequire, { api })
  const render = () => { cursor = 0; return imported.default({ onComplete: api.onComplete }) }
  return { render, states, effects }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
async function snapshot(source, { exists, setup, rejectExists = false, rejectSetup = false }) {
  const calls = []
  let completions = 0
  const api = {
    admin: {
      exists: async (...args) => { calls.push(['exists', ...args]); if (rejectExists) throw new Error('offline'); return exists },
      setup: async (...args) => { calls.push(['setup', ...args]); if (rejectSetup) throw new Error('setup offline'); return setup }
    },
    onComplete() { completions++ }
  }
  const runtime = importComponent(source, api)
  let tree = runtime.render()
  for (const effect of runtime.effects.splice(0)) effect()
  await flush()
  tree = runtime.render()
  let form = findNode(tree, (node) => node.type === 'form')
  if (form) {
    for (const [placeholder, value] of [
      ['e.g. Botswapelo', 'Botswapelo'],
      ['your@email.com', 'support@example.test'],
      ['Strong password...', 'long-enough-password'],
      ['Repeat password...', 'long-enough-password']
    ]) {
      const input = findAllNodes(tree, (node) => node.type === 'input').find((node) => node.props.placeholder === placeholder)
      input.props.onChange({ target: { value } })
      tree = runtime.render()
    }
    form = findNode(tree, (node) => node.type === 'form')
    await form.props.onSubmit({ preventDefault() {} })
    tree = runtime.render()
  }
  return { calls, completions, states: runtime.states, tree }
}

test('actual MasterSetup import preserves producer-backed admin replies and form behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  for (const options of [
    { exists: true },
    { exists: false, setup: { success: true, id: 'admin-id' } },
    { exists: false, setup: { success: false, error: 'already exists' } },
    { exists: false, setup: { success: false, error: { message: 'raw provider error' } } },
    { exists: false, rejectSetup: true },
    { exists: false, rejectExists: true }
  ]) {
    const oldState = await snapshot(before, options)
    const newState = await snapshot(current, options)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.equal(newState.completions, oldState.completions)
    assert.deepEqual(newState.states, oldState.states)
  }
  const created = await snapshot(current, { exists: false, setup: { success: true, id: 'admin-id' } })
  assert.deepEqual(created.calls, [['exists'], ['setup', 'Botswapelo', 'support@example.test', 'long-enough-password']])
  assert.equal(created.completions, 1)
})
