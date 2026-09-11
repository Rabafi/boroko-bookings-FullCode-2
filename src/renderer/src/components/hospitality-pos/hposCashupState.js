/**
 * Cash-up values are evidence, not optional display numbers.  Keep the
 * normalisation deliberately strict so null, blank and non-finite transport
 * values cannot become a fabricated zero.
 */
export function parseRecordedMoney(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getCashupEvidence(submission = {}) {
  const expected = parseRecordedMoney(submission?.expected_cash_drawer)
  const counted = parseRecordedMoney(submission?.counted_by_method?.cash)
  return {
    expected,
    counted,
    complete: expected !== null && counted !== null,
    variance: expected === null || counted === null ? null : counted - expected,
  }
}

export function formatRecordedMoney(value, currency = 'P') {
  const parsed = parseRecordedMoney(value)
  if (parsed === null) return 'Unavailable'
  return currency + ' ' + parsed.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function cashupApprovalAllowed(submission) {
  return getCashupEvidence(submission).complete
}
