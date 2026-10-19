import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
const require = createRequire(import.meta.url)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const currentPath = resolve(repo, 'src/renderer/src/components/AdminToday.jsx')
const beforePath = resolve(repo, 'docs/engineering/typescript-migration/evidence/L02-preimages-workerA-2026-10-15/AdminToday-before-unknown-state-2026-10-15.jsx.txt')
function findNodes(tree, predicate, found = []) {
  if (!tree || typeof tree !== 'object') return found
  if (predicate(tree)) found.push(tree)
  const children = tree.props?.children
  for (const child of Array.isArray(children) ? children : [children]) findNodes(child, predicate, found)
  return found
}
function project(value) {
  if (typeof value === 'function') return '[function]'
  if (Array.isArray(value)) return value.map(project)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, project(item)]))
  return value
}
async function run(source, outcome, expand) {
  const calls = [], states = [], icons = Object.fromEntries(['CalendarCheck', 'AlertTriangle', 'RefreshCw', 'ChevronRight', 'Receipt', 'Server', 'LifeBuoy', 'Users', 'Clock'].map((key) => [key, key]))
  let index = 0
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const react = {
    useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }] },
    useEffect() {},
    useCallback(fn) { return fn }
  }
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsx
    if (specifier === 'lucide-react') return icons
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: 'ErrorNotice' }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const code = require('esbuild').transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  const windowValue = { api: { admin: { getAdminToday: (...args) => { calls.push(args); return outcome.reject ? Promise.reject(outcome.value) : Promise.resolve(outcome.value) } } } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  const render = () => { index = 0; return module.exports.default() }
  try {
    const initial = render()
    await findNodes(initial, (node) => node.type === 'button')[0].props.onClick()
    let tree = render()
    if (expand) {
      await findNodes(tree, (node) => node.type === 'button')[1].props.onClick()
      tree = render()
    }
    return { exports: Object.keys(module.exports).sort(), calls, tree: project(tree), thrown: null }
  } catch (error) {
    return { exports: Object.keys(module.exports).sort(), calls, tree: null, thrown: { name: error?.name, message: error?.message } }
  }
}
test('actual AdminToday import preserves raw RPC result rendering, expansion, and rejection behavior', async () => {
  const before = readFileSync(beforePath, 'utf8'), current = readFileSync(currentPath, 'utf8')
  for (const [outcome, expand] of [
    [{ value: { ok: true, summary: { overdue_bookings_count: 1, overdue_bookings_total: '40', failed_devices_count: 0, urgent_tickets_count: 0, lead_followups_count: 0 }, overdue_bookings: [{ booking_number: 7, lodge_name: 'Lodge', balance: '40', days_overdue: 2, payment_status: 'pending' }] } }, true],
    [{ value: null }, false],
    [{ value: 'raw scalar response' }, false],
    [{ value: { overdue_bookings: 'malformed rows', summary: {} } }, true],
    [{ value: { overdue_bookings: [null], summary: {} } }, true],
    [{ reject: true, value: new Error('service unavailable') }, false]
  ]) {
    assert.deepEqual(await run(current, outcome, expand), await run(before, outcome, expand))
  }
})
