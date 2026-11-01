// @ts-check

/** @typedef {{option_id?: string, modifier_option_id?: string, price_delta: string | number}} BarCashModifierOption */
/** @typedef {{name?: string, required?: boolean, min_selections?: number, max_selections?: number, options?: BarCashModifierOption[]}} BarCashModifierGroup */
/** @typedef {{product_id: string, category?: string | null, price: string | number, tax_rate: string | number, modifier_groups?: BarCashModifierGroup[]}} BarCashEstimateProduct */
/** @typedef {{product: BarCashEstimateProduct, quantity: number, modifiers?: string[]}} BarCashEstimateLine */
/** @typedef {{promotion_id: string, code: string, discount_type: 'percent' | 'amount', percent: string, amount: string, minimum_subtotal: string, scope: 'all' | 'product' | 'category', product_id?: string, category?: string}} BarCashPromotion */
/** @typedef {{approval_threshold_percent: string, maximum_percent: string}} BarCashDiscountPolicy */
/** @typedef {{promotions: BarCashPromotion[], discountPolicy: BarCashDiscountPolicy}} BarCashPromotionSnapshot */

/** @param {unknown} value @param {number} scale @param {string} field */
function scaledDecimal(value, scale, field) {
  const text = String(value ?? '0')
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text)
  if (!match) throw new Error(`${field} is not a valid non-negative decimal.`)
  const whole = match[1]
  const fraction = match[2] || ''
  const kept = fraction.slice(0, scale)
  const excess = fraction.slice(scale)
  if (/[1-9]/.test(excess)) throw new Error(`${field} has more precision than this till can estimate safely.`)
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((kept + '0'.repeat(scale)).slice(0, scale) || '0')
}

/** Validate the untrusted cashier promotion snapshot and its authenticated scope.
 * @param {unknown} result
 * @param {string} businessId
 * @param {string} outletId
 * @returns {BarCashPromotionSnapshot}
 */
export function validateBarPromotionSnapshot(result, businessId, outletId) {
  const fail = () => { throw new Error('The active promotion snapshot has malformed values or is outside this Bar session scope. Refresh before trading.') }
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || /** @type {Record<string, unknown>} */ (result).complete !== true
    || !Array.isArray(/** @type {Record<string, unknown>} */ (result).unavailable) || /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (result).unavailable).length > 0
    || !/** @type {Record<string, unknown>} */ (result).scope || typeof /** @type {Record<string, unknown>} */ (result).scope !== 'object'
    || /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (result).scope).business_id !== businessId || /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (result).scope).outlet_id !== outletId
    || !/** @type {Record<string, unknown>} */ (result).data || typeof /** @type {Record<string, unknown>} */ (result).data !== 'object' || Array.isArray(/** @type {Record<string, unknown>} */ (result).data)
    || !Array.isArray(/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (result).data).promotions) || !/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (result).data).discount_policy) fail()
  // These views narrow only after the guards above; leaves stay unknown until checked below.
  const snapshot = /** @type {Record<string, unknown>} */ (result)
  const scope = /** @type {Record<string, unknown>} */ (snapshot.scope)
  const data = /** @type {Record<string, unknown>} */ (snapshot.data)
  const policy = /** @type {Record<string, unknown>} */ (data.discount_policy)
  const rawPromotions = /** @type {unknown[]} */ (data.promotions)
  const policyDecimal = /^(0|[1-9]\d*)(?:\.\d{1,4})?$/
  if (typeof policy.approval_threshold_percent !== 'string' || !policyDecimal.test(/** @type {string} */ (policy.approval_threshold_percent))
    || typeof policy.maximum_percent !== 'string' || !policyDecimal.test(/** @type {string} */ (policy.maximum_percent))) fail()
  if (scaledDecimal(/** @type {string} */ (policy.approval_threshold_percent), 4, 'Discount approval threshold') > 1000000n
    || scaledDecimal(/** @type {string} */ (policy.maximum_percent), 4, 'Discount maximum') > 1000000n) fail()
  const seen = new Set()
  const promotions = rawPromotions.map((promotion) => {
    if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)
      || typeof /** @type {Record<string, unknown>} */ (promotion).promotion_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).promotion_id))
      || typeof /** @type {Record<string, unknown>} */ (promotion).code !== 'string' || !/^[A-Z0-9_-]{1,32}$/.test(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).code))
      || seen.has(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).code))
      || !['percent', 'amount'].includes(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).discount_type))
      || typeof /** @type {Record<string, unknown>} */ (promotion).percent !== 'string' || !policyDecimal.test(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).percent))
      || typeof /** @type {Record<string, unknown>} */ (promotion).amount !== 'string' || !/^\d+\.\d{2}$/.test(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).amount))
      || typeof /** @type {Record<string, unknown>} */ (promotion).minimum_subtotal !== 'string' || !/^\d+\.\d{2}$/.test(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).minimum_subtotal))
      || !['all', 'product', 'category'].includes(/** @type {string} */ (/** @type {Record<string, unknown>} */ (promotion).scope))) fail()
    const row = /** @type {Record<string, unknown>} */ (promotion)
    const code = /** @type {string} */ (row.code)
    const discountType = /** @type {string} */ (row.discount_type)
    const percentText = /** @type {string} */ (row.percent)
    const amountText = /** @type {string} */ (row.amount)
    const minimumSubtotal = /** @type {string} */ (row.minimum_subtotal)
    const promotionScope = /** @type {string} */ (row.scope)
    const percent = scaledDecimal(percentText, 4, 'Promotion percentage')
    const amount = scaledDecimal(amountText, 2, 'Promotion amount')
    if (percent > 1000000n || (discountType === 'percent' && (percent <= 0n || amount !== 0n))
      || (discountType === 'amount' && (amount <= 0n || percent !== 0n))) fail()
    if (promotionScope === 'product' && (typeof row.product_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(/** @type {string} */ (row.product_id)))) fail()
    if (promotionScope === 'category' && (typeof row.category !== 'string' || row.category.length === 0)) fail()
    seen.add(code)
    return /** @type {BarCashPromotion} */ (row)
  })
  return { promotions, discountPolicy: /** @type {BarCashDiscountPolicy} */ (policy) }
}

