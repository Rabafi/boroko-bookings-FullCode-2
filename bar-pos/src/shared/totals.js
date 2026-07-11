export function buildBarTotals(cart = []) {
  const subtotal = cart.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0)
  const tax = 0
  const total = subtotal + tax
  return { subtotal: round(subtotal), tax: round(tax), total: round(total) }
}

export function round(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

export function normalizeMoney(v) {
  const n = Number(v)
  return Number.isFinite(n) ? round(n) : 0
}
