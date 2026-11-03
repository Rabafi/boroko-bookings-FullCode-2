import test from 'node:test'
import assert from 'node:assert/strict'
import { barTaxPercentToRate, barTaxRateToPercent } from '../../src/shared/barLocalTaxInput.js'

test('Bar tax input uses familiar percentages and preserves exact service precision', () => {
  assert.equal(barTaxPercentToRate('14'), '0.1400')
  assert.equal(barTaxPercentToRate('7.5'), '0.0750')
  assert.equal(barTaxPercentToRate('0'), '0.0000')
  assert.equal(barTaxPercentToRate('100'), '1.0000')
  assert.equal(barTaxRateToPercent('0.1400'), '14.00')
  assert.equal(barTaxRateToPercent('0.0750'), '7.50')
  assert.equal(barTaxRateToPercent('1'), '100.00')
})

test('Bar tax input rejects ambiguous, excessive precision and out of range values', () => {
  for (const value of ['', '-1', '101', '14.125', '1e2', ' 14', '01']) {
    assert.throws(() => barTaxPercentToRate(value), /tax percentage/i, value)
  }
  for (const value of ['1.0001', '-0.01', 'NaN', 'Infinity']) {
    assert.throws(() => barTaxRateToPercent(value), /saved tax rate/i, value)
  }
})
