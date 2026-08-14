import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260807410000_ap_supplier_controls_and_credit_notes.sql', import.meta.url), 'utf8');
const domain = fs.readFileSync(new URL('../src/main/domains/restaurantAccountingV2.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/renderer/src/components/restaurant-accounting/RestaurantAccountsPayable.jsx', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');

test('AP has a complete evidence-bearing bill header and multi-line contract', () => {
  assert.match(migration, /create or replace function public\.create_restaurant_bill_v3/);
  assert.match(migration, /create or replace function public\.submit_restaurant_bill/);
  assert.match(migration, /ap_bill\.submitted/);
  assert.match(migration, /currency text not null default 'BWP'/);
  assert.match(migration, /exchange_rate numeric\(18,8\)/);
  assert.match(migration, /source_document_hash text/);
  assert.match(migration, /Supplier belongs to another lodge or is missing/);
  assert.match(migration, /AP foreign-currency bills are unavailable/);
  assert.match(migration, /jsonb_array_elements\(p_items\)/);
  assert.match(migration, /restaurant_ap_document_evidence/);
  assert.match(domain, /create_restaurant_bill_v3/);
  assert.match(page, /Add line/);
});

test('AP credit notes are immutable corrections with maker-checker and GL reversal', () => {
  assert.match(migration, /create table if not exists public\.restaurant_ap_credit_notes/);
  assert.match(migration, /status in \('draft','submitted','approved','voided'\)/);
  assert.match(migration, /create or replace function public\.submit_restaurant_ap_credit_note_v2/);
  assert.match(migration, /create or replace function public\.approve_restaurant_ap_credit_note_v2/);
  assert.match(migration, /Credit-note creator cannot approve/);
  assert.match(migration, /ap_credit_note\.submitted/);
  assert.match(migration, /'ap_credit_note'/);
  assert.match(migration, /record_restaurant_source_posting/);
  assert.match(domain, /create_restaurant_ap_credit_note_v2/);
  assert.match(ipc, /createCreditNote: \['accounting\.manage'/);
});

test('AP aging and supplier statements reconcile recognized subledger to the AP control account', () => {
  assert.match(migration, /get_restaurant_supplier_statement_v2/);
  assert.match(migration, /status in \('approved','partially_paid','paid','overdue'\)/);
  assert.match(migration, /ap_subledger_balance/);
  assert.match(migration, /ap_control_account_balance/);
  assert.match(migration, /p_end_date is null or bill_date <= p_end_date/);
  assert.match(migration, /'currency', coalesce\(v_currency, 'BWP'\)/);
  assert.match(migration, /credits_reduce_payable_before_payment/);
  assert.match(migration, /Payment exceeds outstanding balance after credit notes/);
  assert.match(page, /Supplier statement and reconciliation/);
  assert.match(page, /Credit-note approvals/);
  assert.match(page, /bill-submit:/);
  assert.match(page, /credit-note-submit:/);
});
