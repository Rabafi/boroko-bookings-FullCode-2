// @ts-check

export const TENDER_METHODS = Object.freeze([
  'cash',
  'card',
  'mobile_money',
  'bank_transfer',
  'customer_credit',
  'voucher',
  'room_charge',
  'external'
])

export const PROVIDER_STATUSES = Object.freeze(['not_applicable', 'locally_asserted'])

const MONEY_TWO = /^\d+(?:\.\d{1,2})?$/
const QUANTITY_SIX = /^\d+(?:\.\d{1,6})?$/

/** @param {unknown} value */
export function moneyToCents(value) {
  const text = String(value ?? '').trim()
  if (!MONEY_TWO.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
  return Number.isSafeInteger(cents) ? cents : null
}

/** @param {number} cents */
export function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('Amount must be whole minor units.')
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** @param {unknown} value */
export function displayMinor(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toFixed(2)
}

/** @param {unknown} value */
export function isValidQuantity(value) {
  const text = String(value ?? '').trim()
  return QUANTITY_SIX.test(text) && Number(text) > 0
}

/** @param {Record<string, unknown>} [overrides] */
export function makeTenderRow(overrides = {}) {
  return {
    id: String(overrides.id ?? globalThis.crypto?.randomUUID?.() ?? `tender-${Math.random().toString(16).slice(2)}`),
    method: 'cash',
    amount: '',
    tendered: '',
    reference: '',
    provider_status: 'not_applicable',
    customer_id: '',
    voucher_code: '',
    ...overrides
  }
}

/** @param {string} method */
export function referenceRequired(method) {
  return ['card', 'mobile_money', 'bank_transfer', 'room_charge', 'external'].includes(method)
}

/** @param {string} method */
export function providerStatusRequired(method) {
  return ['card', 'mobile_money', 'bank_transfer', 'external'].includes(method)
}

/** @param {string} method */
export function defaultProviderStatus(method) {
  return providerStatusRequired(method) ? 'locally_asserted' : 'not_applicable'
}

/**
 * Evaluates split tender rows against the exact amount due.
 * Returns a ready-to-submit tender array or an actionable error.
 * @param {{ totalCents: number, rows: Array<Record<string, unknown>>, fillSingleCash?: boolean }} input
 */
export function evaluateTenders({ totalCents, rows, fillSingleCash = true }) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return { error: 'The amount due is not available. Refresh the total before taking payment.', tenders: [], sumCents: 0, remainingCents: 0, changeCents: 0 }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'Add at least one tender before taking payment.', tenders: [], sumCents: 0, remainingCents: totalCents, changeCents: 0 }
  }
  if (rows.length > 20) {
    return { error: 'A sale can carry at most 20 tenders.', tenders: [], sumCents: 0, remainingCents: totalCents, changeCents: 0 }
  }

  const tenders = []
  let sumCents = 0
  let changeCents = 0
  const singleCashBlank = fillSingleCash && rows.length === 1 && rows[0].method === 'cash' && String(rows[0].amount ?? '').trim() === ''

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const method = String(row.method ?? '')
    const label = `Tender ${index + 1}`
    if (!TENDER_METHODS.includes(method)) return { error: `${label}: choose a supported payment method.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
    if (method === 'room_charge') return { error: `${label}: room charges are unavailable in local Bar and require the hotel authority. Choose another tender.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
    const amountCents = singleCashBlank ? totalCents : moneyToCents(row.amount)
    if (amountCents === null || amountCents <= 0) return { error: `${label}: enter an amount greater than zero with up to two decimals.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
    sumCents += amountCents

    /** @type {Record<string, unknown>} */
    const tender = { method, amount: centsToMoney(amountCents) }

    if (method === 'cash') {
      const tenderedText = String(row.tendered ?? '').trim()
      if (tenderedText) {
        const tenderedCents = moneyToCents(tenderedText)
        if (tenderedCents === null || tenderedCents <= 0) return { error: `${label}: cash received must be greater than zero with up to two decimals.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
        if (tenderedCents < amountCents) return { error: `${label}: cash received cannot be less than the cash amount applied.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
        tender.tendered = centsToMoney(tenderedCents)
        changeCents += tenderedCents - amountCents
      } else {
        tender.tendered = centsToMoney(amountCents)
      }
      tender.provider_status = 'not_applicable'
    } else {
      if (providerStatusRequired(method)) {
        const status = String(row.provider_status ?? '')
        if (status !== 'locally_asserted') {
          return { error: `${label}: external provider confirmation is unavailable. Record this tender as locally asserted only.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
        }
        tender.provider_status = status
      } else {
        tender.provider_status = 'not_applicable'
      }
      if (referenceRequired(method) && !String(row.reference ?? '').trim()) {
        return { error: `${label}: enter the terminal, bank or room-charge reference.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
      }
      if (String(row.reference ?? '').trim()) tender.reference = String(row.reference).trim()
      if (method === 'customer_credit') {
        if (!String(row.customer_id ?? '').trim()) return { error: `${label}: select the customer account taking the credit.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
        tender.customer_id = String(row.customer_id).trim()
      }
      if (method === 'voucher') {
        if (!String(row.voucher_code ?? '').trim()) return { error: `${label}: enter the voucher code being redeemed.`, tenders: [], sumCents, remainingCents: totalCents - sumCents, changeCents }
        tender.voucher_code = String(row.voucher_code).trim().toUpperCase()
      }
    }
    tenders.push(tender)
  }

  const remainingCents = totalCents - sumCents
  if (remainingCents !== 0) {
    return {
      error: remainingCents > 0
        ? `Tenders are short by ${centsToMoney(remainingCents)}. Add the missing amount before taking payment.`
        : `Tenders exceed the amount due by ${centsToMoney(-remainingCents)}. Reduce a tender; only cash received above the cash applied may produce change.`,
      tenders: [],
      sumCents,
      remainingCents,
      changeCents
    }
  }
  return { error: '', tenders, sumCents, remainingCents: 0, changeCents }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export function updateTenderRow(rows, id, patch) {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

/** @param {Array<Record<string, unknown>>} rows */
export function addTenderRow(rows, overrides = {}) {
  if (rows.length >= 20) return rows
  return [...rows, makeTenderRow(overrides)]
}

/** @param {Array<Record<string, unknown>>} rows @param {string} id */
export function removeTenderRow(rows, id) {
  if (rows.length <= 1) return rows
  return rows.filter((row) => row.id !== id)
}
