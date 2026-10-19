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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/DataManagement-before-raw-export-and-backup-boundaries-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/DataManagement.jsx')
const read = (path) => readFileSync(path, 'utf8')
function evaluate(source, mockRequire, windowValue) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) { const result = find(child, predicate); if (result) return result }
  return null
}
function renderedText(node, result = []) {
  if (typeof node === 'string' || typeof node === 'number') { result.push(String(node)); return result }
  if (!node || typeof node !== 'object') return result
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) renderedText(child, result)
  return result
}
function runtime(source, response, progressEvent, rejectExport = false) {
  const states = new Map()
  const effects = []
  const calls = []
  let active = ''
  let cursor = 0
  let progressListener
  const react = {
    useState(initial) {
      const componentStates = states.get(active) || []
      const index = cursor++
      if (!(index in componentStates)) componentStates[index] = typeof initial === 'function' ? initial() : initial
      states.set(active, componentStates)
      return [componentStates[index], (next) => { componentStates[index] = typeof next === 'function' ? next(componentStates[index]) : next }]
    },
    useEffect(effect) { effects.push({ owner: active, effect }) }
  }
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  const iconNames = ['Database', 'Upload', 'Download', 'FileSpreadsheet', 'Users', 'BedDouble', 'Receipt', 'ShoppingCart', 'CheckCircle2', 'AlertCircle', 'Loader2', 'HardDrive', 'ShieldCheck', 'Clock', 'Wallet', 'ClipboardCheck', 'AlertTriangle']
  const icons = Object.fromEntries(iconNames.map((name) => [name, name]))
  const context = { useAccess: () => ({ allowedByRole: {} }), useSettings: () => ({ settings: { property_type: 'lodge' } }) }
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'react-router') return { useLocation: () => ({ state: { activeTab: 'export' } }) }
    if (specifier === 'lucide-react') return icons
    if (specifier === './DataImport') return { default: 'DataImport' }
    if (specifier === './StarterBackup') return { default: 'StarterBackup' }
    if (specifier === '../app-context') return context
    if (specifier === '../../../shared/propertyTypes') return { isBarOnlyMode: () => false, isRestaurantOnly: () => false }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const api = { data: {
    onExportProgress(callback) { calls.push('subscribe'); progressListener = callback; return () => calls.push('unsubscribe') },
    async exportAll(options) { calls.push(['export', options]); if (rejectExport) throw new Error('offline export'); return response }
  }, backup: {} }
  const imported = evaluate(source, mockRequire, { api })
  const render = (component, props) => { active = component; cursor = 0; return component(props) }
  const tree = render(imported.default, {})
  for (const entry of effects.filter((item) => item.owner === imported.default)) entry.effect()
  const parentTree = render(imported.default, {})
  const exportElement = find(parentTree, (node) => node.type?.name === 'ExportTab')
  assert.ok(exportElement)
  let childTree = render(exportElement.type, exportElement.props)
  for (const entry of effects.filter((item) => item.owner === exportElement.type)) entry.effect()
  childTree = render(exportElement.type, exportElement.props)
  const exportButton = find(childTree, (node) => node.type === 'button' && renderedText(node).join('').includes('Export Workbook'))
  assert.ok(exportButton)
  const clickResult = exportButton.props.onClick()
  return { states, calls, progressListener, clickResult, renderChild: () => render(exportElement.type, exportElement.props), exportState: () => states.get(exportElement.type), emitProgress: () => progressListener?.(progressEvent), initialText: renderedText(childTree), tree }
}
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }
async function snapshot(source, response, progressEvent, rejectExport = false) {
  const app = runtime(source, response, progressEvent, rejectExport)
  await app.clickResult
  app.emitProgress()
  const tree = app.renderChild()
  return { calls: app.calls, states: app.exportState(), text: renderedText(tree) }
}
test('actual DataManagement import preserves raw export results and progress events', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  const scenarios = [
    [{ success: true, complete: true, filePath: 'fictional-export.xlsx', sections: ['bookings'] }, { stage: 'writing', percent: 45 }, false],
    [{ success: false, error: 'export denied' }, null, false],
    [{ canceled: true }, 'malformed-progress', false],
    [null, { stage: 3 }, false],
    ['malformed-result', 7, false],
    [undefined, undefined, true]
  ]
  for (const [response, progress, reject] of scenarios) {
    const oldState = await snapshot(before, response, progress, reject)
    const newState = await snapshot(current, response, progress, reject)
    assert.deepEqual(newState.calls, oldState.calls)
    assert.deepEqual(newState.states, oldState.states)
    assert.deepEqual(newState.text, oldState.text)
    if (reject) assert.deepEqual(newState.states[1], { success: false, error: "offline export" })
    assert.equal(newState.states[6], progress)
  }
})
