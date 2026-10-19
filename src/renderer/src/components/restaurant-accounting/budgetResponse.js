const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalidBudgetResponse = () => ({
  valid: false,
  data: { matrix: [], templates: [], version_id: null, version_status: null, complete: false },
  error: 'Budget data response is invalid. Refresh the budget matrix; saving and approval are disabled.'
})

export function normalizeBudgetResponse(response) {
  const envelope = isRecord(response) && isRecord(response.data) ? response.data : response
  if (!isRecord(envelope) || !Array.isArray(envelope.matrix) || typeof envelope.complete !== 'boolean') return invalidBudgetResponse()

  const matrix = []
  for (const row of envelope.matrix) {
    if (!isRecord(row) || typeof row.account_id !== 'string' || !row.account_id.trim() || typeof row.code !== 'string' || typeof row.name !== 'string' || !['revenue', 'expense'].includes(row.account_type) || !isRecord(row.months)) return invalidBudgetResponse()
    const months = {}
    for (const [month, rawAmount] of Object.entries(row.months)) {
      if (!/^(?:[1-9]|1[0-2])$/.test(month)) return invalidBudgetResponse()
      const amount = Number(rawAmount)
      if (!Number.isFinite(amount) || amount < 0) return invalidBudgetResponse()
      months[month] = amount
    }
    matrix.push({ ...row, months })
  }

  // Older servers omitted templates. That omission is safe; a present but
  // malformed value is a contract failure, so it cannot reach a mutating UI.
  const templates = Object.prototype.hasOwnProperty.call(envelope, 'templates') ? envelope.templates : []
  if (!Array.isArray(templates) || templates.some((item) => !isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !Array.isArray(item.lines))) return invalidBudgetResponse()

  return {
    valid: true,
    data: { ...envelope, matrix, templates, complete: envelope.complete },
    error: envelope.complete ? '' : 'Budget data is incomplete. Resolve the missing active accounts before saving or approving.'
  }
}