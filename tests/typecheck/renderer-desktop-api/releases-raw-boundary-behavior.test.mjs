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
const read = (path) => readFileSync(path, 'utf8')

function importTabs(source, api) {
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
  const stub = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === './shared/Pagination') return {
      default: stub,
      usePagination(items, pageSize = 25) {
        const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
        const paginated = items.slice(0, pageSize)
        return { page: 1, setPage() {}, totalPages, paginated }
      }
    }
    if (specifier === './shared/Toast') return { useToast: () => ({ success() {}, error() {}, info() {} }) }
    return new Proxy({ default: stub, ErrorNotice: stub, DarkConfirmDialog: stub }, {
      get: (target, key) => key in target ? target[key] : stub
    })
  }
  // Export instrumentation exposes the two production tab functions for focused
  // imports; their function bodies and expressions remain unchanged.
  const exposed = source
    .replace('function FeaturesTab()', 'export function FeaturesTab()')
    .replace('function AppVersionsTab()', 'export function AppVersionsTab()')
  const code = esbuild.transformSync(exposed, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    module: module.exports,
    states,
    render(component) { hook = 0; effects.length = 0; return component() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

async function outcome(source, componentName, result, methodName) {
  const api = { admin: {
    getScheduledReleases: async () => result,
    getReleases: async () => result,
    expireOverdueFeatures: async () => ({ ok: true, count: 0 })
  } }
  const runtime = importTabs(source, api)
  const component = runtime.module[componentName]
  runtime.render(component)
  await runtime.load()
  const stored = runtime.states[componentName === 'FeaturesTab' ? 1 : 0]
  let error = null
  try { runtime.render(component) } catch (caught) { error = [caught.name, caught.message] }
  return { stored, error, methodName }
}

test('actual Releases tab imports preserve raw scheduled and app-version RPC outcomes', async () => {
  const before = read(resolve(evidence, 'L02-preimages-workerA-2026-10-14/Releases-before-raw-release-rows-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/Releases.jsx'))
  const scheduledValues = [null, false, 0, '', 'raw', { rows: [] }, [null], [{ status: 'active', lodge_id: 'lodge', feature_name: 'feature' }]]
  for (const value of scheduledValues) {
    const oldOutcome = await outcome(before, 'FeaturesTab', value, 'getScheduledReleases')
    const newOutcome = await outcome(current, 'FeaturesTab', value, 'getScheduledReleases')
    if (value) assert.equal(newOutcome.stored, oldOutcome.stored)
    else assert.deepEqual(newOutcome.stored, oldOutcome.stored)
    assert.deepEqual(newOutcome.error, oldOutcome.error)
    if (value) assert.equal(newOutcome.stored, value)
    else assert.deepEqual(newOutcome.stored, [])
  }

  const appValues = [null, false, 'raw', { rows: [] }, [null], [{ version: 17, status: ['draft'], extra: true }], [{ id: 'release-1', version: '1.0.0', status: 'full', channel: 'stable', rollout_pct: 100, created_at: '2026-01-01' }]]
  for (const value of appValues) {
    const oldOutcome = await outcome(before, 'AppVersionsTab', value, 'getReleases')
    const newOutcome = await outcome(current, 'AppVersionsTab', value, 'getReleases')
    if (Array.isArray(value)) assert.equal(newOutcome.stored, oldOutcome.stored)
    else assert.deepEqual(newOutcome.stored, oldOutcome.stored)
    assert.deepEqual(newOutcome.error, oldOutcome.error)
    if (Array.isArray(value)) assert.equal(newOutcome.stored, value)
    else assert.deepEqual(newOutcome.stored, [])
  }
  assert.match(current, /const \[releases, setReleases\] = useState\(\/\*\* @type \{unknown\} \*\/ \(\[\]\)\)/)
  assert.match(current, /const \[releases, setReleases\] = useState\(\/\*\* @type \{unknown\[\]\} \*\/ \(\[\]\)\)/)
})
