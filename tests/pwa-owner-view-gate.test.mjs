import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('bar Owner View route guard fails closed until the feature is explicitly true', async () => {
  const shell = await read('manager-pwa/src/lib/productShell.js')
  assert.match(shell, /barOnly && path === '\/restaurant-owner' && enabledFeatures\?\.owner_mobile_view !== true\) return false/)
})

test('bar navigation does not use the global feature fail-open helper for Owner View', async () => {
  const more = await read('manager-pwa/src/pages/More.jsx')
  const dashboard = await read('manager-pwa/src/pages/Dashboard.jsx')

  assert.match(more, /features\?\.owner_mobile_view === true/)
  assert.match(dashboard, /features\?\.owner_mobile_view === true/)
  assert.doesNotMatch(more, /isEnabled\('owner_mobile_view'\)/)
  assert.doesNotMatch(dashboard, /isEnabled\('owner_mobile_view'\)/)
})
