const MONEY_EPSILON = 0.005

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100
}

function parseBreakdown(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {}
  }
  return []
}

export function classifyPosTransaction(order = {}) {
  const status = String(order.status || '').toLowerCase()
  const syncState = String(order._sync_state || '').toLowerCase()
  const transactionType = String(order.transaction_type || '').toLowerCase()
  if (['pending', 'failed', 'manual_review_required'].includes(syncState) || order._pending_sync === true) return 'pending'
  if (status === 'cancelled' || transactionType === 'cancelled') return 'cancelled'
  if (status === 'voided' || transactionType === 'void') return 'void'
  if (status === 'failed' || syncState === 'failed') return 'failed/manual review'
  if (transactionType === 'return' || number(order.total) < 0) return 'return'
  // A missing status is not evidence of a posted sale.  Historical rows with
  // no status must remain visible for investigation, but must never enter a
  // certified financial total.
  if (['completed', 'settled'].includes(status)) return 'sale'
  return 'failed/manual review'
}

export function posTenderRows(order = {}) {
  const parsed = parseBreakdown(order.payment_breakdown)
  return parsed.map((row, index) => ({
    tender_id: String(row.tender_id || row.id || `${order.id || 'order'}:${index}`),
    tender_index: index,
    method: String(row.method || row.type || order.payment_method || 'unknown').toLowerCase(),
    amount: roundMoney(row.amount),
    customer_id: row.customer_id || row.customer_account_id || null,
    voucher_id: row.voucher_id || null,
    reference: row.reference || row.approval_code || null,
    payload: row
  }))
}

/**
 * A payment method label is not a tender allocation. Reports may only show
 * tender totals when the persisted breakdown is an actual, reconciled
 * envelope. Older rows without payment_breakdown remain visible for review,
 * but must never be turned into a synthetic cash/card payment.
 */
export function hasRecordedPosTenderEnvelope(order = {}) {
  const parsed = parseBreakdown(order.payment_breakdown)
  if (parsed.length === 0) return false
  if (parsed.some((row) => !row || !String(row.method || row.type || '').trim() || !Number.isFinite(Number(row.amount)))) return false
  const expected = roundMoney(order.total)
  const actual = roundMoney(parsed.reduce((sum, row) => sum + Number(row.amount), 0))
  return Math.abs(expected - actual) <= MONEY_EPSILON
}

export function posItemSnapshotRows(order = {}) {
  const items = Array.isArray(order.pos_order_items) ? order.pos_order_items : (Array.isArray(order.items) ? order.items : [])
  return items.map((item) => ({
    order_id: order.id || null,
    item_id: item.id || null,
    item_name: item.item_name || item.name || '',
    quantity: number(item.quantity),
    unit_price: roundMoney(item.unit_price ?? item.price),
    // Quantity × unit price is a pricing estimate, not a posted line amount.
    // Keep it null when the persisted subtotal is absent so downstream reports
    // can fail closed instead of presenting reconstructed money as fact.
    gross: item.gross_subtotal === null || item.gross_subtotal === undefined || item.gross_subtotal === ''
      ? null
      : roundMoney(item.gross_subtotal),
    discount: roundMoney(item.discount_allocated ?? item.discount_total ?? 0),
    tax: roundMoney(item.tax_allocated ?? item.tax_total ?? 0),
    net: item.net_subtotal === null || item.net_subtotal === undefined || item.net_subtotal === ''
      ? (item.subtotal === null || item.subtotal === undefined || item.subtotal === '' ? null : roundMoney(item.subtotal))
      : roundMoney(item.net_subtotal),
    cost: item.cost_snapshot === null || item.cost_snapshot === undefined || item.cost_snapshot === ''
      ? (item.total_cost === null || item.total_cost === undefined || item.total_cost === '' ? null : roundMoney(item.total_cost))
      : roundMoney(item.cost_snapshot),
    inventory_item_id: item.inventory_item_id || null
  }))
}

