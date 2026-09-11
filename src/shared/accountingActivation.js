/**
 * Activation-state reconciliation (pure, testable).
 *
 * An activation request is snapshotted immutably BEFORE dispatch so form
 * edits during the request cannot alter it. After an uncertain response,
 * authoritative state is compared against the ENTIRE requested tuple
 * (lodge, effective date, configuration version, policy version, cutover
 * batch). Missing fields are unavailable evidence, never null matches:
 * an older active configuration under different arguments must never
 * confirm the requested change.
 *
 * Fail-closed rules (second verification pass):
 * - Authoritative `active` must be an explicit boolean. Missing or
 *   malformed `active` is unreadable; `status` alone never confirms.
 * - `active === false` is NEVER overridden by `status`. A row that reads
 *   status:active with active:false is the future-effective (scheduled)
 *   SQL state: verdict 'inactive' with scheduled:true, never 'exact-match'.
 * - Cutover identity has ONE canonical field,
 *   `historical_cutover_batch_id`. Compatibility aliases are accepted only
 *   when they agree; conflicting values are unreadable. For a no-cutover
 *   request only an explicitly present null matches; a missing/undefined
 *   key is unreadable. Malformed identity values are rejected, never
 *   coerced into evidence with String().
 */

function cleanText(value) {
  const text = String(value || '').trim()
  return text || null
}

export function snapshotActivationRequest({
  lodgeId = null,
  effectiveFrom = null,
  configurationVersion = null,
  policyVersion = null,
  cutoverBatchId = null
} = {}) {
  return Object.freeze({
    lodgeId: cleanText(lodgeId),
    effectiveFrom: cleanText(effectiveFrom),
    configurationVersion: cleanText(configurationVersion),
    policyVersion: cleanText(policyVersion),
    cutoverBatchId: cleanText(cutoverBatchId)
  })
}

// Strict text field: only a non-blank string is evidence. Explicit null
// stays null (present-but-empty). Blank strings and every non-string,
// non-null value are MALFORMED (undefined) — never coerced, and never an
// implicit null match. This keeps explicit null distinct from blank or
// malformed identity everywhere below.
function strictText(value) {
  if (value === null) return { present: true, value: null, malformed: false }
  if (typeof value !== 'string') return { present: value !== undefined, value: undefined, malformed: value !== undefined }
  if (value.trim() === '') return { present: true, value: undefined, malformed: true }
  return { present: true, value: value.trim(), malformed: false }
}

function readLodge(authoritative) {
  if (!authoritative || typeof authoritative !== 'object' || Array.isArray(authoritative)) {
    return { present: false, value: undefined, malformed: true }
  }
  const raw = authoritative.lodge_id !== undefined ? authoritative.lodge_id : authoritative.lodgeId
  return strictText(raw === undefined ? undefined : raw)
}

// One canonical cutover field. Aliases agree or the state is unreadable.
// Blank strings are malformed evidence, never an implicit null.
const CUTOVER_ALIASES = ['historical_cutover_batch_id', 'cutover_batch_id', 'cutoverBatchId']

function readCutover(authoritative) {
  const seen = []
  for (const name of CUTOVER_ALIASES) {
    const raw = authoritative[name]
    if (raw === undefined) continue
    const parsed = strictText(raw)
    if (parsed.malformed || parsed.value === undefined) {
      return { present: true, value: undefined, conflict: false, malformed: true }
    }
    seen.push(parsed.value)
  }
  if (seen.length === 0) return { present: false, value: undefined, conflict: false, malformed: false }
  const first = seen[0]
  const conflict = seen.some((value) => value !== first)
  return { present: true, value: first, conflict, malformed: false }
}

function readScalar(authoritative, names) {
  for (const name of names) {
    const raw = authoritative[name]
    if (raw === undefined || raw === null) continue
    const parsed = strictText(raw)
    if (parsed.malformed || parsed.value === undefined) return { present: true, value: undefined, malformed: true }
    return { present: true, value: parsed.value, malformed: false }
  }
  return { present: false, value: null, malformed: false }
}

/**
 * Strict source-identity reader shared by snapshot creation, preflight,
 * and outcome reconciliation (H3). The canonical field is
 * `source_manifest_hash`; `sourceManifestHash` is a compatibility alias.
 * Returns { present, value, malformed, conflict }:
 * - absent (both undefined): present:false — unavailable evidence.
 * - explicit null: present:true, value:null — the documented nullable case
 *   (history-free batches carry no source manifest), matched null-safely.
 * - non-blank string: present:true with the trimmed value.
 * - blank string / wrong type: malformed — never normalized to null.
 * - both keys present with different normalized values: conflict.
 */
