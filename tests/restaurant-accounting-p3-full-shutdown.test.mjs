import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const control = read('supabase/migrations/20260807120000_bar_accounting_financial_truth_control_plane.sql')
const tabs = read('supabase/migrations/20260807130000_bar_tab_financial_snapshot_and_concurrency.sql')
const cash = read('supabase/migrations/20260807140000_retire_legacy_cash_drawer_close.sql')
const app = read('src/renderer/src/App.jsx')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const facade = read('src/main/database.js')
const ui = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
const posDomain = read('src/main/domains/pos.js')

describe('Restaurant Accounting current financial-truth contract', () => {
  it('keeps the eight Accounting pages on the explicit V2 bridge', () => {
    for (const route of ['chart-of-accounts', 'general-ledger', 'bank-reconciliation', 'accounts-payable', 'tax-returns', 'budgets', 'balance-sheet', 'payroll']) {
      assert.match(app, new RegExp(`restaurant/${route}`))
    }
    assert.match(main, /getReadiness/)
    assert.match(preload, /restaurantAccountingV2/)
    assert.match(facade, /getRestaurantAccountingReadinessV2/)
  })

  it('requires explicit activation and governed cutover before financial enablement', () => {
    assert.match(control, /restaurant_accounting_activation/)
    assert.match(control, /prepare_restaurant_historical_cutover/)
    assert.match(control, /Approved or applied cutover batches are immutable/)
    assert.match(control, /historical POS activity exists/)
    assert.match(control, /status='applied'/)
  })

  it('uses cumulative balance-sheet earnings and filtered posted journals', () => {
    assert.match(control, /v_cumulative_revenue/)
    assert.match(control, /e\.is_posted and e\.entry_date<=p_end_date/)
    assert.match(control, /cumulative_earnings/)
    assert.match(control, /cash_flow_complete/)
  })

  it('covers source posting identity and cross-domain drift controls', () => {
    assert.match(control, /restaurant_financial_source_postings/)
    assert.match(control, /unique \(lodge_id, operation_id\)/)
    assert.match(control, /payload_hash<>coalesce\(p_payload_hash,''\)/)
    assert.match(control, /'ap_bill'/)
    assert.match(control, /'payroll'/)
    assert.match(control, /required_source_types/)
  })

  it('makes tabs server-valued, versioned, and retry-safe', () => {
    assert.match(tabs, /financial_snapshot/)
    assert.match(tabs, /tab_version/)
    assert.match(tabs, /tab_version_conflict/)
    assert.match(tabs, /payload_hash/)
    assert.match(posDomain, /get_restaurant_pos_tabs_financial_truth/)
    assert.match(posDomain, /source_tab_version/)
  })

  it('retires the editable legacy drawer close and its auto-close behavior', () => {
    assert.match(cash, /Legacy cash drawer close is retired/)
    assert.match(cash, /An open cash session already exists/)
    assert.doesNotMatch(cash, /update public\.restaurant_cash_drawer_sessions\s+set status = 'auto_closed'/)
  })

  it('marks unresolved offline accounting attempts durably and exports a versioned envelope', () => {
    assert.match(ui, /window\.localStorage/)
    assert.match(ui, /bar-accounting-financial-truth-v1/)
    assert.match(ui, /INCOMPLETE/)
    assert.match(ui, /SHA-256/)
  })
})
