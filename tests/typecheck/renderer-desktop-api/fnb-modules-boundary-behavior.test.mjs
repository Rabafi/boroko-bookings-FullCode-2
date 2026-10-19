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
const preimage = resolve(evidence, 'L02-preimages-workerA-2026-10-15/useFnbModules-before-module-result-view-2026-10-15.js.txt')
const read = (path) => readFileSync(path, 'utf8')

function evaluateModule(source, mockRequire = () => { throw new Error('Unexpected import') }, windowValue = {}) {
  const code = esbuild.transformSync(source, { loader: 'js', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}

function importHook(source, api) {
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
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback }
  }
  const fnbModules = evaluateModule(read(resolve(repoRoot, 'src/shared/fnbModules.js')))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === '../../../shared/fnbModules.js') return fnbModules
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const imported = evaluateModule(source, mockRequire, { api })
  let value
  const render = () => { hook = 0; value = imported.useFnbModules(); return value }
  return {
    states,
    render,
    async load() {
      render()
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      render()
      return value
    },
    module: imported
  }
}

async function snapshot(source, options) {
  const calls = []
  const api = { fnb: {
    getCachedModulePreferences: async () => { calls.push('cached'); return options.cached ?? [] },
    getModulePreferences: async () => {
      calls.push('server')
      if (options.reject) throw options.reject
      return options.envelope
    },
    setModulePreference: async (...args) => { calls.push(['set', ...args]); return options.mutationResult }
  } }
  const runtime = importHook(source, api)
  const value = await runtime.load()
  return { calls, modules: runtime.states[0], loading: runtime.states[1], offline: runtime.states[2], error: runtime.states[3], value, runtime }
}

test('actual useFnbModules import preserves the constructed envelope and raw preference results', async () => {
  const before = read(preimage)
  const current = read(resolve(repoRoot, 'src/renderer/src/hooks/useFnbModules.js'))
  const rows = [
    { module_key: 'reservations', enabled: true, entitled: true, can_manage: true, version: 4 },
    null,
    'malformed preference row',
    { module_key: 'recipes', enabled: true, entitled: false, can_manage: true, reason: 'not_entitled', version: '9' }
  ]
  const serverEnvelope = { success: true, lodge_id: 'fictional-lodge-1', modules: rows, source: 'server' }
  const cachedEnvelope = { success: true, lodge_id: 'fictional-lodge-1', modules: rows, source: 'cache', offline: true }

  for (const envelope of [serverEnvelope, cachedEnvelope, { success: false, error: 'fictional malformed envelope' }, null, 'malformed-envelope', undefined]) {
    const oldResult = await snapshot(before, { envelope, cached: rows })
    const newResult = await snapshot(current, { envelope, cached: rows })
    assert.deepEqual(newResult.calls, oldResult.calls)
    assert.deepEqual(newResult.modules, oldResult.modules)
    assert.equal(newResult.loading, oldResult.loading)
    assert.equal(newResult.offline, oldResult.offline)
    assert.equal(newResult.error, oldResult.error)
    assert.deepEqual(newResult.value.preferenceMap, oldResult.value.preferenceMap)
    if (envelope?.modules) {
      assert.equal(newResult.modules, rows)
      assert.equal(oldResult.modules, rows)
    }
  }

  const oldFallback = await snapshot(before, { reject: new Error('fictional offline'), cached: rows })
  const newFallback = await snapshot(current, { reject: new Error('fictional offline'), cached: rows })
  assert.deepEqual(newFallback.calls, oldFallback.calls)
  assert.equal(newFallback.modules, rows)
  assert.equal(oldFallback.modules, rows)
  assert.equal(newFallback.offline, true)
  assert.equal(newFallback.error, oldFallback.error)

  const mutationResult = { success: true, opaque_rpc_field: { retained: true } }
  const oldMutation = await snapshot(before, { envelope: serverEnvelope, cached: rows, mutationResult })
  const newMutation = await snapshot(current, { envelope: serverEnvelope, cached: rows, mutationResult })
  const oldReturned = await oldMutation.value.setPreference('reservations', false, 4)
  const newReturned = await newMutation.value.setPreference('reservations', false, 4)
  assert.equal(oldReturned, mutationResult)
  assert.equal(newReturned, mutationResult)
  assert.deepEqual(newMutation.calls, oldMutation.calls)
  assert.deepEqual(newMutation.modules, oldMutation.modules)
  assert.deepEqual(newMutation.error, oldMutation.error)
})
