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

function importReleaseControl(source, result) {
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
    if (specifier === './shared/Pagination') return { default: stub, usePagination: (items) => ({ page: 1, setPage: () => {}, totalPages: 1, paginated: items }) }
    return new Proxy({ default: stub }, { get: (target, key) => key in target ? target[key] : stub })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, {
    api: { admin: { getScheduledReleases: async () => result, expireOverdueFeatures: async () => ({ ok: true, count: 0 }) } }
  })
  return {
    states,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

async function outcome(source, result) {
  const runtime = importReleaseControl(source, result)
  runtime.render()
  await runtime.load()
  const rows = runtime.states[0]
  let error = null
  try { runtime.render() } catch (caught) { error = caught }
  return { rows, error: error ? [error.name, error.message] : null }
}

test('actual ReleaseControl import preserves raw RPC values and malformed-row outcomes', async () => {
  const before = readFileSync(resolve(evidence, 'workerA-ReleaseControl-before-scheduled-rows-unknown-2026-10-15.jsx.txt'), 'utf8')
  const current = readFileSync(resolve(repoRoot, 'src/renderer/src/components/ReleaseControl.jsx'), 'utf8')
  const cases = [null, false, 0, '', 'truthy raw result', { rows: [] }, [null], [{ status: 'active', lodge_id: 'lodge', feature_name: 'feature' }]]
  for (const result of cases) {
    const oldOutcome = await outcome(before, result)
    const newOutcome = await outcome(current, result)
    if (result) assert.equal(newOutcome.rows, oldOutcome.rows)
    else assert.deepEqual(newOutcome.rows, oldOutcome.rows)
    assert.deepEqual(newOutcome.error, oldOutcome.error)
    if (result) assert.equal(newOutcome.rows, result)
    else assert.deepEqual(newOutcome.rows, [])
  }
})
