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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/StaffProductivityPanel-before-raw-boundaries-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importPanel(source, api) {
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
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: Symbol.for('react.fragment')
  }
  const stub = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return { BarChart3: stub, RefreshCw: stub }
    if (specifier === '../../app-context') return { useAccess: () => ({}), useSettings: () => ({ settings: {} }) }
    if (specifier === '../../../../shared/productIdentity') return {
      getProductDefinition: () => ({ brandName: 'Test product', name: 'Test product' }),
      getRuntimeProductId: () => 'fictional-test-product'
    }
    if (specifier === '../../../../shared/uiVocabulary') return {
      getUiVocabulary: () => ({ nounTitle: 'team', theNoun: 'the team', noun: 'team' })
    }
    if (specifier === '../../../../shared/accessControl') return { canAccessCapability: () => true }
    if (specifier === './ErrorNotice') return { ErrorNotice: stub }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    module: module.exports,
    states,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

async function loaded(source, response, shouldReject = false) {
  const calls = []
  const api = {
    staffOperations: {
      getStaffProductivityDashboard: async (...args) => {
        calls.push(args)
        if (shouldReject) throw response
        return response
      }
    }
  }
  const runtime = importPanel(source, api)
  runtime.render()
  await runtime.load()
  runtime.render()
  return { calls, error: runtime.states[4], data: runtime.states[2], loading: runtime.states[3], module: runtime.module }
}

test('actual StaffProductivityPanel import preserves raw dashboard and rollup behavior', async () => {
  const before = read(preimagePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/shared/StaffProductivityPanel.jsx'))
  const summary = { total_tasks: 3, on_time_tasks: 2, avg_rating: 4.5, staff_count: 1 }
  const metrics = [{ staff_id: 'fictional-staff-1', staff_name: 'Example staff', tasks_completed: 3, tasks_on_time: 2, incidents: 0, avg_completion_time_minutes: 10, rating: 4.5 }]

  for (const response of [
    { metrics, summary },
    { metrics: [null, 'malformed-row', { tasks_completed: '2', staff_name: 7 }], summary },
    { metrics: 'malformed-metrics-container', summary: [] },
    { metrics: null, summary: null },
    null,
    'unvalidated-dashboard-response',
    false,
    { success: false, error: 'fictional unavailable' }
  ]) {
    const oldResult = await loaded(before, response)
    const newResult = await loaded(current, response)
    assert.deepEqual(newResult.calls, oldResult.calls)
    assert.deepEqual(newResult.error, oldResult.error)
    assert.deepEqual(newResult.data, oldResult.data)
    assert.equal(newResult.loading, oldResult.loading)
    if (response?.metrics && Array.isArray(response.metrics)) {
      assert.equal(newResult.data.metrics, response.metrics)
      assert.equal(oldResult.data.metrics, response.metrics)
    }
    if (response?.summary && typeof response.summary === 'object') {
      assert.equal(newResult.data.summary, response.summary)
      assert.equal(oldResult.data.summary, response.summary)
    }
  }

  for (const rejection of [new Error('fictional rejected request'), 'non-error rejection', null]) {
    const oldResult = await loaded(before, rejection, true)
    const newResult = await loaded(current, rejection, true)
    assert.deepEqual(newResult.error, oldResult.error)
    assert.deepEqual(newResult.data, oldResult.data)
    assert.equal(newResult.loading, oldResult.loading)
  }

  for (const rows of [
    metrics,
    [null, 'primitive row', { staff_id: 7, staff_name: '  Example  ', tasks_completed: '2', tasks_on_time: 8, rating: null }],
    { not: 'an array' },
    null
  ]) {
    const oldRollup = importPanel(before, {}).module.rollupStaffProductivity(rows)
    const newRollup = importPanel(current, {}).module.rollupStaffProductivity(rows)
    assert.deepEqual(newRollup, oldRollup)
  }
})
