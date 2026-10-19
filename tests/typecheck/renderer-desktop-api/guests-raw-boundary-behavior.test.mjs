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

function importGuests(source, api) {
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
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback },
    useRef(initial) { return { current: initial } }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: react.Fragment
  }
  const stub = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'react-router') return { useNavigate: () => () => {} }
    if (specifier === '../app-context') return { useAccess: () => ({}), useSettings: () => ({ settings: {} }) }
    return new Proxy({ default: stub, Modal: stub, ErrorNotice: stub }, {
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

async function outcome(source, customerRows, creditPageRows) {
  const api = {
    customers: { getAll: async () => customerRows },
    customerCredit: { getSummary: async () => creditPageRows }
  }
  const runtime = importGuests(source, api)
  runtime.render()
  await runtime.load()
  let error = null
  try { runtime.render() } catch (caught) { error = [caught.name, caught.message] }
  return { runtime, error }
}

test('actual Guests import preserves raw customer and credit-summary boundary outcomes', async () => {
  const before = read(resolve(evidence, 'L02-preimages-workerA-2026-10-14/Guests-before-unknown-customer-credit-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/Guests.jsx'))
  const validCustomers = [{ id: 'fictional-guest-1', name: 'Example Guest', phone: '', email: '', is_blacklisted: false }]
  const validCreditRows = [{ customer_id: 'fictional-guest-1', balance: 3, _confirmed_balance: true }]
  const oldValid = await outcome(before, validCustomers, validCreditRows)
  const newValid = await outcome(current, validCustomers, validCreditRows)
  assert.deepEqual(newValid.error, oldValid.error)
  assert.equal(newValid.runtime.states[0], validCustomers)
  assert.equal(oldValid.runtime.states[0], validCustomers)
  assert.deepEqual(newValid.runtime.states[1], oldValid.runtime.states[1])

  for (const customers of [[null], { rows: [] }]) {
    const oldResult = await outcome(before, customers, [null])
    const newResult = await outcome(current, customers, [null])
    assert.deepEqual(newResult.error, oldResult.error)
    assert.equal(newResult.runtime.states[0], customers)
    assert.equal(oldResult.runtime.states[0], customers)
    assert.ok(newResult.runtime.states[1].includes(null))
    assert.ok(oldResult.runtime.states[1].includes(null))
  }

  for (const creditPage of [null, 'unvalidated-credit-response', { success: false, error: 'fictional failure' }]) {
    const oldResult = await outcome(before, validCustomers, creditPage)
    const newResult = await outcome(current, validCustomers, creditPage)
    assert.deepEqual(newResult.error, oldResult.error)
    assert.deepEqual(newResult.runtime.states[1], oldResult.runtime.states[1])
    assert.deepEqual(newResult.runtime.states[1], [])
  }

  assert.match(current, /const \[customers, setCustomers\] = useState\(\/\*\* @type \{unknown\} \*\/ \(\[\]\)\)/)
  assert.match(current, /const \[creditSummary, setCreditSummary\] = useState\(\/\*\* @type \{unknown\[\]\} \*\/ \(\[\]\)\)/)
  assert.match(current, /const \[history, setHistory\]\s*= useState\(\/\*\* @type \{unknown\} \*\/ \(\[\]\)\)/)
  assert.match(current, /const \[editingCustomer, setEditingCustomer\] = useState\(\/\*\* @type \{unknown\} \*\/ \(null\)\)/)
})
