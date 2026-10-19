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
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-14/SubscriptionRequests-before-unknown-rpc-rows-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importComponent(source, rpcResult) {
  const states = []
  const effects = []
  let calls = 0
  let hook = 0
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial) {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback },
    useRef(initial) { return { current: initial } }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: react.Fragment
  }
  const icon = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === './shared/Toast') return { useToast: () => ({ success() {}, error() {} }) }
    if (specifier === '../utils/timeAgo') return { timeAgo: () => 'just now' }
    if (specifier === '../../../shared/subscriptionRequest') return { SUBSCRIPTION_REQUEST_STATUS: {}, normalizePlanName: (value) => value }
    if (specifier === '../../../shared/enterpriseAddons') return { ENTERPRISE_ADDON_CATALOG: [] }
    if (specifier === '../../../shared/commercialEntitlements') return { getCommercialAddon: () => null }
    if (specifier === './shared/DarkConfirmDialog') return { DarkConfirmDialog: icon }
    return new Proxy({ default: icon }, { get: (target, key) => key in target ? target[key] : icon })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const window = { api: { subscriptionRequests: { getAll: async () => { calls += 1; return rpcResult } } } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, window)
  return {
    states,
    get calls() { return calls },
    render() { hook = 0; effects.length = 0; return module.exports.default({ licenses: [] }) },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

async function observed(source, response) {
  const runtime = importComponent(source, response)
  runtime.render()
  await runtime.load()
  let error = null
  try { runtime.render() } catch (caught) { error = [caught.name, caught.message] }
  return { states: runtime.states, error, calls: runtime.calls }
}

test('actual SubscriptionRequests import preserves producer envelope and raw row outcomes', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/SubscriptionRequests.jsx'))
  const validRows = [{ id: 'fictional-request-1', status: 'submitted', company_name: 'Example Lodge', requested_plan: 'Starter' }]
  for (const response of [
    { rows: validRows, total: 1 },
    { rows: [null], total: '1' },
    { rows: { malformed: true }, total: 1 },
    { rows: null, total: null }
  ]) {
    const oldOutcome = await observed(before, response)
    const newOutcome = await observed(current, response)
    assert.equal(oldOutcome.calls, 1)
    assert.equal(newOutcome.calls, 1)
    assert.deepEqual(newOutcome.error, oldOutcome.error)
    assert.deepEqual(newOutcome.states[0], oldOutcome.states[0])
    assert.deepEqual(newOutcome.states[1], oldOutcome.states[1])
    if (response.rows) {
      assert.equal(newOutcome.states[0], response.rows)
      assert.equal(oldOutcome.states[0], response.rows)
    } else {
      assert.deepEqual(newOutcome.states[0], [])
      assert.deepEqual(oldOutcome.states[0], [])
    }
    assert.equal(newOutcome.states[1], response.total || 0)
    assert.equal(oldOutcome.states[1], response.total || 0)
  }
  assert.match(current, /@typedef \{\{ rows: unknown\[\], total: unknown \}\} SubscriptionRequestPage/)
  assert.match(current, /useState\(\/\*\* @type \{unknown\[\]\} \*\/ \(\[\]\)\)/)
  assert.match(current, /useState\(\/\*\* @type \{unknown\} \*\/ \(null\)\)/)
})
