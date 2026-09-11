const PROVIDER_METHODS = new Set(['card', 'mobile_money']);
const DIRECT_METHODS = new Set(['cash', 'card', 'mobile_money']);

function error(code, message) {
  return { ok: false, code, error: message, breakdown: [] };
}

function readCents(value, field, { blank = null } = {}) {
  if (value === null || value === undefined) return blank;
  if (typeof value === 'string' && value.trim() === '') return blank;
  if (typeof value !== 'string' && typeof value !== 'number') {
    return error('invalid_amount', `${field} must be a finite amount in cents.`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return error('invalid_amount', `${field} must be a finite amount in cents.`);
  }

  const cents = Math.round((numeric + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    return error('amount_out_of_range', `${field} is outside the safe cent range.`);
  }
  if (Math.abs(numeric * 100 - cents) > 1e-6) {
    return error('amount_must_be_cents', `${field} must use whole cents.`);
  }
  return cents;
}

function amount(cents) {
  return cents / 100;
}

function normalizeReference(references, method) {
  if (!PROVIDER_METHODS.has(method)) return { ok: true, value: null };
  const raw = references && typeof references === 'object' ? references[method] : null;
  const value = String(raw || '').trim();
  if (value.length > 120) {
    const label = method === 'mobile_money' ? 'mobile money' : 'card';
    return error(
      'provider_reference_too_long',
      `The ${label} reference must be 120 characters or fewer.`,
    );
  }
  return { ok: true, value: value || null };
}

function pushTender(rows, method, cents, references, extra = {}) {
  if (cents <= 0) return null;
  const reference = normalizeReference(references, method);
  if (!reference.ok) return reference;
  rows.push({ method, amount: amount(cents), ...extra, reference: reference.value });
  return null;
}

/**
 * Build the exact Bar Till tender envelope shown to the operator and sent to
 * create_pos_order_v3.
 *
 * All monetary inputs are validated as finite cent values. A voucher is
 * applied first, then a split cash amount (when selected), and the remaining
 * balance is assigned to the selected direct tender. A split must retain a
 * positive non-cash remainder; a full-voucher sale is the explicit exception
 * and contains only its voucher row. No zero-valued tender is submitted.
 */
export function buildBarTenderBreakdown({
  total,
  chargeToAccount = false,
  customerId = null,
  selectedCustomerId = null,
  paymentMethod = 'cash',
  splitCashAmount = null,
  splitRemainderMethod = 'card',
  voucherCode = '',
  voucherAmount = null,
  paymentReferences = {},
} = {}) {
  const totalCents = readCents(total, 'Order total', { blank: null });
  if (totalCents && totalCents.ok === false) return totalCents;
  if (totalCents === null || totalCents <= 0) {
    return error('invalid_total', 'Order total must be a positive finite amount in cents.');
  }

  const normalizedCustomerId = selectedCustomerId || customerId || null;
  if (chargeToAccount) {
    if (!normalizedCustomerId) {
      return error('customer_required', 'Select a customer before charging their account.');
    }
    return {
      ok: true,
      total: amount(totalCents),
      breakdown: [{
        method: 'account',
        amount: amount(totalCents),
        customer_id: normalizedCustomerId,
        reference: null,
      }],
    };
  }

  const method = String(paymentMethod || '').trim().toLowerCase();
  if (method !== 'split' && !DIRECT_METHODS.has(method)) {
    return error('invalid_payment_method', 'Select a supported payment method.');
  }
  if (method === 'split' && !PROVIDER_METHODS.has(String(splitRemainderMethod || '').trim().toLowerCase())) {
    return error('invalid_split_method', 'Choose card or mobile money for the split balance.');
  }

  const normalizedVoucherCode = String(voucherCode || '').trim().toUpperCase();
  const voucherCents = readCents(voucherAmount, 'Voucher amount', { blank: 0 });
  if (voucherCents && voucherCents.ok === false) return voucherCents;
  if (voucherCents < 0) return error('negative_voucher', 'Voucher amount cannot be negative.');
  if (normalizedVoucherCode && voucherCents <= 0) {
    return error('voucher_amount_required', 'Enter a positive voucher amount for the voucher code.');
  }
  if (!normalizedVoucherCode && voucherCents > 0) {
    return error('voucher_code_required', 'Enter a voucher code for the voucher amount.');
  }
  if (voucherCents > totalCents) {
    return error('voucher_over_allocation', 'Voucher amount cannot exceed the order total.');
  }

  const rows = [];
  if (voucherCents > 0) {
    rows.push({
      method: 'voucher',
      amount: amount(voucherCents),
      code: normalizedVoucherCode,
      reference: null,
    });
  }

  let remainingCents = totalCents - voucherCents;
  if (method === 'split') {
    const splitCashCents = readCents(splitCashAmount, 'Cash split amount', { blank: null });
    if (splitCashCents && splitCashCents.ok === false) return splitCashCents;
    if (splitCashCents === null) {
      // A full voucher is a complete tender envelope; do not invent a zero
      // cash or card row just because the payment control is still set to
      // split.
      if (remainingCents === 0) {
        return { ok: true, total: amount(totalCents), breakdown: rows };
      }
      return error('split_cash_required', 'Enter a positive cash amount for the split payment.');
    }
    if (splitCashCents <= 0) {
      return error('split_cash_required', 'Enter a positive cash amount for the split payment.');
    }
    if (splitCashCents > remainingCents) {
      return error('split_over_allocation', 'Cash split amount cannot exceed the remaining balance.');
    }
    if (splitCashCents === remainingCents) {
      return error('split_zero_remainder', 'Split payment must leave a positive card or mobile-money balance.');
    }
    const cashError = pushTender(rows, 'cash', splitCashCents, paymentReferences);
    if (cashError) return cashError;
    remainingCents -= splitCashCents;
    const remainderMethod = String(splitRemainderMethod || '').trim().toLowerCase();
    if (remainingCents > 0) {
      const remainderError = pushTender(rows, remainderMethod, remainingCents, paymentReferences);
      if (remainderError) return remainderError;
    }
  } else if (remainingCents > 0) {
    const directError = pushTender(rows, method, remainingCents, paymentReferences);
    if (directError) return directError;
  }

  if (rows.length === 0) {
    return error('zero_remainder', 'The tender breakdown must contain a positive recorded amount.');
  }
  const allocatedCents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
  if (allocatedCents !== totalCents) {
    return error('tender_total_mismatch', 'Tender amounts must add up exactly to the order total.');
  }
  return { ok: true, total: amount(totalCents), breakdown: rows };
}

export function tenderBreakdownTotal(breakdown = []) {
  const total = (Array.isArray(breakdown) ? breakdown : [])
    .reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

// Generic alias for callers that share the tender composer outside the Bar
// Till while keeping the Bar-specific name explicit at the renderer boundary.
export const buildTenderBreakdown = buildBarTenderBreakdown;
