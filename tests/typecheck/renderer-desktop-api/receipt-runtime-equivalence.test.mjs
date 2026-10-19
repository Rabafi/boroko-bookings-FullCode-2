import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = process.cwd()
const sourcePath = path.join(root, 'src/renderer/src/components/shared/Receipt.jsx')
const beforePath = path.join(root, 'docs/engineering/typescript-migration/evidence/workerA-Receipt-before-typing-2026-10-15.jsx.txt')

function icon(name) {
  const component = () => null
  component.displayName = name
  return component
}

const iconExports = Object.fromEntries(['Printer', 'X', 'Download', 'CreditCard'].map((name) => [name, icon(name)]))
const jsxRuntime = {
  Fragment: Symbol.for('react.fragment'),
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key })
}
const settings = {
  currency: 'P', logo: '', lodge_name: 'Example Lodge', company_name: 'Tsa Bonno',
  address: 'Main Road', city: 'Gaborone', country: 'Botswana', phone: '', email: '', website: '', vat_number: ''
}

function importComponent(sourceText) {
  const emitted = ts.transpileModule(sourceText, {
    fileName: 'Receipt.jsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      removeComments: true
    }
  }).outputText
  const compiled = new Module(sourcePath)
  compiled.filename = sourcePath
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  const actualRequire = Module.createRequire(sourcePath)
  compiled.require = (specifier) => {
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === 'react') return {
      useEffect() {},
      useMemo: (fn) => fn(),
      useState: (value) => [value, () => {}]
    }
    if (specifier === 'lucide-react') return iconExports
    if (specifier === '../../app-context') return { useSettings: () => ({ settings }) }
    return actualRequire(specifier)
  }
  compiled._compile(emitted, sourcePath)
  return compiled.exports
}

function describe(value) {
  if (typeof value === 'function') return { function: value.displayName || value.name || 'anonymous' }
  if (typeof value === 'symbol') return { symbol: Symbol.keyFor(value) || value.description }
  if (Array.isArray(value)) return value.map(describe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, describe(value[key])]))
  }
  return value
}

function textContent(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join(' ')
  return value && typeof value === 'object' ? textContent(value.props?.children) : ''
}

function findButton(tree, label) {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findButton(child, label)
      if (found) return found
    }
    return undefined
  }
  if (!tree || typeof tree !== 'object') return undefined
  if (tree.type === 'button' && textContent(tree.props?.children).includes(label)) return tree
  return findButton(tree.props?.children, label)
}

async function runAction(component, booking, buttonLabel, printResult) {
  const calls = []
  const alerts = []
  globalThis.window = {
    alert: (message) => alerts.push(message),
    api: {
      invoices: { recordDelivery: async (payload) => calls.push(['recordDelivery', payload]) },
      receipts: {
        printCurrent: async () => {
          calls.push(['printCurrent', { silent: false }])
          if (printResult instanceof Error) throw printResult
          return printResult
        },
        savePDF: async (payload) => calls.push(['savePDF', payload])
      },
      reports: { invoiceDeliveryHistory: async (payload) => calls.push(['invoiceDeliveryHistory', payload]) }
    }
  }
  const tree = component.Receipt({ booking, onClose() {}, onCollectPayment() {} })
  const button = findButton(tree, buttonLabel)
  assert.ok(button, `found ${buttonLabel} button`)
  await button.props.onClick()
  return { calls: describe(calls), alerts: describe(alerts) }
}

test('actual imported Receipt exports and rendered trees match the preimage', () => {
  const baseline = importComponent(fs.readFileSync(beforePath, 'utf8'))
  const current = importComponent(fs.readFileSync(sourcePath, 'utf8'))
  assert.deepEqual(Object.keys(current).sort(), Object.keys(baseline).sort())
  assert.equal(current.Receipt.name, baseline.Receipt.name)

  const cases = [
    { id: 'booking-1', status: 'confirmed', customer_name: 'Guest', check_in: '2026-10-14', check_out: '2026-10-16', rate_per_night: 800, total_amount: 1600, amount_paid: 400, room_number: '4', room_type: 'Double', adults: 2, children: 0, notes: '' },
    { id: 'booking-event', status: 'confirmed', customer_name: 'Event Guest', is_exclusive_event: true, room_count: 4, check_in: 'invalid-date', check_out: '2026-10-16', rate_per_night: '1200', total_amount: 1200, amount_paid: 0, room_type: 'Event', adults: 8, children: 1, notes: '[GROUP:event] note' },
    { id: 'booking-refund', status: 'cancelled', customer_name: 'Cancelled Guest', check_in: null, check_out: null, total_amount: 500, amount_paid: 800, _pending_sync: true, _estimated_total_amount: 500, _estimated_amount_paid: 800, _estimated_payment_status: 'paid', room_number: '2', room_type: 'Single', adults: 1, children: 0 },
    { id: 'booking-zero', status: 'checked_out', customer_name: 'Returned Guest', check_in: '2026-01-02T23:00:00-02:00', check_out: '2026-01-03T23:00:00-02:00', total_amount: 0, amount_paid: 0, room_number: '8', room_type: 'Suite', adults: 2, children: 1, notes: 'ordinary note' }
  ]
  for (const booking of cases) {
    const props = { booking, onClose() {}, onCollectPayment() {} }
    assert.deepEqual(describe(current.Receipt(props)), describe(baseline.Receipt(props)))
  }
})

test('actual imported Receipt print/save callbacks preserve API arguments, order, and error display', async () => {
  const baseline = importComponent(fs.readFileSync(beforePath, 'utf8'))
  const current = importComponent(fs.readFileSync(sourcePath, 'utf8'))
  const booking = { id: 'booking-action', status: 'confirmed', customer_name: 'Guest', check_in: '2026-10-14', check_out: '2026-10-16', total_amount: 100, amount_paid: 20, invoice_number: 'INV-1' }
  for (const result of [{ success: true }, { success: false, error: 'printer denied' }, { success: false, error: 0 }, new Error('print transport failed')]) {
    assert.deepEqual(
      await runAction(current, booking, 'Print Receipt', result),
      await runAction(baseline, booking, 'Print Receipt', result),
    )
  }
  assert.deepEqual(
    await runAction(current, booking, 'Save as PDF'),
    await runAction(baseline, booking, 'Save as PDF'),
  )
})
