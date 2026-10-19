// @ts-check
const MONEY_EPSILON = 0.005

/** @typedef {{gross_sales: number, discounts: number, tax: number, tips: number, returns: number, net_recorded_sales: number, completed_sale_count: number, return_count: number, void_count: number, cancelled_count: number, pending_count: number, failed_manual_review_count: number, tender_totals: Record<string, number>, average_completed_sale?: number, dataset_row_count?: number, dataset_complete?: boolean, dataset_status?: string, money_tolerance?: number}} PosControls */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} values @param {(value: unknown, index: number, values: unknown) => unknown} mapper @returns {unknown} */
function mapItems(values, mapper) {
  const mapMethod = readField(values, 'map')
  if (typeof mapMethod !== 'function') throw new TypeError('items.map is not a function')
  return Reflect.apply(mapMethod, values, [mapper])
}

/** @param {unknown} value @returns {number} */
function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** @param {unknown} value @returns {number} */
function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100
}

/** @param {unknown} value @returns {unknown[]} */
function parseBreakdown(value) {
  if (Array.isArray(value)) return /** @type {unknown[]} */ (value)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(value))
      return Array.isArray(parsed) ? /** @type {unknown[]} */ (parsed) : []
    } catch {}
  }
  return []
}

/** @param {unknown} [order] @returns {'pending' | 'cancelled' | 'void' | 'failed/manual review' | 'return' | 'sale'} */
export function classifyPosTransaction(order = {}) {
  const status = String(readField(order, 'status') || '').toLowerCase()
  const syncState = String(readField(order, '_sync_state') || '').toLowerCase()
  const transactionType = String(readField(order, 'transaction_type') || '').toLowerCase()
  if (['pending', 'failed', 'manual_review_required'].includes(syncState) || readField(order, '_pending_sync') === true) return 'pending'
  if (status === 'cancelled' || transactionType === 'cancelled') return 'cancelled'
  if (status === 'voided' || transactionType === 'void') return 'void'
  if (status === 'failed' || syncState === 'failed') return 'failed/manual review'
  if (transactionType === 'return' || number(readField(order, 'total')) < 0) return 'return'
  // A missing status is not evidence of a posted sale.  Historical rows with
  // no status must remain visible for investigation, but must never enter a
  // certified financial total.
  if (['completed', 'settled'].includes(status)) return 'sale'
  return 'failed/manual review'
}

/** @param {unknown} [order] */
export function posTenderRows(order = {}) {
  const parsed = parseBreakdown(readField(order, 'payment_breakdown'))
  return parsed.map((rawRow, index) => {
    return ({
    tender_id: String(readField(rawRow, 'tender_id') || readField(rawRow, 'id') || `${readField(order, 'id') || 'order'}:${index}`),
    tender_index: index,
    method: String(readField(rawRow, 'method') || readField(rawRow, 'type') || readField(order, 'payment_method') || 'unknown').toLowerCase(),
    amount: roundMoney(readField(rawRow, 'amount')),
    customer_id: readField(rawRow, 'customer_id') || readField(rawRow, 'customer_account_id') || null,
    voucher_id: readField(rawRow, 'voucher_id') || null,
    reference: readField(rawRow, 'reference') || readField(rawRow, 'approval_code') || null,
    payload: rawRow
    })
  })
}

/**
 * A payment method label is not a tender allocation. Reports may only show
 * tender totals when the persisted breakdown is an actual, reconciled
 * envelope. Older rows without payment_breakdown remain visible for review,
 * but must never be turned into a synthetic cash/card payment.
 */
/** @param {unknown} [order] @returns {boolean} */
export function hasRecordedPosTenderEnvelope(order = {}) {
  const parsed = parseBreakdown(readField(order, 'payment_breakdown'))
  if (parsed.length === 0) return false
  /** @param {unknown} rawRow */
  const malformed = (rawRow) => {
    return !rawRow || !String(readField(rawRow, 'method') || readField(rawRow, 'type') || '').trim() || !Number.isFinite(Number(readField(rawRow, 'amount')))
  }
  if (parsed.some(malformed)) return false
  const expected = roundMoney(readField(order, 'total'))
  const actual = roundMoney(parsed.reduce(
    /** @param {number} sum @param {unknown} rawRow @returns {number} */
    (sum, rawRow) => sum + Number(readField(rawRow, 'amount')),
    0,
  ))
  return Math.abs(expected - actual) <= MONEY_EPSILON
}

