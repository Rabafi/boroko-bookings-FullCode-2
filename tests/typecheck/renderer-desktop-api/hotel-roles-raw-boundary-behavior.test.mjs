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

function loadActualComponent(source, api) {
  const states = []
  const effects = []
  let hook = 0
  const react = {
    useState(initial) {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: Symbol.for('react.fragment')
  }
  const componentStub = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    return new Proxy({ default: componentStub }, { get: (target, key) => key in target ? target[key] : componentStub })
  }
  const output = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', output)(mockRequire, module, module.exports, { api })
  return {
    states,
    effectsForTest: effects,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async runEffects() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
      await Promise.resolve()
    }
  }
}

function findElement(root, predicate) {
  if (!root || typeof root !== 'object') return null
  if (predicate(root)) return root
  const children = root.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

test('actual HotelRolesConfig import preserves raw template and capability rows', async () => {
  const before = readFileSync(resolve(evidence, 'workerA-HotelRolesConfig-before-unknown-rows-2026-10-15.jsx.txt'), 'utf8')
  const current = readFileSync(resolve(repoRoot, 'src/renderer/src/components/HotelRolesConfig.jsx'), 'utf8')
  const templates = [{ id: 'role-1', role_key: 'front_office', role_name: 'Front office', category: 'front_office' }]
  const capabilities = ['bookings.view', null]
  const run = async (source) => {
    const calls = []
    const api = { hotelRoles: {
      getTemplates: async () => templates,
      getRoleCapabilities: async (roleKey) => { calls.push(roleKey); return capabilities }
    } }
    const runtime = loadActualComponent(source, api)
    runtime.render()
    for (const effect of runtimeEffects(runtime)) effect()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(runtime.states[0], templates)
    const tree = runtime.render()
    const button = findElement(tree, (element) => element.type === 'button' && element.props.className?.includes('w-full text-left p-3'))
    assert.ok(button, 'actual component rendered a role-template action')
    await button.props.onClick()
    assert.equal(runtime.states[2], capabilities)
    assert.deepEqual(calls, ['front_office'])
    return { templates: runtime.states[0], capabilities: runtime.states[2], calls }
  }
  function runtimeEffects(runtime) { return runtime.effectsForTest }
  const beforeResult = await run(before)
  const currentResult = await run(current)
  assert.deepEqual(currentResult, beforeResult)
  assert.equal(currentResult.templates, templates)
  assert.equal(currentResult.capabilities, capabilities)
})

test('HotelRolesConfig preserves the existing nonarray fallback', async () => {
  const current = readFileSync(resolve(repoRoot, 'src/renderer/src/components/HotelRolesConfig.jsx'), 'utf8')
  for (const value of [null, 'raw', { data: [] }]) {
    const runtime = loadActualComponent(current, { hotelRoles: { getTemplates: async () => value } })
    runtime.render()
    for (const effect of runtime.effectsForTest) effect()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(runtime.states[0], [])
  }
})

test('actual HotelRolesConfig import preserves malformed template rows and render failure', async () => {
  const before = readFileSync(resolve(evidence, 'workerA-HotelRolesConfig-before-unknown-rows-2026-10-15.jsx.txt'), 'utf8')
  const current = readFileSync(resolve(repoRoot, 'src/renderer/src/components/HotelRolesConfig.jsx'), 'utf8')
  const rows = [null]
  const renderWithRows = async (source) => {
    const runtime = loadActualComponent(source, { hotelRoles: { getTemplates: async () => rows } })
    runtime.render()
    for (const effect of runtime.effectsForTest) effect()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(runtime.states[0], rows)
    let error
    try { runtime.render() } catch (caught) { error = caught }
    assert.ok(error instanceof TypeError)
    return { row: runtime.states[0][0], error: [error.name, error.message] }
  }
  const beforeResult = await renderWithRows(before)
  const currentResult = await renderWithRows(current)
  assert.equal(currentResult.row, rows[0])
  assert.deepEqual(currentResult.error, beforeResult.error)
})
