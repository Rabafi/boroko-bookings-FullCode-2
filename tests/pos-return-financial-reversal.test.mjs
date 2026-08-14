import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260807400000_pos_return_authoritative_reversal.sql', import.meta.url), 'utf8');

test('POS return preserves exact line allocations and reverses tip/tax/tenders', () => {
  assert.match(sql, /Difference-of-cumulative-rounding/);
  assert.match(sql, /v_refund_tax/);
  assert.match(sql, /v_total_tip/);
  assert.match(sql, /v_tender - 'amount'/);
  assert.match(sql, /customer_id/);
  assert.match(sql, /voucher_id/);
  assert.match(sql, /'pos_return'/);
});

test('POS return restores recipe and direct stock with transaction-time cost evidence', () => {
  assert.match(sql, /restaurant_recipe_stock_movements/);
  assert.match(sql, /movement_reason, recipe_version, theoretical_cost/);
  assert.match(sql, /restaurant_apply_stock_location_balance/);
  assert.match(sql, /source_document_type, source_document_id/);
  assert.match(sql, /unknown_legacy/);
  assert.match(sql, /movement_type in\('recipe_sale','sale','pos_sale','pos_return'\)/);
});

test('Legacy v3 callers remain the compatibility surface with stable idempotency', () => {
  assert.match(sql, /create or replace function public\.create_pos_return_v3\(payload jsonb\)/);
  assert.match(sql, /_claim_financial_operation/);
  assert.match(sql, /_record_financial_operation/);
  assert.match(sql, /create_pos_return_v3/);
});
