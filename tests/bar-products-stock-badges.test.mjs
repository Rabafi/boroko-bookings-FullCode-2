import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const menu = () => read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')

test('Products cards name out-of-stock and low stock from counted links', () => {
  const source = menu()
  assert.match(source, /stockQtyFor/)
  assert.match(source, /Out of stock/)
  assert.match(source, /Only \{countedQty\} \{stockQty\.unit\} left/)
  // On-hand count rides on the direct-stock line.
  assert.match(source, /on hand/)
  // Availability flags stay separate: a zero count never flips them.
  assert.match(source, /stockQty=\{stockQtyFor\(item\)\}/)
})

test('Products header counts out-of-stock alongside sold out', () => {
  const source = menu()
  assert.match(source, /outOfStockCount/)
  assert.match(source, /<span>Out of stock<\/span>/)
})

test('Products refreshes counts with the catalogue, failing soft', () => {
  const source = menu()
  assert.match(source, /window\.api\?\.inventory\?\.getItems\?\.\(\)\.catch\(\(\) => null\)/)
})

test('offline saves stay visible as pending instead of disappearing', () => {
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /_operation_key: entry\.operation_key/)
  assert.match(domain, /pending:\$\{entry\.operation_key\}/)
  const source = menu()
  assert.match(source, /Pending sync — sells offline now/)
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /startsWith\("pending:"\)/)
  const sync = read('src/main/domains/infrastructure.js')
  assert.match(sync, /row\?\._operation_key !== productKey/)
})
