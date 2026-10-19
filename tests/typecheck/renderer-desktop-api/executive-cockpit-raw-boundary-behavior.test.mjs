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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/ExecutiveCockpit-before-current-caller-slice-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/ExecutiveCockpit.jsx')
const safeLoadPath = resolve(repoRoot, 'src/renderer/src/utils/safeLoad.js')
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
    useEffect(effect) { effects.push(effect) },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const iconNames = ['BarChart3', 'TrendingUp', 'TrendingDown', 'AlertTriangle', 'Clock', 'DollarSign', 'Users', 'Server', 'LifeBuoy', 'Bell', 'Building2', 'Rocket', 'CheckCircle', 'XCircle', 'ArrowUpRight']
  const icons = Object.fromEntries(iconNames.map((name) => [name, name]))
  const safeLoad = evaluate(read(safeLoadPath), (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`Unexpected safeLoad import: ${specifier}`)
  }, {})
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === '../utils/safeLoad') return safeLoad
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const imported = evaluate(source, mockRequire, { api })
  const props = { companies: [], licenses: [], tickets: [], activityLogs: [] }
  const render = () => { cursor = 0; return imported.default(props) }
  return { render, states, effects }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
async function snapshot(source, options) {
  const calls = []
  const api = { admin: {
    getInvoices: async (...args) => { calls.push(['invoices', ...args]); if (options.reject?.invoices) throw options.reject.invoices; return options.invoices },
    getExpenses: async (...args) => { calls.push(['expenses', ...args]); if (options.reject?.expenses) throw options.reject.expenses; return options.expenses },
    getMarketingLeads: async (...args) => { calls.push(['leads', ...args]); if (options.reject?.leads) throw options.reject.leads; return options.leads },
    getFleetHealthSummary: async (...args) => { calls.push(['fleet', ...args]); if (options.reject?.fleet) throw options.reject.fleet; return options.fleet }
  } }
  const runtime = importComponent(source, api)
  let tree = runtime.render()
  for (const effect of runtime.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = runtime.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls, states: runtime.states, tree, renderError }
}

test('actual ExecutiveCockpit import preserves guarded container and raw row behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const invoices = [{ id: 'invoice-1', status: 'paid', amount: '75.00', paid_date: '2026-10-14' }]
  const expenses = [{ id: 'expense-1', amount: 12, date: '2026-10-14' }]
  const leads = [{ id: 'lead-1', status: 'new' }]
  for (const options of [
    { invoices, expenses, leads, fleet: { total_devices: 3, stale_devices: 1, failed_devices: 0, healthy_devices: 2 } },
    { invoices: [null], expenses: ['malformed-row'], leads: [null], fleet: null },
    { invoices: ['malformed-row'], expenses: [null], leads: [{ status: 'converted' }], fleet: 'malformed-summary' },
    { invoices: { rows: invoices }, expenses: null, leads: { leads: { truthy: true } }, fleet: 7 },
    { invoices: null, expenses: undefined, leads: null, fleet: undefined },
    { reject: { invoices: new Error('invoices offline'), expenses: new Error('expenses offline'), leads: new Error('leads offline'), fleet: new Error('fleet offline') } }
  ]) {
    const oldState = await snapshot(before, options)
    const newState = await snapshot(current, options)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states, oldState.states)
    assert.equal(newState.renderError, oldState.renderError)
  }
  const oldRows = await snapshot(before, { invoices, expenses, leads, fleet: {} })
  const newRows = await snapshot(current, { invoices, expenses, leads, fleet: {} })
  assert.equal(oldRows.states[0], invoices)
  assert.equal(newRows.states[0], invoices)
  assert.equal(oldRows.states[1], expenses)
  assert.equal(newRows.states[1], expenses)
})
