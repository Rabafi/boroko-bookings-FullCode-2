// @ts-check
/**
 * @typedef {object} PosTotalItem
 * @property {unknown} [quantity]
 * @property {unknown} [unit_price]
 */

/**
 * @typedef {object} PosTotalOverrides
 * @property {unknown} [gross_total]
 * @property {unknown} [discount_total]
 * @property {unknown} [tax_rate]
 * @property {unknown} [tax_total]
 * @property {unknown} [tip_total]
 * @property {unknown} [total]
 */

/** @param {unknown} value @returns {number} */
export function normalizeMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

/** @param {unknown} value @returns {number} */
export function normalizePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
export function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * @param {PosTotalItem[]} [items]
 * @param {PosTotalOverrides} [data]
 * @returns {{gross_total: number, discount_total: number, tax_rate: number, tax_total: number, tip_total: number, net_total: number, total: number}}
 */
export function buildPosTotals(items = [], data = {}) {
  const itemSubtotal = (items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0
  );
  const grossFromItems = (items || []).reduce((sum, item) => {
    const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
    return lineTotal > 0 ? sum + lineTotal : sum;
  }, 0);
  const gross = normalizeMoney(data.gross_total ?? grossFromItems);
  const discount = normalizeMoney(data.discount_total ?? Math.max(0, gross - itemSubtotal));
  const taxableBase = Math.max(0, gross - discount);
  const taxRate = normalizePercent(data.tax_rate);
  const tax = normalizeMoney(
    data.tax_total ?? (taxRate > 0 ? taxableBase * taxRate / 100 : 0)
  );
  const tip = normalizeMoney(data.tip_total || 0);
  const net = normalizeMoney(data.total ?? (itemSubtotal + tax + tip));
  return {
    gross_total: gross,
    discount_total: discount,
    tax_rate: taxRate,
    tax_total: tax,
    tip_total: tip,
    net_total: net,
    total: net
  };
}
