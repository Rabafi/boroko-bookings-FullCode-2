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
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-14/GuestCRM-before-unknown-search-rows-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importComponent(source, searchResult) {
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
    if (specifier === './shared/ConfirmDialog') return { ConfirmDialog: icon }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: icon }
    if (specifier === '../app-context') return { useAccess: () => ({}) }
    if (specifier === '../../../shared/accessControl') return { canAccessCapability: () => false }
    return new Proxy({ default: icon }, { get: (target, key) => key in target ? target[key] : icon })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const calls = []
  const api = { guestCRM: { search: async (query) => { calls.push(query); return searchResult } } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    states,
    calls,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async search() {
      const findInput = (node) => {
        if (!node || typeof node !== 'object') return null
        const props = node.props || {}
        if (props.placeholder === 'Search guests by name, email, or phone...') return props.onChange
        for (const child of Array.isArray(props.children) ? props.children : [props.children]) {
          const found = findInput(child)
          if (found) return found
        }
        return null
      }
      const change = findInput(this.render())
      assert.equal(typeof change, 'function')
      change({ target: { value: 'fictional search' } })
      const findSearch = (node) => {
        if (!node || typeof node !== 'object') return null
        const props = node.props || {}
        const children = Array.isArray(props.children) ? props.children : [props.children]
        if (node.type === 'button' && children.some((child) => typeof child === 'string' && child.trim() === 'Search')) return props.onClick
        for (const child of children) {
          const found = findSearch(child)
          if (found) return found
        }
        return null
      }
      const click = findSearch(this.render())
      assert.equal(typeof click, 'function')
      await click()
      let error = null
      try { this.render() } catch (caught) { error = [caught.name, caught.message] }
      return error
    }
  }
}

test('actual GuestCRM import preserves raw search-row rendering outcomes', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/GuestCRM.jsx'))
  for (const response of [
    [{ customer_id: 'fictional-guest-1', name: 'Example Guest', vip_level: 'standard', lifetime_value: 25 }],
    [null],
    { results: [{ malformed: true }] },
    'raw-rpc-value'
  ]) {
    const oldRuntime = importComponent(before, response)
    const newRuntime = importComponent(current, response)
    const oldError = await oldRuntime.search()
    const newError = await newRuntime.search()
    assert.deepEqual(newError, oldError)
    assert.deepEqual(newRuntime.calls, ['fictional search'])
    assert.deepEqual(newRuntime.calls, oldRuntime.calls)
    assert.deepEqual(newRuntime.states, oldRuntime.states)
    if (Array.isArray(response)) assert.equal(newRuntime.states[1], response)
    else assert.deepEqual(newRuntime.states[1], [])
  }
  assert.match(current, /@type \{unknown\[\]\} \*\/ \(\[\]\)/)
  assert.match(current, /@type \{unknown\} \*\/ \(null\)/)
})
