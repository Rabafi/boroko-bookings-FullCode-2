export function validateSingleStockQuantity(rawValue, mode) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) {
    return {
      ok: false,
      code: 'blank',
      message: mode === 'receive'
        ? 'Enter a positive quantity received.'
        : mode === 'waste'
        ? 'Enter a positive quantity wasted.'
        : 'Enter a physical quantity, including 0 when the count is zero.'
    }
  }

  const quantity = Number(raw)
  if (!Number.isFinite(quantity)) {
    return {
      ok: false,
      code: 'non_finite',
      message: 'Enter a finite numeric quantity.'
    }
  }

  if (mode === 'receive' && quantity <= 0) {
    return { ok: false, code: 'not_positive', message: 'Receive quantity must be greater than zero.' }
  }

  if (mode === 'waste' && quantity <= 0) {
    return { ok: false, code: 'not_positive', message: 'Waste quantity must be greater than zero.' }
  }

  if (mode === 'count' && quantity < 0) {
    return { ok: false, code: 'negative', message: 'Physical count must be zero or more.' }
  }

  return { ok: true, code: 'valid', quantity }
}

export function isPendingStockMutation(result = {}) {
  return result?.offline === true
    || result?.queued === true
    || result?.provisional === true
    || result?.server_complete === false
}

export function formatStockMutationNotice(mode, itemName, result) {
  const subject = mode === 'count' ? 'Physical count' : mode === 'waste' ? 'Waste' : 'Delivery'
  if (isPendingStockMutation(result)) {
    return subject + ' for ' + itemName + ' was saved provisionally and is pending server confirmation. It is not yet server-posted.'
  }
  return subject + ' for ' + itemName + ' was posted to the server.'
}