export function calculatePosFinancialTruth(orders = [], source = {}) {
  const controls = {
    gross_sales: 0,
    discounts: 0,
    tax: 0,
    tips: 0,
    returns: 0,
    net_recorded_sales: 0,
    completed_sale_count: 0,
    return_count: 0,
    void_count: 0,
    cancelled_count: 0,
    pending_count: 0,
    failed_manual_review_count: 0,
    tender_totals: {}
  }
  const rows = (Array.isArray(orders) ? orders : []).map((order) => {
    const classification = classifyPosTransaction(order)
    const total = roundMoney(order.total)
    const gross = roundMoney(order.gross_total ?? (total > 0 ? total : 0))
    const discount = roundMoney(order.discount_total ?? 0)
    const tax = roundMoney(order.tax_total ?? 0)
    const tip = roundMoney(order.tip_total ?? 0)
    if (classification === 'sale') {
      controls.gross_sales += gross
      controls.discounts += discount
      controls.tax += tax
      controls.tips += tip
      controls.net_recorded_sales += total
      controls.completed_sale_count += 1
    } else if (classification === 'return') {
      controls.returns += Math.abs(total)
      controls.net_recorded_sales += total
      controls.return_count += 1
      controls.tax -= Math.abs(tax)
      controls.tips -= Math.abs(tip)
    } else if (classification === 'void') controls.void_count += 1
    else if (classification === 'cancelled') controls.cancelled_count += 1
    else if (classification === 'pending') controls.pending_count += 1
    else controls.failed_manual_review_count += 1
    // A payment_method label is not a persisted tender allocation.  Only an
    // amount-balanced breakdown is allowed into tender controls; historical
    // rows without that envelope remain visible in the transaction rows but
    // cannot become cash/card truth through client-side aggregation.
    const tenderEnvelopeComplete = hasRecordedPosTenderEnvelope(order)
    if ((classification === 'sale' || classification === 'return') && tenderEnvelopeComplete) {
      for (const tender of posTenderRows(order)) {
        // Tender rows are persisted with the same sign as the order total. A
        // return therefore already carries a negative amount. Normalize only
        // malformed historical data so the report cannot turn a refund into a
        // positive cash receipt by applying the return sign a second time.
        const signedAmount = classification === 'return' ? -Math.abs(tender.amount) : Math.abs(tender.amount)
        controls.tender_totals[tender.method] = roundMoney((controls.tender_totals[tender.method] || 0) + signedAmount)
      }
    }
    return {
      ...order,
      classification,
      business_date: order.business_date || String(order.created_at || '').slice(0, 10) || null,
      technical_created_at: order.created_at || null,
      transaction_type: order.transaction_type || (classification === 'return' ? 'return' : 'sale'),
      tender_envelope_complete: tenderEnvelopeComplete,
      tender_rows: posTenderRows(order),
      item_rows: posItemSnapshotRows(order)
    }
  })
  for (const key of ['gross_sales', 'discounts', 'tax', 'tips', 'returns', 'net_recorded_sales']) controls[key] = roundMoney(controls[key])
  for (const key of Object.keys(controls.tender_totals)) controls.tender_totals[key] = roundMoney(controls.tender_totals[key])
  controls.average_completed_sale = controls.completed_sale_count
    ? roundMoney((controls.net_recorded_sales + controls.returns) / controls.completed_sale_count)
    : 0
  controls.dataset_row_count = rows.length
  // Completeness is a server/report-run assertion.  Renderer-side row
  // aggregation may calculate controls for display, but it cannot certify the
  // dataset merely because an array was returned.
  controls.dataset_complete = source?.dataset_complete === true
  controls.dataset_status = controls.dataset_complete ? 'certified' : 'uncertified'
  controls.money_tolerance = MONEY_EPSILON
  return { rows, controls }
}

export function assertPosTenderTotal(order = {}) {
  return hasRecordedPosTenderEnvelope(order)
}
