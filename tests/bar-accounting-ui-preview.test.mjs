// Bar Accounting gate: fail-closed readiness gate with no preview bypass,
// presented in the product-native Bar hero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

test('AccountingPage keeps the fail-closed gate with no preview bypass', () => {
  const ui = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
  // Default view still hides financial content until entitlement + readiness pass.
  assert.match(ui, /This Accounting deep link is unavailable until the product entitlement/)
  assert.match(ui, /No Accounting data or action is presented as financially usable/)
  // Readiness errors stay honest and prominent.
  assert.match(ui, /Accounting readiness could not be verified/)
  assert.match(ui, /This surface is not cleared for financial reliance/)
  // No preview affordance may remain: layout unlock happens server-side now.
  assert.doesNotMatch(ui, /ui-preview/)
  assert.doesNotMatch(ui, /Show page layout for UI review/)
  assert.doesNotMatch(ui, /UI preview/)
})

test('Accounting workspace pages render through the shared gate', () => {
  const pages = [
    'RestaurantChartOfAccounts.jsx',
    'RestaurantGeneralLedger.jsx',
    'RestaurantAccountsPayable.jsx',
    'RestaurantBankReconciliation.jsx',
    'RestaurantTaxReturns.jsx',
    'RestaurantBudgets.jsx',
    'RestaurantBalanceSheet.jsx',
    'RestaurantPayroll.jsx',
  ]
  for (const page of pages) {
    const source = read(`src/renderer/src/components/restaurant-accounting/${page}`)
    assert.match(source, /AccountingPage/, `${page} must render through the shared AccountingPage gate`)
  }
})

test('Bar Accounting pages use the product-native hero and add-on badge', () => {
  const ui = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
  assert.match(ui, /HposPageHero/)
  assert.match(ui, /BarAddonBadge/)
  assert.match(ui, /Accounting & Workforce/)
  assert.match(ui, /hpos-accounting-page/)
  assert.match(ui, /hpos-hero-actions/)
  // Primary/secondary actions match Sell/Stock/Cash & close in Bar mode.
  assert.match(ui, /hpos-primary-action/)
  assert.match(ui, /hpos-secondary-action/)
  // Error visibility contract is preserved.
  assert.match(ui, /if \(type === 'error'\)/)
  assert.match(ui, /<ErrorNotice/)
})
