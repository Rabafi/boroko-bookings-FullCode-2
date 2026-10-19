import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const esbuild = require('esbuild')
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const read = (path) => readFileSync(path, 'utf8')

function findVariableInitializer(sourceText, variableName, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let initializer
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      initializer = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer, `found ${variableName} initializer in ${fileName}`)
  return initializer.getText(source)
}

function findCallArgumentContaining(sourceText, methodName, fragment, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let argument
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === methodName &&
        node.arguments[0]?.getText(source).includes(fragment)) argument = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(argument, `found ${methodName} argument containing ${fragment} in ${fileName}`)
  return argument.getText(source)
}

function importComponent(sourceText, fileName, api, locationState = null) {
  const states = []
  const effects = []
  let hookIndex = 0
  const react = {
    useState(initial) {
      const index = hookIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (update) => { states[index] = typeof update === 'function' ? update(states[index]) : update }]
    },
    useEffect(effect) { effects.push(effect) },
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback }
  }
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props || {}, key }),
    jsxs: (type, props, key) => ({ type, props: props || {}, key }),
    Fragment: Symbol.for('react.fragment')
  }
  const componentStub = () => null
  const mockRequire = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'react-router') return { useLocation: () => ({ state: locationState, pathname: '/invoices' }), useNavigate: () => () => {} }
    if (specifier === '../app-context') return { useAuth: () => ({ user: null }), useSettings: () => ({ currency: 'BWP' }) }
    if (specifier === '../constants/paymentMethods') return { DESKTOP_PAYMENT_METHODS: [] }
    return new Proxy({ default: componentStub }, { get: (target, key) => key in target ? target[key] : componentStub })
  }
  const output = esbuild.transformSync(sourceText, { loader: 'jsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
  const module = { exports: {} }
  const windowObject = { api, setInterval: () => 1, clearInterval: () => {} }
  new Function('require', 'module', 'exports', 'window', output)(mockRequire, module, module.exports, windowObject)
  return {
    component: module.exports.default,
    states,
    render() { hookIndex = 0; effects.length = 0; return module.exports.default({ lodgeId: null }) },
    async runEffects() {
      const pending = effects.map((effect) => effect())
      await Promise.all(pending.filter((value) => value && typeof value.then === 'function'))
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

function findCall(sourceText, methodName, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  let call
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source).endsWith(methodName)) call = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(call, `found ${methodName} call in ${fileName}`)
  return call.getText(source)
}

test('BookingInvoices keeps Array.isArray container behavior and preserves malformed row identities', () => {
  const before = read(resolve(evidence, 'workerA-BookingInvoices-before-unknown-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/BookingInvoices.jsx'))
  const beforeExpression = findVariableInitializer(before, 'fresh', 'BookingInvoices.before.jsx')
  const currentExpression = findVariableInitializer(current, 'fresh', 'BookingInvoices.current.jsx')
  const beforeFresh = new Function('data', `return (${beforeExpression});`)
  const currentFresh = new Function('data', `return (${currentExpression});`)
  const malformedRows = [null, 7, { booking_id: 12, total_amount: 'bad' }]
  for (const data of [null, 'raw', { results: malformedRows }, malformedRows]) {
    const beforeResult = beforeFresh(data)
    const currentResult = currentFresh(data)
    assert.deepEqual(currentResult, beforeResult)
    if (Array.isArray(data)) assert.equal(currentResult, data)
    else assert.deepEqual(currentResult, [])
  }
  assert.match(current, /const fresh = Array\.isArray\(data\) \? \/\*\* @type \{unknown\[\]\} \*\/ \(data\) : \[\]/)
})

test('PaymentGatewayConfig preserves the raw webhook result and four renderer arguments', async () => {
  const before = read(resolve(evidence, 'workerA-PaymentGatewayConfig-before-webhook-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PaymentGatewayConfig.jsx'))
  const beforeCall = findCall(before, 'verifyWebhookSignature', 'PaymentGatewayConfig.before.jsx')
  const currentCall = findCall(current, 'verifyWebhookSignature', 'PaymentGatewayConfig.current.jsx')
  const beforeInvoke = new Function('window', 'signatureTest', `return (${beforeCall});`)
  const currentInvoke = new Function('window', 'signatureTest', `return (${currentCall});`)
  const rawResult = { verified: 'truthy', provider: 12, extra: true }
  const argsBefore = []
  const argsCurrent = []
  const makeWindow = (captured) => ({ api: { payments: { verifyWebhookSignature: (...args) => { captured.push(args); return rawResult } } } })
  const signatureTest = { provider: 'gateway', signature: ' secret ', payload: '{"event":1}', timestamp: '' }
  assert.equal(await beforeInvoke(makeWindow(argsBefore), signatureTest), rawResult)
  assert.equal(await currentInvoke(makeWindow(argsCurrent), signatureTest), rawResult)
  assert.deepEqual(argsCurrent, argsBefore)
  assert.equal(argsCurrent[0].length, 4)
  assert.deepEqual(argsCurrent[0], ['gateway', 'secret', '{"event":1}', null])
  assert.doesNotMatch(current, /WebhookVerificationResult/)
})

// This focused harness evaluates the extracted production callsite expressions
// against the exact preimage; it does not mount the component or emulate React rendering.
test('PaymentGatewayConfig keeps provider rows and dashboard RPC/cache values unvalidated', () => {
  const before = read(resolve(evidence, 'workerA-PaymentGatewayConfig-before-config-dashboard-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PaymentGatewayConfig.jsx'))
  const expression = (source, variableName, fileName) => findVariableInitializer(source, variableName, fileName)
  const beforeProviderResult = new Function('configResult', `return (${expression(before, 'providerResult', 'PaymentGatewayConfig.before.jsx')});`)
  const currentProviderResult = new Function('configResult', `return (${expression(current, 'providerResult', 'PaymentGatewayConfig.current.jsx')});`)
  const beforeConfigData = new Function('providerResult', `return (${expression(before, 'configData', 'PaymentGatewayConfig.before.jsx')});`)
  const currentConfigData = new Function('providerResult', `return (${expression(current, 'configData', 'PaymentGatewayConfig.current.jsx')});`)
  const invalidRows = [null, { provider: 7 }, 'malformed-row']
  for (const value of [null, 'raw', { data: invalidRows }, invalidRows, { data: null }]) {
    const beforeProvider = beforeProviderResult(value)
    const currentProvider = currentProviderResult(value)
    assert.equal(currentProvider, beforeProvider)
    const beforeData = beforeConfigData(beforeProvider)
    const currentData = currentConfigData(currentProvider)
    assert.equal(currentData, beforeData)
  }

  const beforeDashboardFallback = new Function('dashboardExpectation', `return (${findCallArgumentContaining(before, 'setDashboard', 'dashboardExpectation', 'PaymentGatewayConfig.before.jsx')});`)
  const currentDashboardFallback = new Function('dashboardExpectation', `return (${findCallArgumentContaining(current, 'setDashboard', 'dashboardExpectation', 'PaymentGatewayConfig.current.jsx')});`)
  for (const value of [null, undefined, false, 0, 'raw', { recent_transactions: 'invalid' }, [null]]) {
    const oldResult = beforeDashboardFallback(value)
    const newResult = currentDashboardFallback(value)
    if (value && typeof value === 'object') assert.equal(newResult, oldResult)
    else assert.deepEqual(newResult, oldResult)
  }
  assert.match(current, /const configData = Array\.isArray\(providerResult\) \? \/\*\* @type \{unknown\[\]\} \*\/ \(providerResult\) : providerResult\?\.data/)
  assert.doesNotMatch(current, /@type \{PaymentProviderConfigRow\[\] \| \{data:/)
  assert.doesNotMatch(current, /@type \{PaymentGatewayDashboard \| null\}/)
})

test('actual BookingInvoices import preserves malformed rows passed to invoice state', async () => {
  const before = read(resolve(evidence, 'workerA-BookingInvoices-before-unknown-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/BookingInvoices.jsx'))
  const malformedRows = [null, { booking_id: 8, total_amount: 'invalid' }, 'row']
  const run = async (source, fileName) => {
    const api = {
      invoices: { getBookingInvoices: async () => malformedRows },
      conference: { getAll: async () => [] },
      sync: { getStatus: async () => ({ isOnline: true }) }
    }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    const stored = runtime.states.find((value) => Array.isArray(value) && value.some((row) => malformedRows.includes(row)))
    assert.ok(stored, 'actual component stored malformed invoice rows in its state update')
    return stored
  }
  const beforeRows = await run(before, 'BookingInvoices.before.jsx')
  const currentRows = await run(current, 'BookingInvoices.current.jsx')
  assert.deepEqual(currentRows, beforeRows)
  for (const row of malformedRows) assert.ok(currentRows.includes(row))
})

test('actual BookingInvoices import preserves malformed invoice selection and conference projection', async () => {
  const sourceBefore = read(resolve(evidence, 'L02-preimages-workerA-2026-10-14/BookingInvoices-before-state-unknown-followup-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/BookingInvoices.jsx'))
  const malformedInvoice = { booking_id: 23, invoice_number: true, total_amount: 'raw', extra: 'preserved' }
  const runSelection = async (source, fileName) => {
    const api = {
      invoices: { getBookingInvoices: async () => [malformedInvoice] },
      conference: { getAll: async () => [] },
      sync: { getStatus: async () => ({ isOnline: true }) }
    }
    const runtime = importComponent(source, fileName, api, { viewBookingId: '23' })
    runtime.render()
    await runtime.runEffects()
    runtime.render()
    await runtime.runEffects()
    assert.ok(runtime.states[0].includes(malformedInvoice), 'raw malformed invoice stays in invoice state')
    assert.equal(runtime.states[8], malformedInvoice, 'navigation selection keeps the same malformed invoice object')
    return { invoices: runtime.states[0], selected: runtime.states[8] }
  }
  const prior = await runSelection(sourceBefore, 'BookingInvoices.before-selection.jsx')
  const after = await runSelection(current, 'BookingInvoices.current-selection.jsx')
  assert.deepEqual(after, prior)

  const malformedConference = {
    id: 24,
    total_amount: '6',
    deposit_paid: '1',
    client_name: 7,
    booking_date: { raw: true },
    room_name: 22,
    payment_status: ['pending']
  }
  const runMalformedConference = async (source, fileName) => {
    const api = {
      invoices: { getBookingInvoices: async () => [] },
      conference: { getAll: async () => [malformedConference] },
      sync: { getStatus: async () => ({ isOnline: true }) }
    }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    return runtime.states[0]
  }
  const priorConference = await runMalformedConference(sourceBefore, 'BookingInvoices.before-conference.jsx')
  const currentConference = await runMalformedConference(current, 'BookingInvoices.current-conference.jsx')
  assert.deepEqual(currentConference, priorConference)
  assert.deepEqual(currentConference[0], {
    booking_id: 24,
    customer_name: 7,
    customer_email: null,
    customer_phone: null,
    check_in: malformedConference.booking_date,
    check_out: malformedConference.booking_date,
    room_number: 22,
    total_amount: 6,
    amount_paid: 1,
    charges_total: 0,
    balance_due: 5,
    status: ['pending'],
    invoice_number: null,
    booking_type: 'conference'
  })
  assert.match(current, /const \[invoices, setInvoices\] = useState\(\/\*\* @type \{unknown\[\]\} \*\/ \(\[\]\)\)/)
  for (const name of ['selectedInvoice', 'receiptInvoice', 'ledgerInvoice', 'auditInvoice', 'deliveryInvoice', 'refundInvoice', 'groupPaymentInvoice']) {
    const setter = `set${name[0].toUpperCase()}${name.slice(1)}`
    assert.ok(current.includes(`const [${name}, ${setter}] = useState(/** @type {unknown} */ (null))`), `${name} keeps the raw selected row boundary unknown`)
  }
})

test('actual PaymentGatewayConfig import preserves malformed config/dashboard state and webhook forwarding', async () => {
  const before = read(resolve(evidence, 'workerA-PaymentGatewayConfig-before-state-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PaymentGatewayConfig.jsx'))
  const malformedRows = [{ provider: 17, extra: true }]
  const malformedDashboard = { recent_transactions: 'bad', pending_transactions: [null], failed_transactions: null }
  const verifyRun = async (source, fileName) => {
    const calls = []
    const rawResult = { verified: 'truthy', reason: 7, extra: true }
    const api = {
      payments: {
        getProviderConfig: async () => [{ provider: 'paygate' }],
        getPaymentDashboard: async () => ({ recent_transactions: [], pending_transactions: [], failed_transactions: [] }),
        verifyWebhookSignature: (...args) => { calls.push(args); return Promise.resolve(rawResult) }
      }
    }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    runtime.states[11] = { provider: 'paygate', signature: ' secret ', payload: '{"event":1}', timestamp: '' }
    const tree = runtime.render()
    const button = findElement(tree, (element) => element.type === 'button' && element.props.children?.some?.((child) => child === 'Verify Signature'))
    assert.ok(button, 'actual component rendered its signature-verification action')
    await button.props.onClick()
    assert.deepEqual(calls, [['paygate', 'secret', '{"event":1}', null]])
    assert.equal(runtime.states[10], rawResult)
    return { calls, result: runtime.states[10] }
  }
  const malformedStateRun = async (source, fileName) => {
    const api = { payments: { getProviderConfig: async () => malformedRows, getPaymentDashboard: async () => malformedDashboard } }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    assert.equal(runtime.states[0], malformedRows)
    assert.equal(runtime.states[1], malformedDashboard)
    return [runtime.states[0], runtime.states[1]]
  }
  const beforeMalformed = await malformedStateRun(before, 'PaymentGatewayConfig.before.jsx')
  const currentMalformed = await malformedStateRun(current, 'PaymentGatewayConfig.current.jsx')
  assert.equal(currentMalformed[0], beforeMalformed[0])
  assert.equal(currentMalformed[1], beforeMalformed[1])
  const beforeVerify = await verifyRun(before, 'PaymentGatewayConfig.before.jsx')
  const currentVerify = await verifyRun(current, 'PaymentGatewayConfig.current.jsx')
  assert.deepEqual(currentVerify.calls, beforeVerify.calls)
  assert.deepEqual(currentVerify.result, beforeVerify.result)
})

test('VersionControl unknown sync-state boundary preserves its runtime value and setter call', () => {
  const before = read(resolve(evidence, 'workerA-VersionControl-before-sync-unknown-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/VersionControl.jsx'))
  const getSyncInitializer = (sourceText, fileName) => {
    const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
    let initializer
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
          ts.isIdentifier(node.name.elements[0].name) && node.name.elements[0].name.text === 'syncStatus') {
        assert.ok(ts.isCallExpression(node.initializer))
        initializer = node.initializer.arguments[0].getText(source)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(initializer, `found syncStatus initializer in ${fileName}`)
    return initializer
  }
  const beforeInitial = new Function(`return (${getSyncInitializer(before, 'VersionControl.before.jsx')});`)
  const currentInitial = new Function(`return (${getSyncInitializer(current, 'VersionControl.current.jsx')});`)
  assert.equal(currentInitial(), beforeInitial())
  assert.equal(currentInitial(), null)
  const beforeSetter = findCall(before, 'setSyncStatus', 'VersionControl.before.jsx')
  const currentSetter = findCall(current, 'setSyncStatus', 'VersionControl.current.jsx')
  const captured = []
  const setBefore = new Function('setSyncStatus', 's', `${beforeSetter};`)
  const setCurrent = new Function('setSyncStatus', 's', `${currentSetter};`)
  setBefore((value) => captured.push(['before', value]), { devices: ['raw'] })
  setCurrent((value) => captured.push(['current', value]), { devices: ['raw'] })
  assert.deepEqual(captured, [['before', { devices: ['raw'] }], ['current', { devices: ['raw'] }]])
  assert.match(current, /useState\(\/\*\* @type \{unknown\} \*\/ \(null\)\)/)
  assert.match(current, /const s = await window\.api\.admin\.getSyncQueueStatus\(\)\s+setSyncStatus\(s\)/)
})

test('PropertySwitcher preserves array and properties fallback behavior for malformed RPC values', () => {
  const before = read(resolve(evidence, 'workerA-PropertySwitcher-before-unknown-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PropertySwitcher.jsx'))
  const beforeGroups = new Function('groupData', `return (${findVariableInitializer(before, 'gs', 'PropertySwitcher.before.jsx')});`)
  const currentGroups = new Function('groupData', `return (${findVariableInitializer(current, 'gs', 'PropertySwitcher.current.jsx')});`)
  for (const value of [null, 'raw', { id: 7 }, [null, 'bad', { id: 1 }]]) {
    const oldRows = beforeGroups(value)
    const newRows = currentGroups(value)
    assert.deepEqual(newRows, oldRows)
    if (Array.isArray(value)) assert.equal(newRows, value)
  }
  const beforeProperties = new Function('props', `return (${findCallArgumentContaining(before, 'setProperties', 'props?.properties', 'PropertySwitcher.before.jsx')});`)
  const currentProperties = new Function('props', `return (${findCallArgumentContaining(current, 'setProperties', 'props?.properties', 'PropertySwitcher.current.jsx')});`)
  for (const value of [null, 'raw', [null, { lodge_id: 3 }], { properties: [null, 'bad'] }, { properties: 'bad' }]) {
    const oldRows = beforeProperties(value)
    const newRows = currentProperties(value)
    assert.deepEqual(newRows, oldRows)
    if (Array.isArray(value)) assert.equal(newRows, value)
    if (Array.isArray(value?.properties)) assert.equal(newRows, value.properties)
  }
  assert.match(current, /const \[properties, setProperties\] = useState\(\/\*\* @type \{unknown\} \*\/ \(\[\]\)\)/)
})

test('actual PropertySwitcher import preserves raw group/property results and catch fallback', async () => {
  const before = read(resolve(evidence, 'workerA-PropertySwitcher-before-unknown-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/PropertySwitcher.jsx'))
  const groups = [{ id: 'group-1', name: 'Group' }]
  const rawProperties = 'truthy malformed properties'
  const run = async (source, fileName) => {
    const calls = []
    const api = { multiProperty: {
      getAllGroups: async () => groups,
      getProperties: async (groupId) => { calls.push(groupId); return { properties: rawProperties } }
    } }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    assert.equal(runtime.states[0], groups)
    assert.equal(runtime.states[2], rawProperties)
    assert.deepEqual(calls, ['group-1'])
    return { groups: runtime.states[0], properties: runtime.states[2], calls }
  }
  const beforeState = await run(before, 'PropertySwitcher.before.jsx')
  const currentState = await run(current, 'PropertySwitcher.current.jsx')
  assert.equal(currentState.groups, beforeState.groups)
  assert.equal(currentState.properties, beforeState.properties)
  assert.deepEqual(currentState.calls, beforeState.calls)

  const loadPropertyValue = async (source, fileName, propertyResult) => {
    const api = { multiProperty: {
      getAllGroups: async () => groups,
      getProperties: async () => propertyResult
    } }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    return runtime.states[2]
  }
  for (const propertyResult of [null, false, 0, '', { properties: null }, { properties: false }, { properties: 0 }, { properties: '' }]) {
    const oldValue = await loadPropertyValue(before, 'PropertySwitcher.before.jsx', propertyResult)
    const newValue = await loadPropertyValue(current, 'PropertySwitcher.current.jsx', propertyResult)
    assert.deepEqual(newValue, oldValue)
    assert.deepEqual(newValue, [])
  }

  const loadFailure = async (source, fileName) => {
    const api = { multiProperty: { getAllGroups: async () => { throw new Error('groups unavailable') } } }
    const runtime = importComponent(source, fileName, api)
    runtime.render()
    await runtime.runEffects()
    return runtime.states.slice(0, 6)
  }
  const beforeFailure = await loadFailure(before, 'PropertySwitcher.before.jsx')
  const currentFailure = await loadFailure(current, 'PropertySwitcher.current.jsx')
  assert.deepEqual(currentFailure, beforeFailure)
  assert.deepEqual(currentFailure[0], [])
  assert.deepEqual(currentFailure[2], [])
  assert.equal(currentFailure[5], 'groups unavailable')
})

test('actual FnbOutletContext import preserves malformed outlet rows and nonarray fallback', async () => {
  const before = read(resolve(evidence, 'workerA-FnbOutletContext-before-unknown-rows-2026-10-15.jsx.txt'))
  const current = read(resolve(repoRoot, 'src/renderer/src/components/fnb/FnbOutletContext.jsx'))
  const cases = [[null, { id: 4, name: 2 }], 'raw', { outlets: [null] }, null]
  const run = async (source, fileName, result) => {
    const runtime = importComponent(source, fileName, { outlets: { getAll: async () => result } })
    runtime.render()
    await runtime.runEffects()
    return runtime.states[0]
  }
  for (const result of cases) {
    const beforeRows = await run(before, 'FnbOutletContext.before.jsx', result)
    const currentRows = await run(current, 'FnbOutletContext.current.jsx', result)
    assert.deepEqual(currentRows, beforeRows)
    if (Array.isArray(result)) assert.equal(currentRows, result)
    else assert.deepEqual(currentRows, [])
  }
})