export function readSourceEvidence(record = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { present: false, value: undefined, malformed: true, conflict: false }
  }
  const canonical = record.source_manifest_hash
  const alias = record.sourceManifestHash
  const normalize = (raw) => {
    if (raw === undefined) return { defined: false, value: undefined, malformed: false }
    if (raw === null) return { defined: true, value: null, malformed: false }
    if (typeof raw !== 'string') return { defined: true, value: undefined, malformed: true }
    if (raw.trim() === '') return { defined: true, value: undefined, malformed: true }
    return { defined: true, value: raw.trim(), malformed: false }
  }
  const first = normalize(canonical)
  const second = normalize(alias)
  if (first.malformed || second.malformed) {
    return { present: true, value: undefined, malformed: true, conflict: false }
  }
  if (first.defined && second.defined && first.value !== second.value) {
    return { present: true, value: undefined, malformed: false, conflict: true }
  }
  if (first.defined) return { present: true, value: first.value, malformed: false, conflict: false }
  if (second.defined) return { present: true, value: second.value, malformed: false, conflict: false }
  return { present: false, value: undefined, malformed: false, conflict: false }
}

/**
 * Compare a requested tuple against authoritative activation state.
 * Returns { verdict, mismatches, readable, scheduled } where verdict is:
 * - 'exact-match': explicitly active and every requested field equals state.
 * - 'active-different': explicitly active, but at least one field differs.
 * - 'inactive': readable state that is not currently active (includes the
 *   scheduled future-effective state; see `scheduled`).
 * - 'unreadable': state missing, malformed, or missing required identity.
 */
export function compareActivationState(requested = {}, authoritative = {}) {
  const wanted = {
    lodgeId: cleanText(requested.lodgeId),
    effectiveFrom: cleanText(requested.effectiveFrom),
    configurationVersion: cleanText(requested.configurationVersion),
    policyVersion: cleanText(requested.policyVersion),
    cutoverBatchId: cleanText(requested.cutoverBatchId)
  }
  const unreadable = (mismatches) => ({ verdict: 'unreadable', mismatches, readable: false, scheduled: false })
  if (!authoritative || typeof authoritative !== 'object' || Array.isArray(authoritative)) {
    return unreadable(['activation state is missing or malformed'])
  }
  const lodge = readLodge(authoritative)
  if (lodge.malformed || !wanted.lodgeId || lodge.value === undefined || !lodge.value) {
    return unreadable(['lodge identity is unavailable evidence'])
  }
  const cutover = readCutover(authoritative)
  if (cutover.malformed) return unreadable(['cutover batch identity is malformed evidence'])
  if (cutover.conflict) return unreadable(['cutover batch identity aliases disagree'])
  if (wanted.cutoverBatchId && !cutover.value) {
    return unreadable(['cutover batch identity is unavailable evidence'])
  }
  // A no-cutover request matches only an explicitly present null. A missing
  // key is unavailable evidence, never an implicit null match.
  if (!wanted.cutoverBatchId && !cutover.present) {
    return unreadable(['cutover batch identity is unavailable evidence'])
  }
  const effectiveFrom = readScalar(authoritative, ['effective_from', 'effectiveFrom'])
  const configurationVersion = readScalar(authoritative, ['configuration_version', 'configurationVersion'])
  const policyVersion = readScalar(authoritative, ['policy_version', 'policyVersion'])
  for (const [label, field] of [
    ['effective date', effectiveFrom],
    ['configuration version', configurationVersion],
    ['policy version', policyVersion]
  ]) {
    if (field.malformed) return unreadable([`${label} is malformed evidence`])
  }
  // Active must be an explicit boolean. Anything else is unreadable unless
  // a separately documented, equally authoritative contract establishes
  // activation — none exists here, so status alone never confirms.
  if (typeof authoritative.active !== 'boolean') {
    return unreadable(['activation flag is unavailable evidence'])
  }
  const isActive = authoritative.active === true
  const statusText = typeof authoritative.status === 'string' ? authoritative.status.trim().toLowerCase() : ''
  // Future-effective SQL state: the row reads status:active while active is
  // explicitly false. That is scheduled/not-yet-active, never proof of a
  // current activation and never an error proving no commit happened.
  const scheduled = !isActive && statusText === 'active'
  const mismatches = []
  if (String(lodge.value).toLowerCase() !== String(wanted.lodgeId).toLowerCase()) mismatches.push('lodge')
  if ((effectiveFrom.value || null) !== (wanted.effectiveFrom || null)) mismatches.push('effective date')
  if ((configurationVersion.value || null) !== (wanted.configurationVersion || null)) mismatches.push('configuration version')
  if ((policyVersion.value || null) !== (wanted.policyVersion || null)) mismatches.push('policy version')
  if ((cutover.value || null) !== (wanted.cutoverBatchId || null)) mismatches.push('cutover batch')
  if (!isActive) {
    if (scheduled) mismatches.unshift('scheduled (active from a future effective date, not yet active)')
    return { verdict: 'inactive', mismatches, readable: true, scheduled }
  }
  if (mismatches.length > 0) {
    return { verdict: 'active-different', mismatches, readable: true, scheduled: false }
  }
  return { verdict: 'exact-match', mismatches: [], readable: true, scheduled: false }
}

