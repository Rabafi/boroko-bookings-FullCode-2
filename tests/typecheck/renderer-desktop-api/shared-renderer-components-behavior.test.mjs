import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = resolve(root, 'docs/engineering/typescript-migration/evidence')
const sources = [
  { name: 'ErrorNotice', current: resolve(root, 'src/renderer/src/components/shared/ErrorNotice.jsx'), before: resolve(evidence, 'L02-preimages-workerA-2026-10-15/ErrorNotice-before-checkjs-2026-10-15.jsx.txt') },
  { name: 'DataViewToolbar', current: resolve(root, 'src/renderer/src/components/shared/DataViewToolbar.jsx'), before: resolve(evidence, 'L02-preimages-workerA-2026-10-15/DataViewToolbar-before-checkjs-2026-10-15.jsx.txt') }
]
const read = (path) => readFileSync(path, 'utf8')
function importActual(source, component) {
  const effects = [], calls = []
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const react = { useRef: (initial) => ({ current: initial }), useEffect: (fn) => effects.push(fn) }
  const icons = Object.fromEntries(['Columns3', 'Rows3', 'SlidersHorizontal'].map((name) => [name, name]))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsx
    if (specifier === 'lucide-react') return icons
    if (specifier === './friendlyError') return { friendlyErrorMessage: (text) => `friendly:${text}` }
    throw new Error(`Unexpected ${component} import: ${specifier}`)
  }
  const code = require('esbuild').transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(mockRequire, module, module.exports)
  return { component: module.exports[component], exports: Object.keys(module.exports).sort(), effects, calls }
}
function project(value) {
  if (typeof value === 'function') return '[function]'
  if (Array.isArray(value)) return value.map(project)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, project(v)]))
  return value
}
function findNodes(tree, predicate, result = []) {
  if (!tree || typeof tree !== 'object') return result
  if (predicate(tree)) result.push(tree)
  const children = tree.props?.children
  for (const child of Array.isArray(children) ? children : [children]) findNodes(child, predicate, result)
  return result
}
function dataToolbarSnapshot(source, props) {
  const loaded = importActual(source, 'DataViewToolbar')
  const tree = loaded.component(props)
  return { exports: loaded.exports, tree: project(tree), raw: tree }
}
function errorNoticeSnapshot(source, props, nodeBehavior) {
  const loaded = importActual(source, 'ErrorNotice')
  const tree = loaded.component(props)
  const node = {
    closest: (...args) => { loaded.calls.push(['closest', ...args]); return nodeBehavior.dialog ?? null },
    scrollIntoView: (...args) => loaded.calls.push(['scrollIntoView', ...args]),
    focus: (...args) => loaded.calls.push(['focus', ...args])
  }
  tree.props.ref.current = node
  for (const effect of loaded.effects) effect()
  return { exports: loaded.exports, tree: project(tree), calls: loaded.calls }
}
test('actual shared renderer components preserve imports, render props, callbacks and error-notice effects', async () => {
  const [notice, toolbar] = sources.map(({ current, before }) => [read(before), read(current)])
  for (const props of [
    { children: 'Something went wrong' },
    { children: { type: 'em', props: { children: 'raw child' } }, className: 'custom', style: { color: 'red' }, role: 'status', testId: 'status-banner' },
    { children: 'Dialog issue', scrollInDialog: true }
  ]) {
    const behavior = props.children === 'Dialog issue' ? { dialog: true } : { dialog: null }
    const old = errorNoticeSnapshot(notice[0], props, behavior)
    const now = errorNoticeSnapshot(notice[1], props, behavior)
    assert.deepEqual({ exports: now.exports, tree: now.tree, calls: now.calls }, { exports: old.exports, tree: old.tree, calls: old.calls })
  }
  for (const full of [true, false]) {
    const oldEvents = [], newEvents = []
    const makeProps = (events) => full
      ? { title: 'Inventory', subtitle: 'Today', density: 'compact', activeView: 'mine', views: [{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'All' }], onDensityChange: (value) => events.push(['density', value]), onViewChange: (value) => events.push(['view', value]), rightSlot: { type: 'aside', props: { children: 'extra' } } }
      : { title: 'Simple', density: 'comfortable', rightSlot: 'right', onDensityChange: (value) => events.push(['density', value]) }
    const oldProps = makeProps(oldEvents), newProps = makeProps(newEvents)
    const old = dataToolbarSnapshot(toolbar[0], oldProps), now = dataToolbarSnapshot(toolbar[1], newProps)
    assert.deepEqual({ exports: now.exports, tree: now.tree }, { exports: old.exports, tree: old.tree })
    const oldButtons = findNodes(old.raw, (node) => node.type === 'button')
    const newButtons = findNodes(now.raw, (node) => node.type === 'button')
    assert.equal(oldButtons.length, newButtons.length)
    for (const [index, node] of oldButtons.entries()) {
      const match = newButtons[index]
      if (node.props.onClick) {
        await node.props.onClick(); await match.props.onClick()
        assert.equal(typeof match.props.onClick, typeof node.props.onClick)
      }
    }
    assert.deepEqual(newEvents, oldEvents)
  }
})
