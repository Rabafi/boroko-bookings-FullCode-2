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

function importPromoCodes(source, api) {
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
  const toast = { success() {}, error() {}, info() {} }
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === '../app-context') return { useSettings: () => ({ settings: {} }) }
    if (specifier === './shared/Toast') return { useToast: () => toast }
    return new Proxy({ default: stub, Modal: stub, ConfirmDialog: stub, ErrorNotice: stub }, {
      get: (target, key) => key in target ? target[key] : stub
    })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    states,
    render() { hook = 0; effects.length = 0; return module.exports.default() },
    async load() {
      for (const effect of effects) effect()
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
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

async function loaded(source, getAll, getRoomTypes, validate = async () => null) {
  const runtime = importPromoCodes(source, { promoCodes: { getAll, validate }, roomTypes: { getAll: getRoomTypes } })
  runtime.render()
  await runtime.load()
  return runtime
}

test('actual PromoCodes import preserves malformed RPC rows and validation results', async () => {
  const before = read(resolve(evidence, 'L02-preimages-workerA-2026-10-14/PromoCodes-before-raw-rpc-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PromoCodes.jsx'))
  const rawCodes = [{ id: 17, code: ['odd'], discount_value: { cents: 2 }, active: true }, null]
  const rawRooms = [null]
  const getAll = async () => rawCodes
  const getRoomTypes = async () => rawRooms
  const validCodes = [{ id: 'promo-1', code: 'SUMMER', discount_type: 'percentage', discount_value: 10, active: true }]
  const validRooms = [{ id: 'room-1', name: 'Deluxe' }]
  const validOld = await loaded(before, async () => validCodes, async () => validRooms)
  const validNew = await loaded(current, async () => validCodes, async () => validRooms)
  assert.equal(validOld.states[0], validCodes)
  assert.equal(validNew.states[0], validCodes)
  assert.equal(validOld.states[1], validRooms)
  assert.equal(validNew.states[1], validRooms)
  assert.doesNotThrow(() => validOld.render())
  assert.doesNotThrow(() => validNew.render())

  const oldRows = await loaded(before, getAll, getRoomTypes)
  const newRows = await loaded(current, getAll, getRoomTypes)
  assert.equal(oldRows.states[0], rawCodes)
  assert.equal(newRows.states[0], rawCodes)
  assert.equal(oldRows.states[1], rawRooms)
  assert.equal(newRows.states[1], rawRooms)
  assert.throws(() => oldRows.render(), TypeError)
  assert.throws(() => newRows.render(), TypeError)

  const result = { valid: 'truthy', discount_type: 9, discount_value: { raw: true }, extra: ['kept'] }
  const runValidation = async (source) => {
    const runtime = await loaded(source, async () => [], async () => [], async () => result)
    runtime.states[4] = true
    runtime.states[11] = 'RAW'
    const tree = runtime.render()
    const button = findElement(tree, (node) => node.type === 'button' && node.props.className === 'btn-primary w-full')
    assert.ok(button, 'validation action is rendered')
    await button.props.onClick()
    assert.equal(runtime.states[14], result)
    return runtime.states[14]
  }
  assert.equal(await runValidation(before), result)
  assert.equal(await runValidation(current), result)
  for (const name of ['codes', 'roomTypes']) {
    assert.ok(current.includes(`const [${name}, set${name[0].toUpperCase()}${name.slice(1)}] = useState(/** @type {unknown[]} */ ([]))`))
  }
  assert.match(current, /const \[validationResult, setValidationResult\] = useState\(\/\*\* @type \{unknown\} \*\/ \(null\)\)/)
})
