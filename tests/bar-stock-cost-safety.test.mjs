import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildOptionalUnitCostPatch,
  parseOptionalNonNegativeCost,
} from '../src/shared/inventoryStockForm.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('optional stock cost parsing distinguishes blank, zero, and invalid values', () => {
  assert.deepEqual(parseOptionalNonNegativeCost(''), { ok: true, value: undefined })
  assert.deepEqual(parseOptionalNonNegativeCost('  '), { ok: true, value: undefined })
  assert.deepEqual(parseOptionalNonNegativeCost('0'), { ok: true, value: 0 })
  assert.deepEqual(parseOptionalNonNegativeCost('12.50'), { ok: true, value: 12.5 })
  assert.equal(parseOptionalNonNegativeCost('-1').ok, false)
  assert.equal(parseOptionalNonNegativeCost('not-a-number').ok, false)
  assert.equal(parseOptionalNonNegativeCost(Infinity).ok, false)

  assert.deepEqual(buildOptionalUnitCostPatch(''), { ok: true, patch: {} })
  assert.deepEqual(buildOptionalUnitCostPatch('0'), { ok: true, patch: { unit_cost: 0 } })
  assert.deepEqual(buildOptionalUnitCostPatch('9.75'), { ok: true, patch: { unit_cost: 9.75 } })
  assert.deepEqual(buildOptionalUnitCostPatch('-0.01'), { ok: false, patch: null })
})

test('Bar stock editor uses latest cost and never edits on-hand in the details form', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  const domain = read('src/main/domains/inventory.js')
  assert.match(stock, /item\.latest_unit_cost/)
  assert.match(stock, /buildOptionalUnitCostPatch\(newItem\.unit_cost\)/)
  assert.match(stock, /Enter a valid non-negative unit cost/)
  assert.match(stock, /\.\.\.costPatch\.patch/)
  assert.match(stock, /mode: 'receive'/)
  assert.match(stock, /mode: 'count'/)
  assert.match(domain, /readOptionalUnitCost/)
  assert.match(domain, /unitCost !== undefined/)
  assert.doesNotMatch(domain, /p_unit_cost: Number\(data\.unit_cost\) \|\| 0/)
  const updateStart = stock.indexOf('? await window.api.inventory.updateItem(')
  const createStart = stock.indexOf(': await window.api.inventory.createItem(', updateStart)
  assert.ok(updateStart >= 0 && createStart > updateStart)
  assert.doesNotMatch(stock.slice(updateStart, createStart), /current_stock:/)
})
