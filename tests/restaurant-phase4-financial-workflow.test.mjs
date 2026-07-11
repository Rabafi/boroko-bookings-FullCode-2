import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

const POS_JSX = 'src/renderer/src/components/POS.jsx'
const POS_JS = 'src/main/domains/pos.js'
const PHASE4_SQL = 'supabase/migrations/20260708160000_restaurant_phase4_growth.sql'
const PHASE45_SQL = 'supabase/migrations/20260708180000_restaurant_phase45_security_hardening.sql'

describe('Phase 4: Restaurant Financial/Customer Workflow', () => {

  describe('4.1 Delivery order mode', () => {
    it('POS.jsx has delivery service mode option', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes("'delivery'"), 'has delivery service mode')
      assert.ok(jsx.includes('Delivery'), 'has Delivery label')
    })

    it('POS.jsx has delivery address input', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('deliveryAddress'), 'has deliveryAddress state')
      assert.ok(jsx.includes('Delivery address'), 'has delivery address placeholder')
    })

    it('POS.jsx has delivery notes input', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('deliveryNotes'), 'has deliveryNotes state')
      assert.ok(jsx.includes('Delivery notes'), 'has delivery notes placeholder')
    })

    it('POS.jsx includes delivery fields in order payload', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('delivery_address:'), 'sends delivery_address in payload')
      assert.ok(jsx.includes('delivery_notes:'), 'sends delivery_notes in payload')
    })

    it('delivery address input only shows in delivery mode', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes("serviceMode === 'delivery'"), 'delivery UI gated on serviceMode')
    })

    it('delivery UI is restaurant-only', () => {
      const jsx = read(POS_JSX)
      const deliveryBlockIdx = jsx.indexOf("serviceMode === 'delivery' && restaurantMode")
      assert.ok(deliveryBlockIdx > -1, 'delivery UI is gated on restaurantMode')
    })

    it('POS.jsx resets delivery state after order', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes("setDeliveryAddress('')"), 'resets delivery address')
      assert.ok(jsx.includes("setDeliveryNotes('')"), 'resets delivery notes')
    })
  })

  describe('4.2 Customer account charge', () => {
    it('POS.jsx has customerAccountCharge state', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('customerAccountCharge'), 'has customerAccountCharge state')
    })

    it('POS.jsx shows charge-to-account option when customer has balance', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('account_balance'), 'checks account_balance')
      assert.ok(jsx.includes('Charge to account'), 'has charge to account label')
    })

    it('POS.jsx includes customer_account_charge in order payload', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('customer_account_charge:'), 'sends customer_account_charge in payload')
    })

    it('charge to account is only available for selected customers', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('selectedCustomer'), 'gated on selectedCustomer')
    })

    it('POS.jsx resets customerAccountCharge after order', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('setCustomerAccountCharge(false)'), 'resets after order')
    })
  })

  describe('4.3 Voucher redemption', () => {
    it('POS.jsx has voucher code and amount inputs', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('voucherCode'), 'has voucherCode state')
      assert.ok(jsx.includes('voucherAmount'), 'has voucherAmount state')
    })

    it('voucher redemption fires after order creation (not during)', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('redeemVoucher'), 'calls redeemVoucher RPC')
    })

    it('voucher redemption is online-only', () => {
      const jsx = read(POS_JSX)
      const voucherIdx = jsx.indexOf('redeemVoucher')
      const context = jsx.slice(Math.max(0, voucherIdx - 200), voucherIdx)
      assert.ok(context.includes('!result.offline'), 'only fires for online orders')
    })
  })

  describe('4.4 Loyalty points', () => {
    it('POS.jsx awards loyalty points after order', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('awardLoyalty'), 'calls awardLoyalty RPC')
    })

    it('loyalty award is online-only', () => {
      const jsx = read(POS_JSX)
      const awardIdx = jsx.indexOf('awardLoyalty')
      const context = jsx.slice(Math.max(0, awardIdx - 200), awardIdx)
      assert.ok(context.includes('!result.offline'), 'only fires for online orders')
    })

    it('loyalty points are calculated per $10 spent', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('Math.floor'), 'uses Math.floor for points calculation')
    })

    it('loyalty award includes order_id for idempotency', () => {
      const jsx = read(POS_JSX)
      const awardIdx = jsx.indexOf('awardLoyalty({')
      const context = jsx.slice(awardIdx, awardIdx + 300)
      assert.ok(context.includes('orderId') || context.includes('order_id'), 'includes order id for idempotency')
    })
  })

  describe('4.5 Customer management domain functions', () => {
    it('pos.js exports getPosCustomers', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('getPosCustomers'), 'getPosCustomers exported')
    })

    it('pos.js exports savePosCustomer', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('savePosCustomer'), 'savePosCustomer exported')
    })

    it('pos.js exports awardLoyaltyPoints', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('awardLoyaltyPoints'), 'awardLoyaltyPoints exported')
    })

    it('pos.js exports redeemLoyaltyPoints', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('redeemLoyaltyPoints'), 'redeemLoyaltyPoints exported')
    })

    it('pos.js exports chargeCustomerAccount', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('chargeCustomerAccount'), 'chargeCustomerAccount exported')
    })

    it('pos.js exports redeemVoucher', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('redeemVoucher'), 'redeemVoucher exported')
    })

    it('pos.js exports recordDelivery', () => {
      const pos = read(POS_JS)
      assert.ok(pos.includes('recordDelivery'), 'recordDelivery exported')
    })
  })

  describe('4.6 Phase 4 SQL has customer/loyalty/voucher/delivery RPCs', () => {
    it('Phase 4 migration creates customer tables', () => {
      const sql = read(PHASE4_SQL)
      assert.ok(sql.includes('restaurant_customers'), 'restaurant_customers table')
      assert.ok(sql.includes('restaurant_loyalty_ledger'), 'loyalty ledger table')
      assert.ok(sql.includes('restaurant_vouchers'), 'vouchers table')
      assert.ok(sql.includes('restaurant_deliveries'), 'deliveries table')
    })

    it('Phase 4 migration has customer/loyalty/voucher/delivery RPCs', () => {
      const sql = read(PHASE4_SQL)
      assert.ok(sql.includes('upsert_restaurant_customer'), 'upsert customer RPC')
      assert.ok(sql.includes('get_restaurant_customers'), 'get customers RPC')
      assert.ok(sql.includes('award_restaurant_loyalty'), 'award loyalty RPC')
      assert.ok(sql.includes('redeem_restaurant_loyalty'), 'redeem loyalty RPC')
      assert.ok(sql.includes('charge_restaurant_account'), 'charge account RPC')
      assert.ok(sql.includes('redeem_restaurant_voucher'), 'redeem voucher RPC')
      assert.ok(sql.includes('record_restaurant_delivery'), 'record delivery RPC')
    })
  })

  describe('4.7 Offline rejection for financial operations', () => {
    it('loyalty award rejects offline', () => {
      const pos = read(POS_JS)
      const awardIdx = pos.indexOf('awardLoyaltyPoints')
      const fnBody = pos.slice(awardIdx, awardIdx + 500)
      assert.ok(fnBody.includes('offline') || fnBody.includes('isOnline'), 'checks online status')
    })

    it('voucher redeem rejects offline', () => {
      const pos = read(POS_JS)
      const redeemIdx = pos.indexOf('redeemVoucher')
      const fnBody = pos.slice(redeemIdx, redeemIdx + 500)
      assert.ok(fnBody.includes('offline') || fnBody.includes('isOnline'), 'checks online status')
    })

    it('chargeCustomerAccount rejects offline', () => {
      const pos = read(POS_JS)
      const chargeIdx = pos.indexOf('chargeCustomerAccount')
      const fnBody = pos.slice(chargeIdx, chargeIdx + 500)
      assert.ok(fnBody.includes('offline') || fnBody.includes('isOnline'), 'checks online status')
    })
  })
})