/**
 * Immutable reviewed-evidence snapshot (F1, hardened G3). Captured from the
 * DISPLAYED authoritative batch detail at the moment of an explicit reviewer
 * confirmation, and ONLY when the record belongs to the current tenant and
 * selected batch (scope). Returns a frozen snapshot, or null when the
 * displayed evidence is incomplete.
 *
 * Required nonempty fields mirror the SQL contract: tenant, batch, status,
 * preparer, and opening hash. The source hash is the one documented
 * nullable case — real batches carry no source manifest when no
 * pre-cutover history exists — recorded as reviewed-absent and bound
 * null-safely server-side, never treated as equality with a later value.
 * Notes alone never imply review of later data.
 */
export function snapshotReviewedEvidence(detail = null, scope = null) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const nonBlank = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
  const id = nonBlank(detail.id)
  const status = nonBlank(detail.status)
  const lodgeId = nonBlank(detail.lodge_id) || nonBlank(detail.lodgeId)
  const preparedBy = nonBlank(detail.prepared_by) || nonBlank(detail.preparedBy)
  const openingPayloadHash = nonBlank(detail.opening_payload_hash) || nonBlank(detail.openingPayloadHash)
  if (!id || !status || !lodgeId || !preparedBy || !openingPayloadHash) return null
  // Scope is mandatory: review is only ever recorded against the current
  // tenant and selected batch. A missing scope refuses, never assumes.
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null
  const scopeLodge = scope.lodgeId === undefined || scope.lodgeId === null ? '' : String(scope.lodgeId).trim()
  const scopeBatch = scope.batchId === undefined || scope.batchId === null ? '' : String(scope.batchId).trim()
  if (!scopeLodge || !scopeBatch || scopeLodge !== lodgeId || scopeBatch !== id) return null
  // Source identity uses the shared strict reader: an absent property is
  // unavailable evidence (NOT an implicit reviewed null); only an explicit
  // null records reviewed-absent for later null-safe server binding.
  const source = readSourceEvidence(detail)
  if (!source.present || source.malformed || source.conflict) return null
  return Object.freeze({
    lodgeId,
    batchId: id,
    status,
    preparedBy,
    openingPayloadHash,
    sourceManifestHash: source.value
  })
}

/**
 * Preflight review binding (F1, hardened G3). Compares a confirmed snapshot
 * against a freshly fetched batch BEFORE any approval mutation. The fresh
 * record is normalized strictly: a missing status, preparer, or tenant is
 * unavailable evidence — never proof that nothing changed — and yields
 * explicit reasons. The caller must clear the confirmation, show the
 * refreshed evidence, and require a new explicit review.
 */
