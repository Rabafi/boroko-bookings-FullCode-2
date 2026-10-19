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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/DayUse-before-unvalidated-entry-arrays-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/DayUse.jsx')
const read = (path) => readFileSync(path, 'utf8')
function evaluate(source, mockRequire, api) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return module.exports
}
function loadEsm(path) {
  const source = read(path)
  return evaluate(source, () => { throw new Error('Unexpected helper import') }, {})
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
function createRuntime(source, options) {
  const states = []
  const effects = []
  const calls = []
  let cursor = 0
  let statusCallback
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect(effect) { effects.push(effect) },
    useMemo(factory) { return factory() }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const iconNames = ['AlertTriangle', 'Briefcase', 'CheckCircle2', 'ClipboardList', 'CreditCard', 'Download', 'Flame', 'Mail', 'MessageCircle', 'Package', 'Plus', 'Printer', 'Save', 'Search', 'Trash2', 'X']
  const icons = Object.fromEntries(iconNames.map((name) => [name, name]))
  const helpers = {
    '../constants/paymentMethods': loadEsm(resolve(repoRoot, 'src/renderer/src/constants/paymentMethods.js')),
    '../utils/localDate': loadEsm(resolve(repoRoot, 'src/renderer/src/utils/localDate.js')),
    '../../../shared/dayUseConfig': loadEsm(resolve(repoRoot, 'src/shared/dayUseConfig.js')),
    '../../../shared/dayUseReporting': loadEsm(resolve(repoRoot, 'src/shared/dayUseReporting.js'))
  }
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === '../app-context') return { useSettings: () => ({ settings: { currency: 'P', pool_fee_adult: 25 } }) }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: 'ErrorNotice' }
    if (helpers[specifier]) return helpers[specifier]
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const api = { dayuse: {
    async getConfig() { calls.push(['getConfig']); if (options.rejectConfig) throw new Error('config offline'); return options.config ?? { templates: [], resources: [] } },
    async getInventoryItems() { calls.push(['getInventoryItems']); if (options.rejectInventory) throw new Error('inventory offline'); return options.inventory },
    async getAll(...args) { calls.push(['getAll', ...args]); if (options.rejectEntries) throw new Error('entries offline'); return options.entries },
  }, sync: { onStatusChanged(callback) { calls.push(['subscribe']); statusCallback = callback; return () => calls.push(['unsubscribe']) } } }
  const imported = evaluate(source, mockRequire, api)
  const render = () => { cursor = 0; return imported.default() }
  return { states, effects, calls, render, statusCallback: () => statusCallback }
}
async function snapshot(source, options) {
  const runtime = createRuntime(source, options)
  let tree = runtime.render()
  for (const effect of runtime.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = runtime.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls: runtime.calls, states: runtime.states, tree, renderError }
}

test('actual DayUse import preserves unvalidated entry and inventory response behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const entries = [{ id: 'entry-1', date: '2026-10-15', guest_name: 'Fictional Guest', adults: 1, children: 0, total: 25, extras: [], balance_due: 0, status: 'checked_in', activity_type: 'pool' }]
  const inventory = [{ id: 'stock-1', name: 'Water', current_stock: 5, unit: 'bottle' }]
  for (const options of [
    { entries, inventory },
    { entries: [null], inventory: [null] },
    { entries: ['malformed-entry'], inventory: ['malformed-inventory-row'] },
    { entries: { rows: entries }, inventory: { rows: inventory } },
    { entries: null, inventory: null },
    { rejectEntries: true, rejectInventory: true },
    { entries: undefined, inventory: undefined, rejectConfig: true }
  ]) {
    const oldState = await snapshot(before, options)
    const newState = await snapshot(current, options)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states.slice(0, 3), oldState.states.slice(0, 3))
    assert.equal(newState.renderError, oldState.renderError)
    if (options.entries) assert.equal(newState.states[0], options.entries)
    if (options.inventory) assert.equal(newState.states[1], options.inventory)
  }
})
