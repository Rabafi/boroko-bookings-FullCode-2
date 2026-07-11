export function calculateLoyaltyEarn({ netSales = 0, earnRate = 1, minimumSpend = 0 } = {}) {
  const sales = normalizeMoney(netSales)
  const rate = Number(earnRate)
  const threshold = normalizeMoney(minimumSpend)
  if (!Number.isFinite(rate) || rate < 0) throw new Error('Loyalty earn rate must be zero or greater.')
  if (sales < threshold) return 0
  return Math.floor(sales * rate)
}

export function applyLoyaltyRedemption({ availablePoints = 0, redeemPoints = 0, pointValue = 0.01, orderTotal = 0 } = {}) {
  const available = Math.max(0, Math.floor(Number(availablePoints || 0)))
  const requested = Math.max(0, Math.floor(Number(redeemPoints || 0)))
  const value = Number(pointValue)
  const total = normalizeMoney(orderTotal)
  if (!Number.isFinite(value) || value < 0) throw new Error('Point value must be zero or greater.')

  const points_redeemed = Math.min(available, requested)
  const discount = Math.min(total, normalizeMoney(points_redeemed * value))
  return {
    points_redeemed,
    discount_amount: discount,
    remaining_points: available - points_redeemed,
    payable_total: normalizeMoney(total - discount)
  }
}

export function buildCustomerAccountEntry({ customerId, amount, type, referenceId, note } = {}) {
  const normalizedType = String(type || '').trim().toLowerCase()
  if (!customerId) throw new Error('Customer account entry requires customerId.')
  if (!['charge', 'payment', 'adjustment', 'reversal'].includes(normalizedType)) {
    throw new Error('Customer account entry type is invalid.')
  }
  const value = normalizeMoney(amount)
  if (value === 0) throw new Error('Customer account entry amount cannot be zero.')

  return {
    customer_id: customerId,
    type: normalizedType,
    amount: value,
    reference_id: referenceId || null,
    note: note || null,
    liability_delta: normalizedType === 'charge' ? value : -value
  }
}

export function calculateDeliverySettlement({ grossSales = 0, platformCommission = 0, deliveryFees = 0, adjustments = 0 } = {}) {
  const gross = normalizeMoney(grossSales)
  const commission = normalizeMoney(platformCommission)
  const fees = normalizeMoney(deliveryFees)
  const adjustmentTotal = normalizeMoney(adjustments)
  return {
    gross_sales: gross,
    platform_commission: commission,
    delivery_fees: fees,
    adjustments: adjustmentTotal,
    settlement_due: normalizeMoney(gross - commission + fees + adjustmentTotal)
  }
}

export function compareRestaurantOutlets(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const sales = normalizeMoney(row.sales)
      const cogs = normalizeMoney(row.cogs)
      const expenses = normalizeMoney(row.expenses)
      const profit = normalizeMoney(sales - cogs - expenses)
      return {
        outlet_id: row.outlet_id,
        outlet_name: row.outlet_name || 'Outlet',
        sales,
        cogs,
        expenses,
        profit,
        gross_margin_percent: sales > 0 ? Math.round(((sales - cogs) / sales) * 10000) / 100 : 0
      }
    })
    .sort((a, b) => b.profit - a.profit)
}

function normalizeMoney(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100) / 100
}
