import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Bar Base stock ergonomics keep low-stock and categories operationally simple', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')

  assert.match(stock, /import \{ BAR_PRODUCT_CATEGORIES \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/barModeProfile'/)
  assert.match(stock, /const BAR_CATEGORY_SUGGESTIONS = BAR_PRODUCT_CATEGORIES/)
  assert.match(stock, /setNewItem\(\(current\) => \(\{ \.\.\.current, category \}\)\)/)
  assert.match(stock, /const \[lowOnly, setLowOnly\] = useState\(false\)/)
  assert.match(stock, /checked=\{lowOnly\}/)
  assert.match(stock, /!lowOnly \|\| isLow\(item\)/)
  assert.match(stock, /const STOCK_ACTION_REASONS = \{/)
  assert.match(stock, /reason_code=\$\{actionForm\.reasonCode\}/)
  assert.match(stock, /setItemsRead\(\{ source: 'refreshing', complete: false \}\)/)
  assert.match(stock, /setItemsRead\(\{ source: 'unavailable', complete: false \}\)/)
  assert.match(stock, /operationId: crypto\.randomUUID\(\)/)
  assert.match(stock, /stockAction\.operationId/)
})

test('Bar Base item history is read-only, scoped, and honest about source completeness', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  const domain = read('src/main/domains/inventory.js')
  const database = read('src/main/database.js')
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')

  assert.match(stock, /getMovementsWithReadStatus/)
  assert.match(stock, /Read-only ledger/)
  assert.match(stock, /Server-confirmed ledger read/)
  assert.match(stock, /Not certified/)
  assert.match(domain, /export async function getInventoryMovementsWithReadStatus\(/)
  assert.match(domain, /source: rows\?\._source \|\| 'unknown'/)
  assert.match(domain, /complete: rows\?\._complete === true/)
  assert.match(database, /getInventoryMovementsWithReadStatus,/)
  assert.match(main, /inventory:getMovementsWithReadStatus/)
  assert.match(main, /assertResourceBelongsToCurrentLodge\('Inventory item'/)
  assert.match(main, /getUserPosOutletFilter\(\)/)
  assert.match(main, /outside the operator outlet scope/)
  assert.match(preload, /getMovementsWithReadStatus: \(filters\) => invoke\('inventory:getMovementsWithReadStatus'/)
})

test('Bar Base blank count sheet never presents cached quantities as certified on-hand', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  const styles = read('src/renderer/src/styles/hospitality-pos.css')

  assert.match(stock, /Print blank count sheet/)
  assert.match(stock, /Blank physical stock count sheet/)
  assert.match(stock, /Quantity fields are intentionally blank/)
  assert.match(stock, /PROVISIONAL ITEM LIST/)
  assert.match(stock, /does not include cached on-hand quantities/)
  assert.match(styles, /hpos-stock-print-sheet/)
  assert.match(styles, /is-provisional/)
  assert.doesNotMatch(stock, /print.*current_stock|current_stock.*print/i)
})

test('Bar Base batch mutation UI is explicitly atomic and server-authoritative', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /Count All/)
  assert.match(stock, /Receive a multi-line delivery/)
  assert.match(stock, /postBarPhysicalCount/)
  assert.match(stock, /postBarSimpleDelivery/)
  assert.match(stock, /server rejects the whole operation/)
})