/** Display-only estimate; the local service always reprices and validates. */
/** @param {BarCashEstimateLine[]} lines @param {BarCashPromotion | null} [promotion] */
export function estimateBarCashSale(lines, promotion = null) {
  const pricedLines = lines.map(({ product, quantity, modifiers = [] }) => {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Sale quantity must be a positive whole number.')
    const selected = new Set(modifiers)
    const groups = Array.isArray(product.modifier_groups) ? product.modifier_groups : []
    let modifierDeltaCents = 0n
    for (const group of groups) {
      const options = Array.isArray(group.options) ? group.options : []
      const groupSelected = options.filter((option) => selected.has(/** @type {string} */ (option.option_id ?? option.modifier_option_id)))
      const minimum = Number(group.min_selections ?? (group.required ? 1 : 0))
      const maximum = Number(group.max_selections ?? 1)
      if (groupSelected.length < minimum || groupSelected.length > maximum) {
        throw new Error(`Choose between ${minimum} and ${maximum} option(s) for ${String(group.name || 'this modifier group')}.`)
      }
      for (const option of groupSelected) modifierDeltaCents += scaledDecimal(option.price_delta, 2, 'Modifier price')
    }
    const priceCents = scaledDecimal(product.price, 2, 'Product price') + modifierDeltaCents
    const taxRate = scaledDecimal(product.tax_rate, 8, 'Tax rate')
    const subtotal = priceCents * BigInt(quantity)
    // PostgreSQL round(numeric, 2) rounds positive half-cent values upward.
    const tax = (subtotal * taxRate + 50000000n) / 100000000n
    return { product, subtotal, tax }
  })
  let discount = 0n
  if (promotion) {
    const code = String(promotion.code ?? '').trim().toUpperCase()
    if (!code) throw new Error('The selected promotion code is invalid. Refresh promotions before continuing.')
    const eligible = pricedLines.filter(({ product, subtotal }) => subtotal > 0n && (
      promotion.scope === 'all'
      || (promotion.scope === 'product' && String(product.product_id) === String(promotion.product_id))
      || (promotion.scope === 'category' && String(product.category ?? '').toLowerCase() === String(promotion.category ?? '').toLowerCase())
    ))
    const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.subtotal, 0n)
    if (eligible.length === 0) throw new Error('This promotion does not apply to the current sale.')
    if (eligibleSubtotal < scaledDecimal(promotion.minimum_subtotal ?? '0', 2, 'Promotion minimum')) {
      throw new Error('The current eligible subtotal does not meet this promotion minimum.')
    }
    if (promotion.discount_type === 'percent') {
      const percent = scaledDecimal(promotion.percent, 4, 'Promotion percentage')
      discount = (eligibleSubtotal * percent + 500_000n) / 1_000_000n
    } else if (promotion.discount_type === 'amount') {
      discount = scaledDecimal(promotion.amount, 2, 'Promotion amount')
    } else {
      throw new Error('This promotion has an unsupported discount type.')
    }
    if (discount <= 0n) throw new Error('This promotion currently has no value for the sale.')
    if (discount > eligibleSubtotal) discount = eligibleSubtotal
  }
  const subtotalCents = pricedLines.reduce((sum, line) => sum + line.subtotal, 0n)
  const taxCents = pricedLines.reduce((sum, line) => sum + line.tax, 0n)
  const grossCents = subtotalCents + taxCents
  return { subtotalCents, taxCents, grossCents, promotionDiscountCents: discount, totalCents: grossCents - discount }
}

/** @param {BarCashEstimateLine[]} lines @param {BarCashPromotion | null} [promotion] */
export function estimateBarCashDueCents(lines, promotion = null) {
  return estimateBarCashSale(lines, promotion).totalCents
}

/** Exact comparison using percentage values with up to four decimals. */
/** @param {unknown} discountCents @param {unknown} subtotalCents @param {unknown} thresholdPercent */
export function isDiscountApprovalRequired(discountCents, subtotalCents, thresholdPercent) {
  if (typeof discountCents !== 'bigint' || typeof subtotalCents !== 'bigint' || discountCents <= 0n || subtotalCents <= 0n) return false
  const threshold = scaledDecimal(thresholdPercent, 4, 'Discount approval threshold')
  return discountCents * 100n * 10000n > subtotalCents * threshold
}

/** @param {unknown} discountCents @param {unknown} subtotalCents @param {unknown} maximumPercent */
export function exceedsDiscountMaximum(discountCents, subtotalCents, maximumPercent) {
  if (typeof discountCents !== 'bigint' || typeof subtotalCents !== 'bigint' || discountCents <= 0n || subtotalCents <= 0n) return false
  const maximum = scaledDecimal(maximumPercent, 4, 'Discount maximum')
  return discountCents * 100n * 10000n > subtotalCents * maximum
}

/** @param {unknown} cents */
export function formatBarLocalMoney(cents) {
  if (typeof cents !== 'bigint' || cents < 0n) throw new Error('Money must be non-negative integer cents.')
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}
