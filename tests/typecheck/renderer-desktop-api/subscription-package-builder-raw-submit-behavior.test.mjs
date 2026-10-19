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
const beforePath = resolve(evidence, 'L02-preimages-workerA-2026-10-14/SubscriptionPackageBuilder-before-unknown-submit-result-2026-10-15.jsx.txt')
const read = (path) => readFileSync(path, 'utf8')

function importBuilder(source, submitResult) {
  const states = []
  let hook = 0
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial) {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: react.Fragment
  }
  const calls = { submit: [], exports: [] }
  const documentBuilder = (request, type, options) => ({ request, type, options })
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'lucide-react') return new Proxy({}, { get: () => () => null })
    if (specifier === '../app-context') return { useSettings: () => ({ settings: {} }) }
    if (specifier === '../../../shared/entitlementMerge') return { computeEffectiveFeatures: () => ({}) }
    if (specifier === '../../../shared/subscriptionRequest') return {
      buildSubscriptionRequest: (request) => ({ ...request }),
      generateQuoteNumber: () => 'QT-FIXTURE-1',
      SUBSCRIPTION_REQUEST_TYPES: { plan_upgrade: 'plan_upgrade' },
      SUBSCRIPTION_REQUEST_STATUS: { draft: 'draft', submitted: 'submitted' }
    }
    if (specifier === '../../../shared/enterpriseAddons') return { ENTERPRISE_ADDON_CATALOG: [] }
    if (specifier === '../../../shared/commercialPackages') return {
      buildCommercialPricingSnapshot: () => ({ totals: {} }),
      buildSubscriptionCommercialDocument: documentBuilder,
      formatCommercialMoney: (value) => String(value),
      getAdvertisedEnterpriseAddons: () => [],
      getCommercialPackageCatalog: () => [{ commercialPackageKey: 'restaurant_growth', internalPlan: 'Growth', displayName: 'Growth', eligibleOperatingProfiles: [] }],
      getCommercialPackageLabel: (_plan, productId) => productId,
      getCommercialPackageDisplayName: () => 'Growth',
      TRIAL_POLICY: { trialDays: 14 }
    }
    if (specifier === '../../../shared/commercialEntitlements') return { getCommercialAddonOffers: () => [] }
    if (specifier === '../../../shared/commercialAccess') return { getCommercialFeatureSet: () => new Set() }
    if (specifier === '../../../shared/productIdentity') return {
      getProductDefinition: () => ({ id: 'hospitality-pos' }),
      getRuntimeProductId: () => 'hospitality-pos'
    }
    if (specifier === '../../../shared/propertyTypes') return { getHospitalityMode: () => 'restaurant', isBarOnlyMode: () => false }
    if (specifier === './shared/ErrorNotice') return { ErrorNotice: () => null }
    return new Proxy({ default: () => null }, { get: (target, key) => key in target ? target[key] : () => null })
  }
  const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const api = { subscriptionRequests: {
    submit: async (request) => { calls.submit.push(request); return submitResult },
    exportDocumentPdf: async (payload) => { calls.exports.push(payload); return { success: true } }
  } }
  new Function('require', 'module', 'exports', 'window', code)(mockRequire, module, module.exports, { api })
  return {
    states,
    calls,
    render() { hook = 0; return module.exports.default() },
    async submit() {
      const tree = this.render()
      const find = (node) => {
        if (!node || typeof node !== 'object') return null
        const props = node.props || {}
        const label = Array.isArray(props.children) ? props.children.map((child) => typeof child === 'string' ? child : '').join(' ') : props.children
        if (String(label).includes('Generate & Submit Quote')) return props.onClick
        for (const child of Array.isArray(props.children) ? props.children : [props.children]) {
          const found = find(child)
          if (found) return found
        }
        return null
      }
      const onClick = find(tree)
      assert.equal(typeof onClick, 'function')
      await onClick()
      return this.render()
    }
  }
}

test('actual SubscriptionPackageBuilder import preserves raw submit result use', async () => {
  const before = read(beforePath)
  const current = read(resolve(repoRoot, 'src/renderer/src/components/SubscriptionPackageBuilder.jsx'))
  const quotePayload = { document_number: 'RPC-QT-1', opaque: true }
  for (const response of [
    { quote_number: 'RPC-QT-1', quote_payload: quotePayload },
    { quote_number: 44, quote_payload: quotePayload },
    'raw-rpc-string',
    null
  ]) {
    const oldRuntime = importBuilder(before, response)
    const newRuntime = importBuilder(current, response)
    const oldTree = await oldRuntime.submit()
    const newTree = await newRuntime.submit()
    assert.deepEqual(newRuntime.calls, oldRuntime.calls)
    assert.deepEqual(newRuntime.states, oldRuntime.states)
    assert.equal(JSON.stringify(newTree), JSON.stringify(oldTree))
    assert.equal(newRuntime.states[8], true)
    assert.equal(oldRuntime.states[8], true)
    assert.equal(newRuntime.states[9], response?.quote_number || 'QT-FIXTURE-1')
    assert.equal(oldRuntime.states[9], response?.quote_number || 'QT-FIXTURE-1')
    if (response?.quote_payload) {
      assert.equal(newRuntime.calls.exports[0].options.pricing_snapshot, response.quote_payload)
      assert.equal(oldRuntime.calls.exports[0].options.pricing_snapshot, response.quote_payload)
    }
  }
  assert.match(current, /@type \{unknown\} \*\/ \(null\)/)
})
