import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const posJs = await readFile(new URL('../src/main/domains/pos.js', import.meta.url), 'utf8')
const posUi = await readFile(new URL('../src/renderer/src/components/POS.jsx', import.meta.url), 'utf8')

test('Phase 4: getPosCustomers function exists', () => {
  assert.match(posJs, /export async function getPosCustomers/)
})

test('Phase 4: savePosCustomer function exists', () => {
  assert.match(posJs, /export async function savePosCustomer/)
})

test('Phase 4: awardLoyaltyPoints function exists', () => {
  assert.match(posJs, /export async function awardLoyaltyPoints/)
})

test('Phase 4: redeemLoyaltyPoints function exists', () => {
  assert.match(posJs, /export async function redeemLoyaltyPoints/)
})

test('Phase 4: chargeCustomerAccount function exists', () => {
  assert.match(posJs, /export async function chargeCustomerAccount/)
})

test('Phase 4: redeemVoucher function exists', () => {
  assert.match(posJs, /export async function redeemVoucher/)
})

test('Phase 4: recordDelivery function exists', () => {
  assert.match(posJs, /export async function recordDelivery/)
})

test('Phase 4: getPosCustomers uses cache fallback when offline', () => {
  assert.match(posJs, /function readCachedCustomers\(\)/)
  assert.match(posJs, /COUNTERS_CACHE_KEY|CUSTOMERS_CACHE_KEY/)
})

test('Phase 4: savePosCustomer uses upsert_restaurant_customer RPC', () => {
  assert.match(posJs, /upsert_restaurant_customer/)
})

test('Phase 4: awardLoyaltyPoints uses award_restaurant_loyalty RPC', () => {
  assert.match(posJs, /award_restaurant_loyalty/)
})

test('Phase 4: redeemLoyaltyPoints uses redeem_restaurant_loyalty RPC', () => {
  assert.match(posJs, /redeem_restaurant_loyalty/)
})

test('Phase 4: chargeCustomerAccount uses charge_restaurant_account RPC', () => {
  assert.match(posJs, /charge_restaurant_account/)
})

test('Phase 4: redeemVoucher uses redeem_restaurant_voucher RPC', () => {
  assert.match(posJs, /redeem_restaurant_voucher/)
})

test('Phase 4: recordDelivery uses record_restaurant_delivery RPC', () => {
  assert.match(posJs, /record_restaurant_delivery/)
})

test('Phase 4: POS UI has customer assignment support', () => {
  assert.match(posUi, /walk_in_name/i, 'POS UI should reference walk_in_name for customer assignment')
  assert.match(posUi, /customerType/i, 'POS UI should reference customerType')
})

test('Phase 4: awardLoyaltyPoints rejects offline operation', () => {
  assert.match(posJs, /Cannot award loyalty offline/)
})

test('Phase 4: redeemLoyaltyPoints rejects offline operation', () => {
  assert.match(posJs, /Cannot redeem loyalty offline/)
})

test('Phase 4: chargeCustomerAccount rejects offline operation', () => {
  assert.match(posJs, /Cannot charge account offline/)
})

test('Phase 4: redeemVoucher rejects offline operation', () => {
  assert.match(posJs, /Cannot redeem voucher offline/)
})

test('Phase 4: recordDelivery rejects offline operation', () => {
  assert.match(posJs, /Cannot record delivery offline/)
})

test('Phase 4: loyalty functions emit audit events', () => {
  assert.match(posJs, /appendPosAudit\('customer_saved'/)
})

test('Phase 4: savePosCustomer requires online connection', () => {
  assert.match(posJs, /Cannot save customer offline/)
})

test('Phase 4: loyalty award includes idempotency guard via RPC', () => {
  assert.match(posJs, /award_restaurant_loyalty/)
  assert.match(posJs, /order_id.*orderId/)
})

test('Phase 4: voucher redeem includes amount parameter', () => {
  assert.match(posJs, /redeem_restaurant_voucher/)
  assert.match(posJs, /code,/)
  assert.match(posJs, /amount/)
})

test('Phase 4: delivery record includes platform and driver fields', () => {
  assert.match(posJs, /platform/)
  assert.match(posJs, /driver_name/)
  assert.match(posJs, /platform_commission/)
  assert.match(posJs, /delivery_fee/)
})

test('Phase 4: Phase 4 migration SQL covers customer tables', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708160000_restaurant_phase4_growth.sql', import.meta.url), 'utf8')
  assert.match(sql, /restaurant_customers/)
  assert.match(sql, /restaurant_loyalty_ledger/)
  assert.match(sql, /restaurant_account_ledger/)
  assert.match(sql, /restaurant_deliveries/)
  assert.match(sql, /restaurant_vouchers/)
})

test('Phase 4: Phase 4 migration SQL has RPCs for all growth features', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708160000_restaurant_phase4_growth.sql', import.meta.url), 'utf8')
  assert.match(sql, /upsert_restaurant_customer/)
  assert.match(sql, /get_restaurant_customers/)
  assert.match(sql, /award_restaurant_loyalty/)
  assert.match(sql, /redeem_restaurant_loyalty/)
  assert.match(sql, /charge_restaurant_account/)
  assert.match(sql, /record_restaurant_delivery/)
  assert.match(sql, /redeem_restaurant_voucher/)
})

test('Phase 4: Phase 4 migration SQL has RLS policies', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708160000_restaurant_phase4_growth.sql', import.meta.url), 'utf8')
  assert.match(sql, /restaurant_customers_lodge_scope_select/)
  assert.match(sql, /restaurant_loyalty_ledger_lodge_scope_select/)
  assert.match(sql, /restaurant_account_ledger_lodge_scope_select/)
  assert.match(sql, /restaurant_deliveries_lodge_scope_select/)
})

test('Phase 4: Phase 4 migration SQL has idempotency guards', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708160000_restaurant_phase4_growth.sql', import.meta.url), 'utf8')
  assert.match(sql, /restaurant_loyalty_ledger_dedup_idx/)
  assert.match(sql, /restaurant_account_ledger_dedup_idx/)
  assert.match(sql, /restaurant_vouchers_code_lodge_idx/)
})