/** @param {unknown} [order] */
export function posItemSnapshotRows(order = {}) {
  const items = Array.isArray(readField(order, 'pos_order_items'))
    ? readField(order, 'pos_order_items')
    : (Array.isArray(readField(order, 'items')) ? readField(order, 'items') : [])
  return mapItems(items, (rawItem, index) => {
    return ({
    order_id: readField(order, 'id') || null,
    item_id: readField(rawItem, 'id') || null,
    item_name: readField(rawItem, 'item_name') || readField(rawItem, 'name') || '',
    quantity: number(readField(rawItem, 'quantity')),
    unit_price: roundMoney(readField(rawItem, 'unit_price') ?? readField(rawItem, 'price')),
    // Quantity × unit price is a pricing estimate, not a posted line amount.
    // Keep it null when the persisted subtotal is absent so downstream reports
    // can fail closed instead of presenting reconstructed money as fact.
    gross: readField(rawItem, 'gross_subtotal') === null || readField(rawItem, 'gross_subtotal') === undefined || readField(rawItem, 'gross_subtotal') === ''
      ? null
      : roundMoney(readField(rawItem, 'gross_subtotal')),
    discount: roundMoney(readField(rawItem, 'discount_allocated') ?? readField(rawItem, 'discount_total') ?? 0),
    tax: roundMoney(readField(rawItem, 'tax_allocated') ?? readField(rawItem, 'tax_total') ?? 0),
    net: readField(rawItem, 'net_subtotal') === null || readField(rawItem, 'net_subtotal') === undefined || readField(rawItem, 'net_subtotal') === ''
      ? (readField(rawItem, 'subtotal') === null || readField(rawItem, 'subtotal') === undefined || readField(rawItem, 'subtotal') === '' ? null : roundMoney(readField(rawItem, 'subtotal')))
      : roundMoney(readField(rawItem, 'net_subtotal')),
    cost: readField(rawItem, 'cost_snapshot') === null || readField(rawItem, 'cost_snapshot') === undefined || readField(rawItem, 'cost_snapshot') === ''
      ? (readField(rawItem, 'total_cost') === null || readField(rawItem, 'total_cost') === undefined || readField(rawItem, 'total_cost') === '' ? null : roundMoney(readField(rawItem, 'total_cost')))
      : roundMoney(readField(rawItem, 'cost_snapshot')),
    inventory_item_id: readField(rawItem, 'inventory_item_id') || null
    })
  })
}

/** @param {unknown} [orders] @param {{dataset_complete?: unknown}} [source] */
export function calculatePosFinancialTruth(orders = [], source = {}) {
  /** @type {PosControls} */
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
    tender_totals: /** @type {Record<string, number>} */ ({})
  }
  const rawOrders = Array.isArray(orders) ? /** @type {unknown[]} */ (orders) : []
  const rows = rawOrders.map((rawOrder) => {
    // Preserve the current direct object processing; malformed entries retain
    // their existing runtime behavior rather than being silently discarded.
    const order = rawOrder
    const classification = classifyPosTransaction(order)
    const total = roundMoney(readField(order, 'total'))
    const gross = roundMoney(readField(order, 'gross_total') ?? (total > 0 ? total : 0))
    const discount = roundMoney(readField(order, 'discount_total') ?? 0)
    const tax = roundMoney(readField(order, 'tax_total') ?? 0)
    const tip = roundMoney(readField(order, 'tip_total') ?? 0)
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
      ...Object(order),
      classification,
      business_date: readField(order, 'business_date') || String(readField(order, 'created_at') || '').slice(0, 10) || null,
      technical_created_at: readField(order, 'created_at') || null,
      transaction_type: readField(order, 'transaction_type') || (classification === 'return' ? 'return' : 'sale'),
      tender_envelope_complete: tenderEnvelopeComplete,
      tender_rows: posTenderRows(order),
      item_rows: posItemSnapshotRows(order)
    }
  })
  for (const key of /** @type {Array<keyof Pick<PosControls, 'gross_sales' | 'discounts' | 'tax' | 'tips' | 'returns' | 'net_recorded_sales'>>} */ (['gross_sales', 'discounts', 'tax', 'tips', 'returns', 'net_recorded_sales'])) controls[key] = roundMoney(controls[key])
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

/** @param {unknown} [order] @returns {boolean} */
export function assertPosTenderTotal(order = {}) {
  return hasRecordedPosTenderEnvelope(order)
}
