const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function journalIntentStorageKey(lodgeId, actorId) {
  if (!lodgeId || !actorId) return ''
  return `restaurant-accounting:manual-journal:v2:${String(lodgeId).trim()}:${String(actorId).trim()}`
}

export function normalizeManualJournalPayload(journal) {
  const payload = {
    entry_date: String(journal?.entryDate || '').trim(),
    description: String(journal?.description || '').trim(),
    reference_number: String(journal?.referenceNumber || '').trim() || null,
    evidence_ref: String(journal?.evidenceRef || '').trim(),
    lines: Array.isArray(journal?.lines) ? journal.lines.map((line) => ({
      account_id: String(line?.accountId || '').trim(),
      debit: Number(line?.debit || 0),
      credit: Number(line?.credit || 0),
      memo: String(line?.memo || '').trim() || null
    })) : []
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date) || !payload.description || !payload.evidence_ref || payload.lines.length < 2) {
    throw new Error('Enter a date, description, evidence reference, and at least two journal lines.')
  }
  let debitCents = 0
  let creditCents = 0
  for (const line of payload.lines) {
    if (!line.account_id || !Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0 || !((line.debit > 0 && line.credit === 0) || (line.credit > 0 && line.debit === 0))) {
      throw new Error('Each journal line needs an account and exactly one positive debit or credit.')
    }
    debitCents += Math.round(line.debit * 100)
    creditCents += Math.round(line.credit * 100)
  }
  if (debitCents <= 0 || debitCents !== creditCents) throw new Error('The journal must balance to a non-zero amount.')
  return payload
}

export function createManualJournalIntent({ scopeKey, payload, operationId }) {
  if (!scopeKey || !UUID_PATTERN.test(String(operationId || ''))) throw new Error('A lodge-scoped recovery record and UUID operation key are required before submission.')
  return { version: 2, scopeKey, operationId: String(operationId).toLowerCase(), payload, state: 'unknown', draftId: null, status: null }
}

export function loadManualJournalIntent(storage, storageKey, scopeKey) {
  const raw = storage.getItem(storageKey)
  if (!raw) return null
  const intent = JSON.parse(raw)
  if (intent?.version !== 2 || intent.scopeKey !== scopeKey || !UUID_PATTERN.test(String(intent.operationId || '')) || !intent.payload || !Array.isArray(intent.payload.lines)) {
    throw new Error('A saved manual journal recovery record is unreadable. Do not start another submission until it is recovered.')
  }
  return intent
}

export function saveManualJournalIntent(storage, storageKey, intent) {
  storage.setItem(storageKey, JSON.stringify(intent))
}

export function restoreManualJournalForm(intent) {
  const payload = intent?.payload || {}
  return {
    entryDate: payload.entry_date || '',
    description: payload.description || '',
    referenceNumber: payload.reference_number || '',
    evidenceRef: payload.evidence_ref || '',
    lines: payload.lines.map((line) => ({ accountId: line.account_id || '', debit: String(line.debit ?? ''), credit: String(line.credit ?? ''), memo: line.memo || '' }))
  }
}
export function reconcileManualJournalStatus(intent, result) {
  if (!intent?.operationId || !intent?.payload) throw new Error('A saved manual journal intent is required for status recovery.')
  if (result?.found === true && result.id) {
    const status = String(result.status || '')
    const terminal = ['submitted', 'approved', 'posted', 'rejected'].includes(status)
    return {
      terminal,
      draftId: String(result.id),
      status,
      intent: terminal ? null : { ...intent, state: 'found', status: status || null, draftId: String(result.id) }
    }
  }
  // A point-in-time miss does not cancel an in-flight request. Preserve its
  // exact operation UUID and normalized payload for retries after restart.
  return { terminal: false, draftId: null, status: null, intent: { ...intent, state: 'not_found', status: null, draftId: null } }
}
