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
const preimagePath = resolve(evidence, 'L02-preimages-workerA-2026-10-15/UsageUpgradePrompt-before-default-props-type-fix-2026-10-15.jsx.txt')
const currentPath = resolve(repoRoot, 'src/renderer/src/components/shared/UsageUpgradePrompt.jsx')
const read = (path) => readFileSync(path, 'utf8')

function evaluate(source, mockRequire, windowValue) {
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2022', jsx: 'automatic' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, windowValue)
  return module.exports
}
function findAllNodes(tree, predicate, found = []) {
  if (!tree || typeof tree !== 'object') return found
  if (predicate(tree)) found.push(tree)
  const children = tree.props?.children
  for (const child of Array.isArray(children) ? children : [children]) findAllNodes(child, predicate, found)
  return found
}
function project(value) {
  if (typeof value === 'function') return '[function]'
  if (Array.isArray(value)) return value.map(project)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, project(item)]))
  return value
}
function snapshot(source, props) {
  const actions = []
  const jsxRuntime = { jsx: (type, value) => ({ type, props: value }), jsxs: (type, value) => ({ type, props: value }), Fragment: 'Fragment' }
  const icons = Object.fromEntries(['Lock', 'Mail', 'MessageCircle', 'Sparkles', 'TrendingUp'].map((name) => [name, name]))
  const helperModule = {
    buildUpgradeRequestMessage: () => ({ emailSubject: 'subject', emailBody: 'body', whatsappUrl: 'https://example.test/request' }),
    getNextSubscriptionPlan: () => 'Pro',
    getPlanUpsell: () => ({ label: 'upgrade', capacities: ['bookings'], features: ['reports'] }),
    formatPlanLimits: () => ({ bookings: '100', rooms: '20', users: '10' }),
    getSubscriptionPlan: () => ({ name: 'Starter' }),
    isUnlimited: (value) => value === null,
    trackUpgradeIntent: (value) => actions.push(['track', value])
  }
  const mockRequire = (specifier) => {
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return icons
    if (specifier === './Modal') return { Modal: 'Modal' }
    if (specifier === '../../../../shared/subscriptionPlans') return helperModule
    if (specifier === '../../../../shared/commercialPackages') return { getCommercialPackageLabel: () => 'Commercial' }
    if (specifier === '../../../../shared/productIdentity') return { getProductDefinition: () => ({ id: 'desktop', shortName: 'LodgingOS' }), getRuntimeProductId: () => 'desktop' }
    throw new Error(`Unexpected import: ${specifier}`)
  }
  const calls = []
  const api = { shell: { openExternal: async (...args) => { calls.push(['openExternal', ...args]) } } }
  const imported = evaluate(source, mockRequire, { api })
  const tree = imported.default(props)
  return { exported: Object.keys(imported).sort(), tree: project(tree), actions, calls, rawTree: tree }
}

test('actual UsageUpgradePrompt import preserves exported UI and callback behavior', async () => {
  const before = read(preimagePath)
  const current = read(currentPath)
  for (const props of [
    {},
    { open: false, onClose() {}, onUpgrade() {}, onRequestUpgrade() {} },
    { open: true },
    { open: true, resourceLabel: 'bookings', currentPlan: 'Starter', used: 4, limit: 12, grace: 2, status: { isBlocked: true, isInGrace: false, remainingGrace: 0 }, usage: { bookings: 4 }, recommendation: { recommendedPlan: 'Pro' } }
  ]) {
    const oldView = snapshot(before, props)
    const newView = snapshot(current, props)
    assert.deepEqual(newView.exported, oldView.exported)
    assert.deepEqual(newView.tree, oldView.tree)
    assert.deepEqual(newView.actions, oldView.actions)
    assert.deepEqual(newView.calls, oldView.calls)
  }
  const oldCallbackView = snapshot(before, { open: true, lodgeId: 'lodge-1', onClose() {}, onUpgrade() { return 'upgrade' }, onRequestUpgrade() { return 'request' } })
  const newCallbackView = snapshot(current, { open: true, lodgeId: 'lodge-1', onClose() {}, onUpgrade() { return 'upgrade' }, onRequestUpgrade() { return 'request' } })
  const oldButtons = findAllNodes(oldCallbackView.rawTree, (node) => node.type === 'button')
  const newButtons = findAllNodes(newCallbackView.rawTree, (node) => node.type === 'button')
  assert.equal(newButtons.length, oldButtons.length)
  for (let index = 0; index < newButtons.length; index++) {
    assert.equal(typeof newButtons[index].props.onClick, typeof oldButtons[index].props.onClick)
  }
  await oldButtons[0].props.onClick()
  await newButtons[0].props.onClick()
  await oldButtons.at(-1).props.onClick()
  await newButtons.at(-1).props.onClick()
  assert.deepEqual(newCallbackView.actions, oldCallbackView.actions)
})