export function reviewMatchesFresh(snapshot = null, fresh = null) {
  const mismatch = (reasons) => ({ ok: false, reasons })
  if (!snapshot || typeof snapshot !== 'object') {
    return mismatch(['No reviewed evidence is recorded. Confirm review of the displayed batch first.'])
  }
  if (!fresh || typeof fresh !== 'object' || Array.isArray(fresh) || !fresh.id) {
    return mismatch(['The cutover batch could not be reloaded. Review the refreshed batch before approving.'])
  }
  const reasons = []
  const text = (value) => (typeof value === 'string' ? value.trim() : null)
  if (String(fresh.id) !== String(snapshot.batchId)) reasons.push('batch identity changed since review')
  const freshLodge = text(fresh.lodge_id) || text(fresh.lodgeId)
  if (!freshLodge) {
    reasons.push('batch tenant evidence is unavailable')
  } else if (freshLodge !== snapshot.lodgeId) {
    reasons.push('batch tenant changed since review')
  }
  const freshStatus = text(fresh.status)
  if (!freshStatus) {
    reasons.push('batch status evidence is unavailable')
  } else if (freshStatus !== snapshot.status) {
    reasons.push(`batch status changed since review (now ${freshStatus})`)
  }
  const freshPreparer = text(fresh.prepared_by) || text(fresh.preparedBy)
  if (!freshPreparer) {
    reasons.push('batch preparer evidence is unavailable')
  } else if (freshPreparer !== snapshot.preparedBy) {
    reasons.push('batch preparer changed since review')
  }
  const freshHash = text(fresh.opening_payload_hash) || text(fresh.openingPayloadHash)
  if (!freshHash) {
    reasons.push('reviewed opening evidence is no longer available')
  } else if (freshHash !== snapshot.openingPayloadHash) {
    reasons.push('opening-balance hash changed since review; the new evidence needs its own review')
  }
  const rawSource = readSourceEvidence(fresh)
  if (!rawSource.present) {
    reasons.push('source-manifest evidence is unavailable')
  } else if (rawSource.malformed) {
    reasons.push('source-manifest evidence is malformed')
  } else if (rawSource.conflict) {
    reasons.push('source-manifest evidence aliases disagree')
  } else if (rawSource.value !== (snapshot.sourceManifestHash || null)) {
    reasons.push('source-manifest evidence changed since review; the new evidence needs its own review')
  }
  if (reasons.length > 0) return mismatch(reasons)
  return { ok: true, reasons: [] }
}

/**
 * Apply-outcome reconciliation (F4). Nominal and timeout paths share one
 * rule: ONLY complete authoritative detail identifying the SAME batch as
 * applied confirms. Malformed RPC envelopes, null/failed/wrong-batch
 * detail, and non-applied statuses stay unconfirmed with the batch ID
 * retained for same-batch retry. Direct RPC evidence is never accepted
 * during a readback failure.
 */
export function resolveApplyOutcome({ batchId = '', rpcResult = null, detail = null } = {}) {
  const id = String(batchId || '').trim()
  const unconfirmed = (reason) => ({ confirmed: false, batchId: id, postings: [], evidence: null, reason })
  const applied = detail && typeof detail === 'object' && !Array.isArray(detail) && detail.status === 'applied'
    && String(detail.id || '') === id && id !== ''
  if (!applied) {
    if (!rpcResult || typeof rpcResult !== 'object' || Array.isArray(rpcResult) || rpcResult.success !== true) {
      return unconfirmed('apply response was not a confirmed success')
    }
    return unconfirmed('applied state could not be verified from authoritative batch detail')
  }
  const postings = Array.isArray(detail.opening_postings) ? detail.opening_postings : []
  const rpcOk = rpcResult && typeof rpcResult === 'object' && !Array.isArray(rpcResult) && rpcResult.success === true
  return {
    confirmed: true,
    batchId: id,
    postings,
    evidence: rpcOk ? 'response' : 'readback',
    reason: rpcOk ? null : 'uncertain response resolved by reading back the same batch'
  }
}

/**
 * Approval-outcome reconciliation (G4). A success notice requires
 * authoritative detail proving the SAME tenant's SAME batch is approved FOR
 * the reviewed evidence: matching batch and tenant identity, approved
 * status, a recorded approver, and opening/source evidence equal to the
 * confirmed snapshot (null-safe). The RPC envelope alone never proves a
 * commit — not even a well-shaped nominal success. Null/failed/malformed/
 * wrong-batch/non-approved evidence stays unconfirmed with the original
 * batch retained for refresh or same-batch retry; the caller must never
 * mint a new batch or automatically reapprove.
 */
