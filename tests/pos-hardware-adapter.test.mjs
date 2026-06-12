import assert from 'node:assert/strict'
import {
  buildCashDrawerPulse,
  buildEscPosReceipt,
  normalizePosHardwareSettings
} from '../src/main/hardware/posHardwareAdapter.js'

const settings = normalizePosHardwareSettings({
  receipt_print_mode: 'escpos',
  escpos_enabled: true,
  receipt_paper_width: '58mm',
  escpos_network_host: '192.168.1.50',
  escpos_network_port: '9100',
  cash_drawer_enabled: true,
  cash_drawer_pin: '1',
  cash_drawer_pulse_on_ms: '60',
  cash_drawer_pulse_off_ms: '240'
})

assert.equal(settings.receipt_print_mode, 'escpos')
assert.equal(settings.escpos_network_port, 9100)
assert.equal(settings.cash_drawer_pin, '1')

const pulse = buildCashDrawerPulse(settings)
assert.deepEqual([...pulse.slice(0, 3)], [0x1b, 0x70, 1])
assert.equal(pulse.length, 5)

const receipt = buildEscPosReceipt({
  id: 'abc123',
  receipt_number: 'R-100',
  walk_in_name: 'Test Guest',
  payment_method: 'cash',
  pos_order_items: [
    { item_name: 'Coffee', quantity: 2, unit_price: 15 },
    { item_name: 'Breakfast Plate', quantity: 1, unit_price: 85 }
  ],
  gross_total: 115,
  total: 115,
  created_at: '2026-06-12T12:00:00.000Z'
}, {
  lodge_name: 'Boroko Lodge',
  currency: 'P',
  vat_number: 'VAT123'
}, settings, { openDrawer: 'before' })

assert.equal(receipt[0], 0x1b)
assert.equal(receipt[1], 0x40)
assert.ok(receipt.includes(Buffer.from('Boroko Lodge')))
assert.ok(receipt.includes(Buffer.from('Coffee')))
assert.ok(receipt.includes(Buffer.from('TOTAL')))
assert.ok(receipt.includes(pulse))

console.log('pos-hardware-adapter: ok')
