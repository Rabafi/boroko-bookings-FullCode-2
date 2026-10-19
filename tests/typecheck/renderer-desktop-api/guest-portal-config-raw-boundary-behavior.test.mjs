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
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-14/GuestPortalConfig-before-raw-config-state-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importComponent(source, configValue, requestOutcome) {
  const states = []
  const effects = []
  let hook = 0
  const react = {
    Fragment: Symbol.for('react.fragment'),
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
    Fragment: react.Fragment
  }
  const icon = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return new Proxy({}, { get: () => icon })
    if (specifier === './shared/Modal') return { Modal: icon }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: icon }
    return new Proxy({ default: icon }, { get: (target, key) => key in target ? target[key] : icon })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const api = { guestPortal: {
    getConfig: async () => configValue,
    getPendingRequests: async () => {
      if (requestOutcome instanceof Error) throw requestOutcome
      return requestOutcome
    },
    updateConfig: async () => ({ success: true })
  } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    states,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

async function outcome(source, configValue, requestOutcome) {
  const runtime = importComponent(source, configValue, requestOutcome)
  runtime.render()
  await runtime.load()
  let error = null
  try { runtime.render() } catch (caught) { error = [caught.name, caught.message] }
  return { states: runtime.states, error }
}

test('actual GuestPortalConfig import preserves unvalidated config and cached-request behavior', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/GuestPortalConfig.jsx'))
  const validConfig = { portal_enabled: true, allowed_actions: ['view_booking'], branding: { logo_url: '', colors: {}, terms_text: '' }, required_upload_fields: ['passport'] }
  const validRequests = [{ id: 'fictional-request-1', status: 'pending', message: 'example' }]
  const staleError = Object.assign(new Error('fictional offline'), { cached: [null] })
  for (const [config, requests] of [
    [validConfig, validRequests],
    [{ portal_enabled: 'enabled', allowed_actions: 'malformed', branding: 'raw-branding', required_upload_fields: [null] }, [null]],
    [{ portal_enabled: 0, allowed_actions: null, branding: { colors: null }, required_upload_fields: 'raw-fields' }, { cached: 'raw-cache' }],
    [null, staleError]
  ]) {
    const oldResult = await outcome(before, config, requests)
    const newResult = await outcome(current, config, requests)
    assert.deepEqual(newResult.error, oldResult.error)
    assert.deepEqual(newResult.states, oldResult.states)
    assert.equal(newResult.states[0], oldResult.states[0])
    assert.equal(newResult.states[5], oldResult.states[5])
  }
  assert.match(current, /@type \{unknown\} \*\/ \(null\)/)
  assert.match(current, /@type \{unknown\[\]\} \*\/ \(\['view_booking'\]\)/)
})
