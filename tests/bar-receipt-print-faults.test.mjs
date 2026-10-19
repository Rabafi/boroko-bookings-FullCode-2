// WP D printer-fault contracts: a print failure after a committed sale must
// read as "already recorded; only printing failed", a provisional sale must
// read as "saved on this till awaiting confirmation", and the automatic
// cash-drawer kick is spent on the first print attempt for a receipt view so a
// retry or manual reprint can never pulse the drawer twice.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx')

test('receipt drawer kick is spent on the first print attempt only', () => {
  assert.match(receipt, /const drawerKickSpentRef = useRef\(false\)/)
  assert.match(receipt, /drawerKick = safeOrder\?\._open_drawer_on_print === true && !drawerKickSpentRef\.current/)
  assert.match(receipt, /drawerKickSpentRef\.current = true/)
  // The IPC payload must use the one-shot value, never the raw flag.
  assert.match(receipt, /openDrawer: drawerKick\n/)
  assert.doesNotMatch(receipt, /openDrawer: safeOrder\?\._open_drawer_on_print === true/)
})

test('a failed print after a sale never reads as financial uncertainty', () => {
  assert.match(receipt, /already recorded/)
  assert.match(receipt, /awaiting server confirmation; only printing failed/)
  assert.match(receipt, /do not ring this sale again/)
  // Committed and provisional sales keep distinct failure wording.
  assert.match(receipt, /safeOrder\?\._pending_sync === true\s*\n\s*\? 'The sale is saved on this till/)
})

test('reprint entry points never carry the automatic drawer-kick flag', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  // The persisted last-receipt copy is written before the transient flag is
  // added, and the reprint opens the persisted copy with autoPrint disabled.
  assert.match(terminal, /writeJsonSetting\(\s*\n\s*lastReceiptKey\(lodgeId, selectedOutlet\.id\),\s*\n\s*receiptWithCash,\s*\n\s*\);/)
  assert.match(terminal, /setCompletedReceipt\(\{ order: lastReceipt, autoPrint: false \}\);/)
})
