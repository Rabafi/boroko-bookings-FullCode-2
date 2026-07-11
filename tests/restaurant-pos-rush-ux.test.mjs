import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/renderer/src/components/POS.jsx'), 'utf8')
const posDomain = fs.readFileSync(path.join(root, 'src/main/domains/pos.js'), 'utf8')

test('POS exposes a cashier-focused rush navigation', () => {
  assert.match(source, /canCloseCashup = canAccessCapability\(access, 'pos\.cashup'\)/)
  assert.match(source, /\['terminal', 'Terminal'\]/)
  assert.match(source, /\['tickets', 'Tickets'\]/)
  assert.match(source, /canManageMenu \? \[\['setup', 'Setup'\]\] : \[\]/)
})

test('POS keeps the common cash sale path collapsed and returns focus to search', () => {
  assert.match(source, /const \[showPaymentDetails, setShowPaymentDetails\] = useState\(false\)/)
  assert.match(source, /Complete & New Order/)
  assert.match(source, /menuSearchInputRef\.current\?\.focus\(\)/)
})

test('POS memoizes menu filtering and category grouping for repeated orders', () => {
  assert.match(source, /const filteredVisibleMenuItems = useMemo\(\(\) => visibleMenuItems\.filter/)
  assert.match(source, /const menuByCategory = useMemo\(\(\) => MENU_CATEGORIES\.reduce/)
})

test('POS live refresh avoids loading order history during terminal service', () => {
  assert.match(source, /refreshLivePosState = useCallback\(async \(\{ includeOrders = false \} = \{\}\)/)
  assert.match(source, /includeOrders: tab === 'history'/)
})

test('POS renders one control for duplicate outlet rows and gives virtual outlets stable keys', () => {
  assert.match(source, /function dedupeOutlets\(rows = \[\]\)/)
  assert.match(source, /const list = dedupeOutlets\(d \|\| \[\]\)/)
  assert.match(source, /key=\{o\.id \|\| `\$\{o\.type\}:\$\{o\.name\}`\}/)
  assert.match(posDomain, /A stale local cache must not create duplicate Kitchen\/Bar choices/)
})

test('POS bounds a long menu to the active category with an explicit show-more action', () => {
  assert.match(source, /const POS_MENU_PAGE_SIZE = 72/)
  assert.match(source, /const visibleTerminalCategories = \[activeTerminalCategory\]/)
  assert.match(source, /const items = allItems\.slice\(0, menuDisplayLimit\)/)
  assert.match(source, /Show \{Math\.min\(POS_MENU_PAGE_SIZE, allItems\.length - items\.length\)\} more products/)
})

test('POS renders delivery mode with address and notes fields in restaurant mode', () => {
  assert.match(source, /\['takeaway', 'table', 'delivery'\]/)
  assert.match(source, /delivery_address/)
  assert.match(source, /delivery_notes/)
  assert.match(source, /Delivery address/)
  assert.match(source, /Delivery notes/)
})

test('POS compact cart allows modifier access and shows visual cue fields', () => {
  assert.match(source, /POS_COMPACT_CART_THRESHOLD/)
  assert.match(source, /is_popular/)
  assert.match(source, /dietary_flags/)
  assert.match(source, /prep_time_minutes/)
})

test('POS imports and uses split components', () => {
  assert.match(source, /import POSFavouritesBar from/)
  assert.match(source, /import POSTerminalCartLine from/)
  assert.match(source, /import POSTerminalProductCard from/)
  assert.match(source, /import POSKeyboardHelp from/)
})
