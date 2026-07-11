import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyLoyaltyRedemption,
  buildCustomerAccountEntry,
  calculateDeliverySettlement,
  calculateLoyaltyEarn,
  compareRestaurantOutlets
} from '../src/shared/restaurantGrowth.js'

test('loyalty earn and redemption are bounded and reversible by ledger semantics', () => {
  assert.equal(calculateLoyaltyEarn({ netSales: 120, earnRate: 1 }), 120)
  assert.equal(calculateLoyaltyEarn({ netSales: 49, earnRate: 1, minimumSpend: 50 }), 0)

  assert.deepEqual(
    applyLoyaltyRedemption({ availablePoints: 500, redeemPoints: 300, pointValue: 0.02, orderTotal: 20 }),
    {
      points_redeemed: 300,
      discount_amount: 6,
      remaining_points: 200,
      payable_total: 14
    }
  )

  assert.equal(
    applyLoyaltyRedemption({ availablePoints: 500, redeemPoints: 2000, pointValue: 0.1, orderTotal: 20 }).payable_total,
    0
  )
})

test('customer account entries use signed liability deltas', () => {
  const charge = buildCustomerAccountEntry({ customerId: 'cust-1', type: 'charge', amount: 75, referenceId: 'order-1' })
  const payment = buildCustomerAccountEntry({ customerId: 'cust-1', type: 'payment', amount: 50, referenceId: 'pay-1' })
  assert.equal(charge.liability_delta, 75)
  assert.equal(payment.liability_delta, -50)
  assert.throws(() => buildCustomerAccountEntry({ customerId: 'cust-1', type: 'unknown', amount: 1 }), /invalid/)
})

test('delivery settlement separates gross sales from platform commissions and fees', () => {
  assert.deepEqual(
    calculateDeliverySettlement({ grossSales: 1000, platformCommission: 180, deliveryFees: 35, adjustments: -10 }),
    {
      gross_sales: 1000,
      platform_commission: 180,
      delivery_fees: 35,
      adjustments: -10,
      settlement_due: 845
    }
  )
})

test('multi-outlet comparison ranks outlets by profit and calculates margin', () => {
  const rows = compareRestaurantOutlets([
    { outlet_id: 'bar', outlet_name: 'Bar', sales: 2000, cogs: 700, expenses: 250 },
    { outlet_id: 'kitchen', outlet_name: 'Kitchen', sales: 3000, cogs: 1400, expenses: 800 }
  ])

  assert.equal(rows[0].outlet_id, 'bar')
  assert.equal(rows[0].profit, 1050)
  assert.equal(rows[0].gross_margin_percent, 65)
  assert.equal(rows[1].profit, 800)
})
