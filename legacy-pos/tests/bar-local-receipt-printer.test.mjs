import assert from 'node:assert/strict';
import test from 'node:test';
import { printVerifiedLocalBarReceipt } from '../src/main/bar-local/receiptPrinter.js';

const saleId = '6c104989-47cf-4e4e-b52e-9b40441bb9f2';

test('local receipt printer queries the authority and passes only its verified receipt to hardware', async () => {
  const calls = [];
  const receipt = {
    sale_id: saleId,
    receipt_number: 42,
    created_at: '2026-10-21T08:00:00Z',
    total: '21.40',
    discount: '0.00',
    tax: '2.80',
    tip: '0.00',
    lines: [{ name: 'Metsi', quantity: '2', unit_price: '10.70', line_total: '21.40', modifiers: [{ option_name: 'Large', price_delta: '2.50' }] }],
    tenders: [{ method: 'cash', amount: '21.40' }]
  };
  const runtime = { async query(name, filters) { calls.push(['query', name, filters]); return { complete: true, data: receipt }; } };
  const result = await printVerifiedLocalBarReceipt({
    runtime,
    saleId,
    settings: { receipt_print_mode: 'escpos' },
    async printer(request) { calls.push(['printer', request]); return { success: true }; }
  });

  assert.deepEqual(calls[0], ['query', 'sale.get', { sale_id: saleId }]);
  assert.equal(calls[1][0], 'printer');
  assert.equal(calls[1][1].order.receipt_number, 42);
  assert.equal(calls[1][1].order.pos_order_items[0].item_name, 'Metsi');
  assert.equal(calls[1][1].order.pos_order_items[0].line_total, '21.40');
  assert.deepEqual(calls[1][1].order.pos_order_items[0].modifiers, [{ option_name: 'Large', price_delta: '2.50' }]);
  assert.equal(calls[1][1].openDrawer, false);
  assert.deepEqual(result, { success: true });
});

test('local receipt printer refuses invalid or incomplete authority data before touching hardware', async () => {
  let printerCalls = 0;
  await assert.rejects(() => printVerifiedLocalBarReceipt({
    runtime: { async query() { throw new Error('must not query'); } },
    saleId: 'not-a-uuid', settings: {}, async printer() { printerCalls += 1; }
  }), /valid local sale ID/);

  await assert.rejects(() => printVerifiedLocalBarReceipt({
    runtime: { async query() { return { complete: false, data: { sale_id: saleId } }; } },
    saleId, settings: {}, async printer() { printerCalls += 1; }
  }), /complete verified receipt/);
  assert.equal(printerCalls, 0);
});
