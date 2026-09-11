import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')
const migration = read('supabase/migrations/20260903090000_client_commercial_billing_history.sql')
const scopeRepair = read('supabase/migrations/20260903110000_client_commercial_billing_history_scope_repair.sql')
const domain = read('src/main/domains/commercialBilling.js')
const database = read('src/main/database.js')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const subscription = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')

test('client commercial billing history is a separately scoped RPC, not the booking invoice reader', () => {
  assert.match(migration, /create or replace function public\.get_client_commercial_invoices\(\s*p_lodge_id uuid,\s*p_product_id text/i)
  assert.match(migration, /app_current_session_row\(\)/i)
  assert.match(migration, /v_current_lodge_id <> p_lodge_id/i)
  assert.match(migration, /a\.lodge_id = v_current_lodge_id\s+and a\.product_id = v_product_id/i)
  assert.match(migration, /v_role not in \('finance', 'manager', 'admin'/i)
  assert.match(migration, /settings\.manage_subscription/i)
  assert.match(migration, /package_display_key/i)
  assert.match(migration, /balance_due/i)
  assert.match(migration, /paid_date/i)
  assert.match(migration, /payment_count/i)
  assert.match(migration, /source', 'commercial_ledger'/i)
  assert.equal((scopeRepair.match(/i\.status <> 'draft'/gi) || []).length, 2, 'draft invoices must remain internal')
  assert.match(migration, /grant execute on function public\.get_client_commercial_invoices[\s\S]*to anon, authenticated/i)
  assert.doesNotMatch(migration, /grant execute on function public\.get_client_commercial_invoices[\s\S]*to service_role/i)
})

test('desktop client path uses the session-bound client and exposes unavailable state', () => {
  const functionBody = domain.slice(domain.indexOf('export async function getClientCommercialInvoices'))
  assert.match(functionBody, /state\.supabase\.rpc\('get_client_commercial_invoices'/i)
  assert.doesNotMatch(functionBody, /requireAdmin\(\)\.rpc\('get_client_commercial_invoices'/i)
  assert.match(functionBody, /Subscription billing history is unavailable/i)
  assert.match(database, /getClientCommercialInvoices/)
  assert.match(preload, /getCommercialInvoices: \(lodgeId, options\) => invoke\('trial:getCommercialInvoices'/)
  assert.match(preload, /getCommercialBillingHistory: \(lodgeId, productId\) => invoke\('trial:getCommercialInvoices'/)

  const handler = main.slice(main.indexOf('async function loadClientCommercialInvoices'), main.indexOf("ipcMain.handle('invoices:getBookingInvoices'"))
  assert.match(handler, /source: 'unavailable'/)
  assert.match(handler, /rows: \[\]/)
  assert.match(handler, /getClientCommercialInvoices\(activeLodgeId, options\)/)
  assert.doesNotMatch(handler, /getInvoicesByLodge/)
})

test('subscription UI separates authoritative commercial billing from guest invoices and failures', () => {
  assert.match(subscription, /getCommercialBillingHistory\(lodgeId, BUILD_PRODUCT\.id\)/)
  assert.match(subscription, /response\?\.available === false/)
  assert.match(subscription, /Invoices &amp; payments/)
  assert.match(subscription, /Guest booking invoices are not shown here/)
  assert.match(subscription, /billing-history-loading/)
  assert.match(subscription, /billing-history-unavailable/)
  assert.match(subscription, /billing-history-error/)
  assert.match(subscription, /billing-history-empty/)
  assert.match(subscription, /billingRefreshToken/)
  assert.match(subscription, /Try again/)
  assert.match(subscription, /Balance due:/)
  assert.match(subscription, /Selecting a card does not activate a plan/)
  assert.match(subscription, /technical-access-details/)
  assert.doesNotMatch(subscription, /Paid \{fmtDate\(invoice\.paid_date \|\| invoice\.issued_date\)\}/)
})

test('Supabase Auth fallback resolves the local user id before role checks', () => {
  assert.match(scopeRepair, /v_auth_user_id := public\.app_authenticated_user_id\(\)/)
  assert.match(scopeRepair, /select u\.id, u\.lodge_id\s+into v_user_id, v_current_lodge_id/)
  assert.match(scopeRepair, /where u\.auth_user_id = v_auth_user_id/)
  assert.match(scopeRepair, /and u\.lodge_id = p_lodge_id/)
})
