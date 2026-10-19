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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/EarlyLateCheckout-before-unvalidated-rpc-arrays-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/EarlyLateCheckout.jsx')
const read = (path) => readFileSync(path, 'utf8')

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
    useEffect(effect) { effects.push(effect) }
  }
  const jsxRuntime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: 'Fragment'
  }
  const icons = Object.fromEntries(['Clock', 'Sun', 'Moon', 'Plus', 'CheckCircle', 'XCircle', 'DollarSign'].map((name) => [name, name]))
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === '../app-context') return { useSettings: () => ({ settings: null }) }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: 'ErrorNotice' }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  const Component = module.exports.default
  const render = () => { cursor = 0; return Component() }
  return { render, states, effects, module }
}

const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
function findElement(node, type, text) {
  if (!node || typeof node !== 'object') return null
  if (node.type === type && (text === undefined || node.props?.children === text)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type, text)
    if (found) return found
  }
  return null
}
function findCards(node, type, result = []) {
  if (!node || typeof node !== 'object') return result
  if (node.type?.name === type) result.push(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) findCards(child, type, result)
  return result
}
async function policySnapshot(source, response, reject) {
  const calls = []
  const api = { earlyLateCheckout: {
    getEarlyPolicies: async () => { calls.push('getEarlyPolicies'); if (reject) throw reject; return response },
    getLatePolicies: async () => { calls.push('getLatePolicies'); return response },
    createEarlyPolicy: async (...args) => { calls.push(['createEarlyPolicy', ...args]); return undefined },
    updateEarlyPolicy: async (...args) => { calls.push(['updateEarlyPolicy', ...args]); return undefined },
    deleteEarlyPolicy: async (...args) => { calls.push(['deleteEarlyPolicy', ...args]); return undefined }
  } }
  const imported = importComponent(source, api)
  let tree = imported.render()
  const effects = imported.effects.splice(0)
  for (const effect of effects) effect()
  await flush()
  let renderError = null
  try { tree = imported.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls, states: imported.states, tree, renderError, policyCards: findCards(tree, 'PolicyCard') }
}
async function requestSnapshot(source, response) {
  const calls = []
  const api = { earlyLateCheckout: {
    getEarlyPolicies: async () => ({ policies: [] }), getLatePolicies: async () => ({ policies: [] }),
    getEarlyRequests: async () => { calls.push('getEarlyRequests'); return response },
    getLateRequests: async () => { calls.push('getLateRequests'); return response }
  } }
  const imported = importComponent(source, api)
  let tree = imported.render()
  for (const effect of imported.effects.splice(0)) effect()
  await flush()
  tree = imported.render()
  const requestsButton = findElement(tree, 'button', 'Requests')
  assert.ok(requestsButton)
  requestsButton.props.onClick()
  tree = imported.render()
  for (const effect of imported.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = imported.render() } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { calls, states: imported.states, tree, renderError, requestCards: findCards(tree, 'RequestCard') }
}

function errorFromCard(card) {
  try { card.type(card.props); return null } catch (error) { return `${error.name}: ${error.message}` }
}

test('actual EarlyLateCheckout import preserves raw policy and request envelope behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const policyRows = [{ id: 'p-1', name: 'Early arrival', active: true, fee_type: 'flat', fee_amount: 120, allowed_window_hours: 2 }]
  for (const response of [{ policies: policyRows }, null, 'malformed response', { policies: { length: 0 } }, { policies: [null] }, { policies: ['malformed row'] }]) {
    const oldState = await policySnapshot(before, response)
    const newState = await policySnapshot(current, response)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.equal(newState.states[2] === policyRows, oldState.states[2] === policyRows)
    assert.deepEqual(newState.states[2], oldState.states[2])
    assert.equal(newState.renderError, oldState.renderError)
    assert.equal(newState.policyCards.length, oldState.policyCards.length)
    assert.deepEqual(newState.policyCards.map(errorFromCard), oldState.policyCards.map(errorFromCard))
    if (response?.policies) assert.equal(newState.states[2], response.policies)
  }

  for (const response of [{ requests: [{ id: 'r-1', booking_id: 'booking-1234', requested_time: '2026-10-15T10:00:00Z', status: 'pending', fee_amount: 50 }] }, null, 'malformed response', { requests: { length: 0 } }, { requests: [null] }, { requests: ['malformed row'] }]) {
    const oldState = await requestSnapshot(before, response)
    const newState = await requestSnapshot(current, response)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states[3], oldState.states[3])
    assert.equal(newState.renderError, oldState.renderError)
    assert.equal(newState.requestCards.length, oldState.requestCards.length)
    assert.deepEqual(newState.requestCards.map(errorFromCard), oldState.requestCards.map(errorFromCard))
    if (response?.requests) assert.equal(newState.states[3], response.requests)
  }

  const oldFailure = await policySnapshot(before, undefined, new Error('offline'))
  const newFailure = await policySnapshot(current, undefined, new Error('offline'))
  assert.deepEqual(newFailure.calls, oldFailure.calls)
  assert.deepEqual(newFailure.states[2], oldFailure.states[2])
  assert.equal(newFailure.states[4], oldFailure.states[4])
  assert.equal(newFailure.states[5], oldFailure.states[5])
})