export function resolveApproveOutcome({ batchId = '', lodgeId = '', reviewed = null, rpcResult = null, detail = null } = {}) {
  const id = String(batchId || '').trim()
  const lodge = String(lodgeId || '').trim()
  const unconfirmed = (reason) => ({ confirmed: false, batchId: id, evidence: null, reason })
  const snapshot = reviewed && typeof reviewed === 'object' && !Array.isArray(reviewed) ? reviewed : null
  if (!snapshot || !id) return unconfirmed('no reviewed evidence is recorded for this batch')
  // The snapshot itself must belong to the requested batch and tenant:
  // scope drift between confirmation and reconciliation never confirms.
  if (snapshot.batchId !== id || snapshot.lodgeId !== lodge || lodge === '') {
    return unconfirmed('reviewed evidence belongs to another batch or tenant')
  }
  const same = detail && typeof detail === 'object' && !Array.isArray(detail)
    && String(detail.id || '') === id
    && String(detail.lodge_id || detail.lodgeId || '') === lodge && lodge !== ''
    && detail.status === 'approved'
  const approver = same
    ? (typeof detail.approved_by === 'string' ? detail.approved_by.trim()
      : (typeof detail.approvedBy === 'string' ? detail.approvedBy.trim() : ''))
    : ''
  const detailPreparer = same
    ? (typeof detail.prepared_by === 'string' ? detail.prepared_by.trim()
      : (typeof detail.preparedBy === 'string' ? detail.preparedBy.trim() : ''))
    : ''
  // Independent approval: an approver must be recorded and must differ
  // from the preparer. The current operator is deliberately NOT required
  // to be the approver — another authorized reviewer may have approved the
  // same revision — but then only the revision's approval is stated, never
  // that this request caused it.
  const independent = same && approver !== '' && detailPreparer !== '' && approver !== detailPreparer
  if (!independent) {
    if (!rpcResult || typeof rpcResult !== 'object' || Array.isArray(rpcResult) || rpcResult.success !== true) {
      return unconfirmed('approval response was not a confirmed success')
    }
    return unconfirmed('approved state could not be verified from authoritative batch detail')
  }
  // Complete preparation identity: the readback preparer must equal the
  // reviewed preparer. A later revision approved by someone else is proof
  // of THAT revision, never of this review.
  if (!snapshot.preparedBy || detailPreparer !== snapshot.preparedBy) {
    return unconfirmed('authoritative evidence does not match the reviewed preparation identity')
  }
  const detailHash = typeof detail.opening_payload_hash === 'string' ? detail.opening_payload_hash.trim()
    : (typeof detail.openingPayloadHash === 'string' ? detail.openingPayloadHash.trim() : '')
  // Strict source presence: the readback must carry the canonical property.
  // Explicit null is allowed by the documented contract; missing, blank,
  // wrong-type, or conflicting values are unavailable/malformed evidence.
  const detailSource = readSourceEvidence(detail)
  if (!detailHash || detailHash !== snapshot.openingPayloadHash) {
    return unconfirmed('authoritative evidence does not match the reviewed opening hash')
  }
  if (!detailSource.present || detailSource.malformed || detailSource.conflict) {
    return unconfirmed('authoritative source evidence is unavailable or malformed')
  }
  if (detailSource.value !== (snapshot.sourceManifestHash || null)) {
    return unconfirmed('authoritative evidence does not match the reviewed source identity')
  }
  const rpcOk = rpcResult && typeof rpcResult === 'object' && !Array.isArray(rpcResult) && rpcResult.success === true
  return {
    confirmed: true,
    batchId: id,
    evidence: rpcOk ? 'response' : 'readback',
    reason: rpcOk ? null : 'uncertain response resolved by reading back the same batch'
  }
}

/**
 * Pure disposable-target safety configuration validator (G2). Takes
 * injected values so the matrix (missing/wrong/valid) is unit-testable
 * without opening any database connection. Returns null when approved,
 * otherwise the exact refusal message. The integration entry point calls
 * this against the real environment and fails closed.
 */
export function validateSafetyConfig({ flag = '', url = '', ack = '' } = {}) {
  if (flag !== '1') {
    return 'Refusing to run cutover SQL acceptance without the disposable-database opt-in: set RESTAURANT_ACCOUNTING_DISPOSABLE_DB=1 (PowerShell: $env:RESTAURANT_ACCOUNTING_DISPOSABLE_DB="1"). See docs/ACCOUNTING_SQL_ACCEPTANCE.md.'
  }
  let host = null
  try {
    host = new URL(String(url)).host || null
  } catch {
    host = null
  }
  if (!url || !host) {
    return 'Refusing to run cutover SQL acceptance without an explicit disposable target: set RESTAURANT_ACCOUNTING_TEST_DB_URL to the approved disposable database URL. Localhost is never assumed disposable.'
  }
  if (ack !== `destroy-data-on:${host}`) {
    return `Refusing to run cutover SQL acceptance without explicit acknowledgement for target host ${host}: set RESTAURANT_ACCOUNTING_DISPOSABLE_ACK=destroy-data-on:${host}. Never point this suite at production.`
  }
  return null
}
