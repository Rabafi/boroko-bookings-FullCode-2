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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/DocumentSystem-before-unvalidated-document-rows-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/DocumentSystem.jsx')
const read = (path) => readFileSync(path, 'utf8')
function evaluate(source, mockRequire, api) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return module.exports
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) { const found = find(child, predicate); if (found) return found }
  return null
}
function materialize(node) {
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return materialize(node.type(node.props))
  const children = node.props?.children
  const nextChildren = Array.isArray(children) ? children.map(materialize) : materialize(children)
  return { ...node, props: { ...node.props, children: nextChildren } }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
function createRuntime(source, options) {
  const states = []
  const effects = []
  const calls = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect(effect) { effects.push(effect) },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const iconNames = ['Plus', 'Pencil', 'Trash2', 'RefreshCw', 'Check', 'AlertTriangle', 'FileText', 'Eye', 'Send']
  const icons = Object.fromEntries(iconNames.map((name) => [name, name]))
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === '../../../shared/accessControl') return { canAccessCapability: () => true }
    if (specifier === '../../../shared/documentAccess') return { hasHotelDocumentsEntitlement: () => true }
    if (specifier === '../../../shared/productIdentity') return { getProductDefinition: () => ({ id: 'hotel' }), getRuntimeProductId: () => 'hotel' }
    if (specifier === '../app-context') return { useAccess: () => ({ entitlement: {} }) }
    if (specifier === './shared/Modal') return { Modal: 'Modal' }
    if (specifier === './shared/ConfirmDialog') return { ConfirmDialog: 'ConfirmDialog' }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: 'ErrorNotice' }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const api = { documentSystem: {
    async getTemplates() { calls.push(['getTemplates']); if (options.rejectTemplates) throw new Error('templates offline'); return options.templates },
    async getDocumentDashboard() { calls.push(['getDashboard']); if (options.rejectDashboard) throw new Error('dashboard offline'); return options.dashboard },
    async getDocumentHistory(...args) { calls.push(['getHistory', ...args]); if (options.rejectHistory) throw new Error('history offline'); return options.history }
  } }
  const imported = evaluate(source, mockRequire, api)
  const render = () => { cursor = 0; return imported.default({ templatesOnly: false }) }
  return { states, effects, calls, render, imported }
}
async function loadSnapshot(source, options) {
  const app = createRuntime(source, options)
  let tree = app.render()
  for (const effect of app.effects.splice(0)) effect()
  await flush()
  let renderError = null
  try { tree = materialize(app.render()) } catch (error) { renderError = `${error.name}: ${error.message}`; tree = null }
  return { states: app.states, calls: app.calls, tree, renderError, app }
}
async function historySnapshot(source, options) {
  const loaded = await loadSnapshot(source, options)
  if (loaded.renderError) return loaded
  const historyTab = find(loaded.tree, (node) => node.type === 'button' && node.props?.children === 'History')
  assert.ok(historyTab)
  historyTab.props.onClick()
  let tree = loaded.app.render()
  try { tree = materialize(tree) } catch (error) { loaded.renderError = `${error.name}: ${error.message}`; return loaded }
  const subjectTypeInput = find(tree, (node) => node.type === 'select')
  const subjectIdInput = find(tree, (node) => node.type === 'input')
  subjectIdInput.props.onChange({ target: { value: 'fictional-booking-1' } })
  tree = materialize(loaded.app.render())
  const loadButton = find(tree, (node) => node.type === 'button' && node.props?.children && (Array.isArray(node.props.children) ? node.props.children.includes('Load') : node.props.children === 'Load'))
  assert.ok(loadButton)
  const promise = loadButton.props.onClick()
  await promise
  try { tree = materialize(loaded.app.render()) } catch (error) { loaded.renderError = `${error.name}: ${error.message}`; tree = null }
  loaded.tree = tree
  loaded.history = loaded.states[2]
  return loaded
}

test('actual DocumentSystem import preserves unknown template, dashboard, and history data behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const templateRows = [{ id: 'template-1', template_key: 'folio', name: 'Folio', document_type: 'folio', numbering_prefix: 'F' }]
  const historyRows = [{ id: 'document-1', document_number: 'F-1', document_type: 'folio', status: 'draft', created_at: '2026-10-15T10:00:00Z' }]
  for (const options of [
    { templates: templateRows, dashboard: { recent_documents: [{ id: 'doc-1', status: 'draft' }] }, history: historyRows },
    { templates: [null], dashboard: { recent_documents: [null] }, history: [null] },
    { templates: ['malformed-row'], dashboard: [], history: ['malformed-history-row'] },
    { templates: { rows: templateRows }, dashboard: 'malformed-dashboard', history: { rows: historyRows } },
    { rejectTemplates: true, rejectDashboard: true, rejectHistory: true }
  ]) {
    const oldState = await loadSnapshot(before, options)
    const newState = await loadSnapshot(current, options)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states.slice(0, 4), oldState.states.slice(0, 4))
    assert.equal(newState.renderError, oldState.renderError)
    if (Array.isArray(options.templates)) assert.equal(newState.states[0], options.templates)
    if (options.dashboard && typeof options.dashboard === 'object') assert.equal(newState.states[1], options.dashboard)
  }
  for (const options of [
    { templates: [], dashboard: { recent_documents: [] }, history: historyRows },
    { templates: [], dashboard: { recent_documents: [] }, history: [null] },
    { templates: [], dashboard: { recent_documents: [] }, history: { rows: historyRows } },
    { templates: [], dashboard: { recent_documents: [] }, rejectHistory: true }
  ]) {
    const oldState = await historySnapshot(before, options)
    const newState = await historySnapshot(current, options)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.history, oldState.history)
    assert.equal(newState.renderError, oldState.renderError)
  }
})

