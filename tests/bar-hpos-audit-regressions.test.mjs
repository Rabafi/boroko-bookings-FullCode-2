import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  cashupApprovalAllowed,
  formatRecordedMoney,
  getCashupEvidence,
} from '../src/renderer/src/components/hospitality-pos/hposCashupState.js'
import {
  formatStockMutationNotice,
  validateSingleStockQuantity,
} from '../src/renderer/src/components/hospitality-pos/hposStockState.js'
import {
  filterCommandPaletteCommands,
  getSelectedCommand,
  moveCommandPaletteSelection,
} from '../src/renderer/src/components/hospitality-pos/hposCommandPaletteState.js'

const read = (file) => readFileSync(file, 'utf8')

test('cash-up evidence never converts malformed money into zero or Balanced', () => {
  const malformed = [null, undefined, '', '   ', NaN, Infinity, -Infinity, 'NaN', 'Infinity']
  for (const value of malformed) {
    const expectedSubmission = { expected_cash_drawer: value, counted_by_method: { cash: 0 } }
    const countedSubmission = { expected_cash_drawer: 0, counted_by_method: { cash: value } }
    for (const submission of [expectedSubmission, countedSubmission]) {
      const evidence = getCashupEvidence(submission)
      assert.equal(evidence.complete, false)
      assert.equal(evidence.variance, null)
      assert.equal(cashupApprovalAllowed(submission), false)
    }
    assert.equal(formatRecordedMoney(value), 'Unavailable')
  }

  const zero = getCashupEvidence({ expected_cash_drawer: 0, counted_by_method: { cash: 0 } })
  assert.deepEqual(zero, { expected: 0, counted: 0, complete: true, variance: 0 })
  assert.equal(cashupApprovalAllowed({ expected_cash_drawer: 0, counted_by_method: { cash: 0 } }), true)
  assert.equal(formatRecordedMoney(0), 'P 0.00')

  const short = getCashupEvidence({ expected_cash_drawer: '10.00', counted_by_method: { cash: '9.995' } })
  assert.ok(Math.abs(short.variance + 0.005) < 1e-9)
  assert.match(formatRecordedMoney(short.variance), /^P -?0\.01$/)
})

test('single stock validation distinguishes blank, non-finite, zero and receive constraints', () => {
  assert.equal(validateSingleStockQuantity('', 'count').code, 'blank')
  assert.equal(validateSingleStockQuantity('   ', 'count').code, 'blank')
  assert.equal(validateSingleStockQuantity('NaN', 'count').code, 'non_finite')
  assert.equal(validateSingleStockQuantity('Infinity', 'count').code, 'non_finite')
  assert.deepEqual(validateSingleStockQuantity('0', 'count'), {
    ok: true,
    code: 'valid',
    quantity: 0,
  })
  assert.equal(validateSingleStockQuantity('0', 'receive').code, 'not_positive')
  assert.equal(validateSingleStockQuantity('-1', 'receive').code, 'not_positive')
  assert.equal(validateSingleStockQuantity('2.5', 'receive').quantity, 2.5)

  const queued = formatStockMutationNotice('count', 'Bottles', { success: true, offline: true, queued: true })
  assert.match(queued, /saved provisionally/i)
  assert.match(queued, /pending server confirmation/i)
  assert.match(queued, /not yet server-posted/i)
  assert.match(formatStockMutationNotice('receive', 'Bottles', { success: true }), /posted to the server/i)
})

test('command palette filtering and keyboard movement share the displayed result list', () => {
  const commands = [
    { route: '/restaurant/general-ledger', label: 'General ledger', group: 'Accounting', keywords: 'journal posting' },
    { route: '/restaurant/budgets', label: 'Budgets', group: 'Accounting', keywords: 'plan' },
    { route: '/hpos/stock', label: 'Service stock', group: 'Menu & stock', keywords: 'count' },
  ]
  const accounting = filterCommandPaletteCommands(commands, 'Accounting')
  assert.deepEqual(accounting.map((command) => command.label), ['General ledger', 'Budgets'])
  assert.equal(getSelectedCommand(accounting, 0).label, 'General ledger')
  assert.equal(moveCommandPaletteSelection(0, 1, accounting.length), 1)
  assert.equal(getSelectedCommand(accounting, 1).label, 'Budgets')
  assert.equal(moveCommandPaletteSelection(0, -1, accounting.length), 1)
  assert.equal(getSelectedCommand([], 0), null)
})

test('owned components wire the pure contracts and preserve the existing recovery paths', () => {
  const cashClose = read('src/renderer/src/components/hospitality-pos/HposCashClose.jsx')
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  const palette = read('src/renderer/src/components/hospitality-pos/HposCommandPalette.jsx')

  assert.match(cashClose, /formatRecordedMoney/)
  assert.match(cashClose, /cashupApprovalAllowed\(submission\)/)
  assert.match(cashClose, /reviewEvidence\?\.complete/)
  assert.match(cashClose, /Cash-up review is not verified/)
  assert.doesNotMatch(cashClose, /Number\(value \|\| 0\)/)

  assert.match(stock, /validateSingleStockQuantity/)
  assert.match(stock, /formatStockMutationNotice/)
  assert.match(stock, /expected_updated_at: stockAction\.item\.updated_at \|\| null/)
  assert.doesNotMatch(stock, /const entered = Number\(actionForm\.quantity\)/)

  assert.match(palette, /filterCommandPaletteCommands/)
  assert.match(palette, /getSelectedCommand\(filtered, selectedIndex\)/)
  assert.match(palette, /ArrowDown/)
  assert.match(palette, /focusin/)
  assert.match(palette, /previousFocusRef/)
  assert.match(palette, /onFocus=\{\(\) => setSelectedIndex\(index\)\}/)
  assert.doesNotMatch(palette, /const first = commands\.find/)
})
