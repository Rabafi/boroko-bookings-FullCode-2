import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router'
import { useAccess, useAuth, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import {
  compareActivationState,
  resolveApplyOutcome,
  resolveApproveOutcome,
  reviewMatchesFresh,
  snapshotActivationRequest,
  snapshotReviewedEvidence
} from '../../../../shared/accountingActivation'
import {
  AccountingButton, AccountingLoading, AccountingNotice, AccountingPanel, EmptyState,
  accountingInvoke, inputClass, labelClass, runIdempotent, today, unwrap
} from './RestaurantAccountingUi'

// Activation input contracts mirror the server RPCs exactly:
// prepare_restaurant_historical_cutover(p_cutover_date, p_opening_balances,
//   p_evidence_manifest, p_operation_key),
// approve_restaurant_historical_cutover(p_batch_id, p_review_notes,
//   p_expected_opening_payload_hash),
// apply_restaurant_historical_cutover(p_batch_id),
// activate_restaurant_accounting(p_effective_from, p_configuration_version,
//   p_policy_version, p_cutover_batch_id),
// suspend_restaurant_accounting(p_reason),
// get_restaurant_historical_cutover_batches(p_limit),
// get_restaurant_historical_cutover_batch(p_batch_id),
// get_restaurant_accounting_activation_state().
const POLICY_VERSION = 'bar-accounting-financial-truth-v1'

const emptyBalanceRow = (entryDate) => ({ accountId: '', equityAccountId: '', entryDate, amount: '' })

export function validateOpeningBalances(rows = []) {
  const errors = []
  const seen = new Set()
  rows.forEach((row, index) => {
    const label = `Row ${index + 1}`
    if (!row.accountId) errors.push(`${label}: choose the balance-sheet account.`)
    if (!row.equityAccountId) errors.push(`${label}: choose the offsetting equity account.`)
    if (!row.entryDate) errors.push(`${label}: set the entry date.`)
    if (!(Number(row.amount) > 0)) errors.push(`${label}: enter a non-zero amount.`)
    if (row.accountId) {
      if (seen.has(row.accountId)) errors.push(`${label}: only one posting per account is allowed in a cutover batch.`)
      seen.add(row.accountId)
    }
  })
  return errors
}

export default function RestaurantAccountingActivation() {
  const access = useAccess()
  const { user } = useAuth()
  const { settings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const barOnly = isBarOnlyMode(settings)
  const lodgeId = settings?.lodge_id || user?.lodge_id || null
  const userId = user?.id || null
  const canManage = canAccessCapability(access, 'accounting.manage')
  const [readiness, setReadiness] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [cutoverDate, setCutoverDate] = useState(() => today())
  const [balanceRows, setBalanceRows] = useState([emptyBalanceRow(today())])
  const [batches, setBatches] = useState([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState(() => searchParams.get('batch') || '')
  const [batchDetail, setBatchDetail] = useState(null)
  const [batchLoading, setBatchLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  // Immutable reviewed-evidence snapshot (F1): captured only by the
  // reviewer's explicit confirmation from DISPLAYED detail. Notes alone
  // never imply review; approval revalidates this snapshot against a fresh
  // read and never auto-submits a changed hash.
  const [reviewSnapshot, setReviewSnapshot] = useState(null)
  const [effectiveFrom, setEffectiveFrom] = useState(() => today())
  const [configurationVersion, setConfigurationVersion] = useState('')
  const [cutoverBatchId, setCutoverBatchId] = useState('')
  const [approved, setApproved] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Batch identity lives in the URL query under MemoryRouter and in the
  // hash fragment under the production HashRouter (App.jsx). Both are read
  // as selection only; the server response alone authorizes the record.
  const readUrlBatchId = () => {
    try {
      const fromSearch = new URLSearchParams(window.location.search).get('batch') || ''
      if (fromSearch) return fromSearch
      const hash = String(window.location.hash || '')
      const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
      return new URLSearchParams(query).get('batch') || ''
    } catch {
      return ''
    }
  }
  // Stale-response guard: only the latest selection's read may write state.
  const batchRequestRef = useRef(0)
  // Session sequence (F3): every loader captures the session that started
  // it; a tenant/operator change invalidates in-flight list, readiness,
  // account, and detail reads so a previous tenant's response can never
  // repopulate the screen. Unmount invalidates everything outstanding.
  const sessionSeqRef = useRef(0)
  const sessionKey = `${lodgeId || ''}|${userId || ''}`
  // URL-load marker (F3): `${sessionKey}|${batchId}` already resolved, so
  // search-param writes from user selection do not reload, while direct
  // URLs, reloads, and back/forward navigation always trigger a load.
  const lastUrlLoadRef = useRef('')
  const selectionFromUrlRef = useRef(false)
  // Synchronous per-batch single flight: React state updates are async, so
  // two rapid clicks could both pass a state guard. The ref closes that
  // race; the server replay covers the rest.
  const applyFlightRef = useRef(null)

  const loadReadiness = useCallback(async () => {
    const seq = sessionSeqRef.current
    try {
      const result = await accountingInvoke('getReadiness')
      if (sessionSeqRef.current !== seq) return
      setReadiness(unwrap(result, null))
    } catch (loadError) {
      if (sessionSeqRef.current !== seq) return
      setReadiness({ error: loadError?.message || 'Readiness could not be loaded.' })
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    const seq = sessionSeqRef.current
    try {
      const result = await accountingInvoke('getAccounts')
      if (sessionSeqRef.current !== seq) return
      const rows = unwrap(result, [])
      setAccounts(Array.isArray(rows) ? rows : [])
    } catch {
      if (sessionSeqRef.current !== seq) return
      setAccounts([])
    }
  }, [])

  const loadBatches = useCallback(async () => {
    const seq = sessionSeqRef.current
    setBatchesLoading(true)
    try {
      const result = await accountingInvoke('getCutoverBatches', 50)
      if (sessionSeqRef.current !== seq) return
      const rows = unwrap(result, [])
      setBatches(Array.isArray(rows) ? rows : [])
    } catch {
      if (sessionSeqRef.current !== seq) return
      setBatches([])
    } finally {
      if (sessionSeqRef.current === seq) setBatchesLoading(false)
    }
  }, [])

  const loadBatchDetail = useCallback(async (batchId, { silent = false } = {}) => {
    const requestId = batchRequestRef.current + 1
    batchRequestRef.current = requestId
    const seq = sessionSeqRef.current
    const id = String(batchId || '').trim()
    if (!id) {
      setBatchDetail(null)
      return null
    }
    if (!silent) setBatchLoading(true)
    try {
      const result = await accountingInvoke('getCutoverBatch', id)
      const detail = unwrap(result, null)
      // Ignore late responses for a previous selection, tenant, or user.
      if (batchRequestRef.current !== requestId || sessionSeqRef.current !== seq) return null
      setBatchDetail(detail && detail.id ? detail : null)
      return detail && detail.id ? detail : null
    } catch {
      if (batchRequestRef.current !== requestId || sessionSeqRef.current !== seq) return null
      setBatchDetail(null)
      return null
    } finally {
      if (batchRequestRef.current === requestId && sessionSeqRef.current === seq && !silent) setBatchLoading(false)
    }
  }, [])

  // Coherent tenant/user/URL-scoped load lifecycle (F3). One session
  // effect runs on mount and on every tenant/operator change: it
  // invalidates all in-flight reads, clears previous-tenant state, reloads
  // the lists, and resolves the URL batch under the CURRENT scope. A
  // separate URL effect handles navigation (including back/forward) and
  // user selection writes without looping: the marker records which
  // session+batch pair already resolved. URL identity only selects a
  // record; the server response alone authorizes what is shown. Financial
  // truth never depends on localStorage.
  useEffect(() => {
    sessionSeqRef.current += 1
    batchRequestRef.current += 1
    lastUrlLoadRef.current = ''
    selectionFromUrlRef.current = false
    setSelectedBatchId('')
    setBatchDetail(null)
    setReviewNotes('')
    setReviewSnapshot(null)
    setApproved(false)
    setCutoverBatchId('')
    setError('')
    setNotice('')
    setBatches([])
    setReadiness(null)
    loadReadiness()
    loadAccounts()
    loadBatches()
    const urlBatch = readUrlBatchId()
    if (urlBatch) {
      lastUrlLoadRef.current = `${sessionKey}|${urlBatch}`
      selectionFromUrlRef.current = true
      setSelectedBatchId(urlBatch)
      loadBatchDetail(urlBatch)
    }
    return () => {
      sessionSeqRef.current += 1
      batchRequestRef.current += 1
    }
    // Intentionally scoped to the session key: loaders are session-guarded
    // refs, and search params are handled by the navigation effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const urlBatch = searchParams.get('batch') || ''
    if (urlBatch) {
      const marker = `${sessionKey}|${urlBatch}`
      if (lastUrlLoadRef.current !== marker) {
        lastUrlLoadRef.current = marker
        selectionFromUrlRef.current = true
        setSelectedBatchId(urlBatch)
        setReviewNotes('')
        setReviewSnapshot(null)
        loadBatchDetail(urlBatch)
      }
    } else if (selectionFromUrlRef.current) {
      // Back/forward navigation away from a URL-selected batch clears it.
      selectionFromUrlRef.current = false
      batchRequestRef.current += 1
      setSelectedBatchId('')
      setBatchDetail(null)
      setReviewNotes('')
      setReviewSnapshot(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sessionKey])

  // A newly displayed batch invalidates any earlier review confirmation.
  useEffect(() => {
    setReviewSnapshot(null)
  }, [batchDetail?.id])

  const selectBatch = (batchId) => {
    const id = String(batchId || '').trim()
    selectionFromUrlRef.current = false
    lastUrlLoadRef.current = id ? `${sessionKey}|${id}` : lastUrlLoadRef.current
    setSelectedBatchId(id)
    setReviewNotes('')
    setReviewSnapshot(null)
    if (id) {
      setSearchParams((params) => {
        const next = new URLSearchParams(params)
        next.set('batch', id)
        return next
      }, { replace: true })
      loadBatchDetail(id)
    } else {
      setSearchParams((params) => {
        const next = new URLSearchParams(params)
        next.delete('batch')
        return next
      }, { replace: true })
      batchRequestRef.current += 1
      setBatchDetail(null)
    }
  }

  const readinessData = readiness && !readiness.error ? readiness : null
  const missing = readinessData?.missing_requirements || []
  const isActive = readinessData?.active === true
  const isReady = readinessData?.ready === true
  const blockers = [
    ...missing,
    ...((readinessData?.unposted_expenses || 0) > 0 ? [`${readinessData.unposted_expenses} unposted expenses`] : []),
    ...((readinessData?.blocking_exceptions || 0) > 0 ? [`${readinessData.blocking_exceptions} blocking reconciliation exceptions`] : [])
  ]
  const actionDisabled = (key) => busy !== '' && busy !== key
  const selfPrepared = Boolean(batchDetail?.prepared_by && userId && String(batchDetail.prepared_by) === String(userId))

  const fail = (message) => {
    setError(message)
    setNotice('')
  }

  async function prepareCutover(event) {
    event.preventDefault()
    if (!canManage) return fail('Preparing a cutover requires Restaurant Accounting management access.')
    const balanceErrors = validateOpeningBalances(balanceRows)
    if (!cutoverDate) balanceErrors.unshift('Choose the cutover date.')
    if (balanceErrors.length) return fail(balanceErrors.join(' '))
    setBusy('prepare'); setError(''); setNotice('')
    try {
      const payload = {
        cutoverDate,
        openingBalances: balanceRows.map((row) => ({
          account_id: row.accountId,
          equity_account_id: row.equityAccountId,
          entry_date: row.entryDate,
          amount: Number(row.amount)
        })),
        evidenceManifest: {}
      }
      const result = await runIdempotent(`cutover-prepare:${cutoverDate}`, (operationKey) =>
        accountingInvoke('prepareCutover', { ...payload, operationKey }))
      const prepared = unwrap(result, null)
      if (result?.success === false) throw new Error(result?.error || 'Cutover preparation failed.')
      if (!prepared?.id) throw new Error('Cutover preparation returned no batch identity. Reload the batch list before continuing.')
      selectBatch(prepared.id)
      setCutoverBatchId(prepared.id)
      setNotice(`Cutover batch prepared (${prepared.id}). A different authorised reviewer must approve it before activation.`)
      await loadReadiness()
      await loadBatches()
    } catch (prepareError) {
      fail(prepareError?.message || 'Cutover preparation failed.')
    } finally {
      setBusy('')
    }
  }

  function confirmReview() {
    if (!canManage) return fail('Confirming a review requires Restaurant Accounting management access.')
    // Scope binds the confirmation to the current tenant and selected
    // batch: a record from any other scope cannot form review evidence.
    const snapshot = snapshotReviewedEvidence(batchDetail, { lodgeId, batchId: selectedBatchId || batchDetail?.id })
    if (!snapshot) {
      setReviewSnapshot(null)
      return fail('The displayed batch evidence is incomplete or belongs to another tenant/selection (tenant, batch, status, preparer, and opening hash are all required). Reload the batch and confirm review only against complete evidence.')
    }
    setReviewSnapshot(snapshot)
    setError('')
    setNotice(`Review recorded for batch ${snapshot.batchId} (opening hash ${snapshot.openingPayloadHash.slice(0, 12)}…${snapshot.sourceManifestHash ? `, source ${snapshot.sourceManifestHash.slice(0, 12)}…` : ', no source manifest recorded'}). Approval will re-check this exact evidence before submitting anything.`)
  }

  async function approveCutover(event) {
    event.preventDefault()
    if (!canManage) return fail('Approving a cutover requires Restaurant Accounting management access.')
    const batchId = (batchDetail?.id || selectedBatchId || '').trim()
    if (!batchId) return fail('Load a prepared cutover batch first, then approve it.')
    if (reviewNotes.trim().length < 8) return fail('Independent review notes of at least 8 characters are required.')
    // Notes alone never imply review: an explicit confirmation snapshot for
    // THIS batch is required before any approval mutation.
    if (!reviewSnapshot || reviewSnapshot.batchId !== batchId) {
      return fail('Confirm review of the currently displayed batch evidence first. Review notes alone do not authorize approval.')
    }
    // The confirmed review must belong to this tenant and selection;
    // anything else is discarded instead of submitted.
    if (reviewSnapshot.lodgeId !== lodgeId) {
      setReviewSnapshot(null)
      return fail('The confirmed review belongs to another tenant. Reload the batch under the current tenant and confirm review again. Nothing was submitted.')
    }
    setBusy('approve'); setError(''); setNotice('')
    try {
      // Re-read authoritative state immediately before approving and bind
      // it to the confirmed snapshot. On missing or changed evidence the
      // confirmation is cleared, the refreshed evidence is shown, and a new
      // explicit review is required. The new hash is NEVER auto-submitted.
      const fresh = await loadBatchDetail(batchId, { silent: true })
      const binding = reviewMatchesFresh(reviewSnapshot, fresh)
      if (!binding.ok) {
        setReviewSnapshot(null)
        await loadBatches()
        return fail(`${binding.reasons.join(' ')} The batch was reloaded: confirm review of the new evidence before approving again. Nothing was submitted.`)
      }
      // The full reviewed revision travels to the server, which validates
      // opening hash, source identity, and preparation identity atomically
      // under the batch lock. A source-only re-preparation can no longer
      // slip through on a matching opening hash.
      let result = null
      try {
        result = await accountingInvoke('approveCutover', {
          batchId,
          reviewNotes: reviewNotes.trim(),
          expectedOpeningPayloadHash: reviewSnapshot.openingPayloadHash,
          expectedSourceManifestHash: reviewSnapshot.sourceManifestHash,
          expectedPreparedBy: reviewSnapshot.preparedBy
        })
      } catch (invokeError) {
        result = { success: false, error: invokeError?.message || 'Cutover approval failed.' }
      }
      // G4: the RPC envelope alone never proves a commit. Reconcile
      // authoritative same-tenant/same-batch approved state against the
      // reviewed revision before announcing anything.
      const reloaded = await loadBatchDetail(batchId, { silent: true }).catch(() => null)
      await loadBatches()
      const outcome = resolveApproveOutcome({
        batchId, lodgeId, reviewed: reviewSnapshot, rpcResult: result, detail: reloaded
      })
      setReviewNotes('')
      setReviewSnapshot(null)
      if (!outcome.confirmed) {
        fail(`${result?.error || 'Cutover approval failed.'} Outcome not confirmed: the batch ID is retained — reload it, confirm review of the current evidence, and retry the same batch. Never create a second batch to recover an uncertain outcome, and never reapprove automatically.`)
        return
      }
      if (outcome.evidence === 'readback') {
        setNotice(`Cutover batch approved for the reviewed evidence (opening hash ${reviewSnapshot.openingPayloadHash.slice(0, 12)}…). The uncertain response was resolved by reading back the same batch; the preparer and approver are recorded separately by the server.`)
      } else {
        setNotice(`Cutover batch approved for the reviewed evidence (opening hash ${reviewSnapshot.openingPayloadHash.slice(0, 12)}…). The preparer and approver are recorded separately by the server.`)
      }
      void reloaded
    } catch (approveError) {
      const message = String(approveError?.message || 'Cutover approval failed.')
      if (/hash|drift|changed after preparation|prepared|reviewed opening-balance evidence/i.test(message)) {
        setReviewSnapshot(null)
        await loadBatchDetail(batchId, { silent: true }).catch(() => {})
        fail(`${message} The batch was reloaded: confirm review of the new evidence before approving again.`)
      } else {
        fail(message)
      }
    } finally {
      setBusy('')
    }
  }

  async function applyCutover() {
    const batchId = (batchDetail?.id || '').trim()
    if (!canManage) return fail('Applying a cutover requires Restaurant Accounting management access.')
    if (!batchId) return fail('Load an approved cutover batch first, then apply it.')
    // Per-batch single flight: the busy key names the batch, so a double
    // click cannot dispatch twice; the server replay covers the rest.
    const flightKey = `apply:${batchId}`
    if (busy !== '' || applyFlightRef.current === batchId) return
    applyFlightRef.current = batchId
    setBusy(flightKey); setError(''); setNotice('')
    try {
      const fresh = await loadBatchDetail(batchId, { silent: true })
      if (!fresh) throw new Error('The cutover batch could not be reloaded. Reload it before applying.')
      if (fresh.status === 'applied') {
        setNotice('This batch is already applied. Its stored posting references are shown below; nothing was reposted.')
        return
      }
      if (fresh.status !== 'approved') throw new Error(`Only an independently approved batch can be applied; this batch is ${fresh.status}.`)
      // Nominal and timeout paths share one reconciliation rule (F4): only
      // complete authoritative detail identifying this same batch as
      // applied confirms. The RPC envelope alone never does.
      let rpcResult = null
      try {
        rpcResult = await accountingInvoke('applyCutover', batchId)
      } catch (invokeError) {
        rpcResult = { success: false, error: invokeError?.message || 'Cutover application failed.' }
      }
      const reread = await loadBatchDetail(batchId, { silent: true }).catch(() => null)
      await loadBatches()
      const outcome = resolveApplyOutcome({ batchId, rpcResult, detail: reread })
      if (!outcome.confirmed) {
        fail(`${rpcResult?.error || 'Cutover application failed.'} Outcome not confirmed: the batch ID is retained — reload it and retry the same batch. Never create a second batch to recover a timeout, and activation stays blocked until applied state is verified.`)
        return
      }
      const count = outcome.postings.length
      if (outcome.evidence === 'readback') {
        setNotice(`Opening balances applied${count ? ` (${count} posting references recorded)` : ''}. The uncertain response was resolved by reading back the same batch; nothing was reposted.`)
      } else if (rpcResult?.data?.replayed) {
        setNotice(`Opening balances already applied${count ? ` (${count} stored posting references)` : ''}. The server replayed the existing application; nothing was reposted.`)
      } else {
        setNotice(`Opening balances applied${count ? ` (${count} posting references recorded)` : ''}. The batch is immutable from here.`)
      }
    } catch (applyError) {
      // A timeout is unconfirmed, never a failure proof: reload the SAME
      // batch. Applied state (with stored references) confirms; anything
      // else retains the ID and offers the same-batch retry.
      let reread = null
      try {
        reread = await loadBatchDetail(batchId, { silent: true })
      } catch { /* fall through to the original error */ }
      const outcome = resolveApplyOutcome({ batchId, rpcResult: null, detail: reread })
      if (outcome.confirmed) {
        setNotice(`Opening balances applied${outcome.postings.length ? ` (${outcome.postings.length} posting references recorded)` : ''}. The batch is applied with stored posting references. The uncertain response was resolved by reading back the same batch; nothing was reposted.`)
      } else {
        fail(`${applyError?.message || 'Cutover application failed.'} Outcome not confirmed: the batch ID is retained — reload it and retry the same batch. Never create a second batch to recover a timeout.`)
      }
    } finally {
      if (applyFlightRef.current === batchId) applyFlightRef.current = null
      setBusy('')
    }
  }

  async function activate(event) {
    event.preventDefault()
    if (!canManage) return fail('Activating Accounting requires Restaurant Accounting management access.')
    if (!effectiveFrom) return fail('Choose the activation effective date.')
    if (!configurationVersion.trim()) return fail('Enter the chart configuration version being activated.')
    if (!approved) return fail('Confirm the explicit activation approval before invoking activation.')
    // Immutable request snapshot: form edits during the request cannot
    // alter what gets reconciled afterwards.
    const requested = snapshotActivationRequest({
      lodgeId,
      effectiveFrom,
      configurationVersion: configurationVersion.trim(),
      policyVersion: POLICY_VERSION,
      cutoverBatchId: cutoverBatchId.trim() || null
    })
    // When a cutover batch is supplied, require its authoritative APPLIED
    // state first. Approval alone is not enough: activation SQL needs
    // applied (or approves-then-applies server-side only for approved
    // batches — we make the state explicit instead).
    if (requested.cutoverBatchId) {
      const authoritative = await loadBatchDetail(requested.cutoverBatchId, { silent: true }).catch(() => null)
      if (!authoritative) return fail('The supplied cutover batch could not be reloaded. Verify its ID before activating.')
      if (authoritative.status !== 'applied') {
        return fail(`Cutover batch ${requested.cutoverBatchId} is ${authoritative.status}, not applied. Apply its opening balances first, then activate.`)
      }
    }
    setBusy('activate'); setError(''); setNotice('')
    try {
      const result = await accountingInvoke('activateAccounting', {
        effectiveFrom: requested.effectiveFrom,
        configurationVersion: requested.configurationVersion,
        policyVersion: requested.policyVersion,
        cutoverBatchId: requested.cutoverBatchId
      })
      if (result?.success !== true) throw new Error(result?.error || 'Activation failed.')
      await confirmActivationState(requested, null)
    } catch (activateError) {
      await confirmActivationState(requested, activateError)
    } finally {
      setBusy('')
    }
  }

  async function confirmActivationState(requested, activateError) {
    // Uncertain responses AND nominal successes both reconcile against the
    // full authoritative tuple. An older active configuration never
    // confirms the requested change.
    let authoritative = null
    let readError = null
    try {
      authoritative = unwrap(await accountingInvoke('getActivationState'), null)
    } catch (error) {
      readError = error
    }
    const comparison = compareActivationState(requested, authoritative)
    if (comparison.verdict === 'exact-match') {
      setApproved(false)
      setNotice(
        `Activation state now shows lodge ${requested.lodgeId} active from ${requested.effectiveFrom} under configuration ${requested.configurationVersion} and policy ${requested.policyVersion}${requested.cutoverBatchId ? ` with cutover batch ${requested.cutoverBatchId}` : ''}. ` +
        (activateError ? 'The uncertain response was resolved by reading back authoritative state.' : 'Authoritative state confirms the requested activation.')
      )
      await loadReadiness().catch(() => {})
      try {
        if (lodgeId && window.api?.trial?.getStatus) await window.api.trial.getStatus(lodgeId, { forceFresh: true }).catch(() => null)
      } catch { /* entitlement refresh is best-effort */ }
      return
    }
    if (comparison.verdict === 'active-different') {
      setApproved(false)
      fail(
        `Accounting is active under different arguments (${comparison.mismatches.join(', ')}). This does not confirm the requested activation. ` +
        'Do not retry blindly or overwrite the configuration: refresh state, review the difference, and renew approval for a deliberate new request.'
      )
      await loadReadiness().catch(() => {})
      return
    }
    if (comparison.verdict === 'inactive') {
      // A scheduled future-effective row is explicitly NOT proof that no
      // commit happened — only that activation is not current. The operator
      // must read back state again after the effective date instead of
      // retrying blindly or assuming failure.
      const scheduledNote = comparison.scheduled
        ? `Accounting reports active status with a future effective date (${(comparison.mismatches || []).join(', ')}). This is scheduled, not yet active: it does not confirm the requested activation and does not prove nothing was committed. `
        : ''
      if (activateError || !scheduledNote) {
        fail(`${scheduledNote}${activateError?.message || 'Activation could not be confirmed.'} Outcome not confirmed: use Refresh readiness to read back authoritative activation state before retrying.`)
      } else {
        fail(`${scheduledNote}Use Refresh readiness to read back authoritative activation state after the effective date before retrying.`)
      }
      if (readError || comparison.verdict === 'unreadable') {
        setError((previous) => `${previous} (Activation state is currently unreadable: ${(comparison.mismatches || []).join('; ') || readError?.message || 'no evidence'}.)`)
      }
      await loadReadiness().catch(() => {})
      return
    }
    if (activateError) {
      fail(`${activateError?.message || 'Activation failed.'} Outcome not confirmed: use Refresh readiness to read back authoritative activation state before retrying.`)
    } else {
      fail('Activation state could not be confirmed. Use Refresh readiness to read back authoritative activation state before retrying.')
    }
    if (readError || comparison.verdict === 'unreadable') {
      setError((previous) => `${previous} (Activation state is currently unreadable: ${(comparison.mismatches || []).join('; ') || readError?.message || 'no evidence'}.)`)
    }
    await loadReadiness().catch(() => {})
  }

  async function suspend(event) {
    event.preventDefault()
    if (!canManage) return fail('Suspending Accounting requires Restaurant Accounting management access.')
    if (suspendReason.trim().length < 8) return fail('A suspension reason of at least 8 characters is required.')
    setBusy('suspend'); setError(''); setNotice('')
    try {
      const result = await accountingInvoke('suspendAccounting', suspendReason.trim())
      if (result?.success === false) throw new Error(result?.error || 'Suspension failed.')
      setNotice('Accounting posting is suspended. Posted records are retained and stay readable through authorised history.')
      setSuspendReason('')
      await loadReadiness()
    } catch (suspendError) {
      fail(suspendError?.message || 'Suspension failed.')
    } finally {
      setBusy('')
    }
  }

  const accountOptions = useMemo(() => accounts.map((row) => ({
    id: row.id, label: `${row.code || ''} ${row.name || ''}`.trim(), type: row.account_type || ''
  })), [accounts])

  const detailPostings = Array.isArray(batchDetail?.opening_postings) ? batchDetail.opening_postings : []
  const detailBalances = Array.isArray(batchDetail?.opening_balances) ? batchDetail.opening_balances : []

  return (
    <div className="hpos-page-frame min-h-full bg-slate-50 p-4 md:p-6" data-testid="accounting-activation">
      <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">{barOnly ? 'Bar Accounting & Workforce' : 'Restaurant Accounting'} setup</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Accounting activation</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Work through readiness, a maker/checker cutover with explicit application, and explicit activation.
          Every step calls the authoritative server contract; uncertain responses are resolved by reading back
          state, never by posting twice.
        </p>
      </header>
      {error && <AccountingNotice type="error">{error}</AccountingNotice>}
      {notice && <AccountingNotice type="success">{notice}</AccountingNotice>}

      <AccountingPanel title="1 · Readiness" description="Server-computed prerequisites. Posting stays blocked until every item passes.">
        {!readiness ? <AccountingLoading label="Loading readiness…" /> : readiness.error ? (
          <AccountingNotice type="error">Readiness could not be verified: {readiness.error}</AccountingNotice>
        ) : (
          <div className="space-y-2 text-sm">
            <p><strong>Status:</strong> {readinessData.status || 'draft'} · <strong>Active:</strong> {isActive ? 'yes' : 'no'} · <strong>Ready:</strong> {isReady ? 'yes' : 'no'}</p>
            <p><strong>Policy:</strong> {readinessData.policy_version || POLICY_VERSION} · <strong>Configuration:</strong> {readinessData.configuration_version || 'unconfigured'}{readinessData.effective_from ? ` · Effective: ${readinessData.effective_from}` : ''}</p>
            {isReady ? <p>All readiness checks pass.</p> : (
              <div>
                <p>Blocking items — every one must clear before activation:</p>
                <ul className="list-disc pl-5">
                  {blockers.map((item) => <li key={item}>{item} — resolve in <NavLink className="underline" to="/restaurant/chart-of-accounts">Chart of accounts</NavLink> or POS mappings.</li>)}
                  {blockers.length === 0 && <li>Readiness state is incomplete or unverifiable; reload before relying on it.</li>}
                </ul>
              </div>
            )}
            <AccountingButton tone="secondary" busy={busy === 'readiness'} disabled={actionDisabled('readiness')} onClick={async () => { setBusy('readiness'); await loadReadiness(); setBusy('') }}>Refresh readiness</AccountingButton>
          </div>
        )}
      </AccountingPanel>

      <AccountingPanel title="2 · Historical cutover (only when POS sales predate activation)" description="Prepare, then have a different authorised reviewer approve, then explicitly apply. Approved batches are immutable.">
        {!canManage && <AccountingNotice type="warning">Preparing, approving, or applying a cutover requires Restaurant Accounting management access.</AccountingNotice>}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className={labelClass}>Prepared batches<select value={selectedBatchId} disabled={batchesLoading} onChange={(event) => selectBatch(event.target.value)} className={inputClass}><option value="">Select a prepared batch…</option>{batches.map((row) => <option key={row.id} value={row.id}>{row.cutover_date} · {row.status} · {String(row.id).slice(0, 8)}…</option>)}</select></label>
            <label className={labelClass}>Or batch ID<input value={selectedBatchId} onChange={(event) => selectBatch(event.target.value)} className={inputClass} placeholder="Paste a batch ID to load it" /></label>
            <AccountingButton tone="secondary" busy={batchLoading} disabled={actionDisabled('batch-load')} onClick={() => loadBatchDetail(selectedBatchId)}>Reload batch</AccountingButton>
          </div>
          {batchDetail ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="cutover-batch-detail">
              <p><strong>Batch:</strong> {batchDetail.id} · <strong>Status:</strong> {batchDetail.status} · <strong>Date:</strong> {batchDetail.cutover_date}</p>
              <p><strong>Prepared by:</strong> {batchDetail.prepared_by || '—'}{batchDetail.approved_by ? ` · Approved by: ${batchDetail.approved_by}` : ''}</p>
              {batchDetail.opening_payload_hash && <p><strong>Opening hash:</strong> {String(batchDetail.opening_payload_hash).slice(0, 16)}…</p>}
              {batchDetail.source_manifest_hash && <p><strong>Source manifest:</strong> {String(batchDetail.source_manifest_hash).slice(0, 16)}…</p>}
              <p><strong>Opening balances ({detailBalances.length}):</strong></p>
              <ul className="list-disc pl-5">{detailBalances.map((line, index) => <li key={index}>{line.account_id} ← {line.equity_account_id} · {line.entry_date} · {line.amount}</li>)}</ul>
              {detailPostings.length > 0 && (
                <div className="mt-2"><p><strong>Applied posting references ({detailPostings.length}):</strong></p>
                <ul className="list-disc pl-5">{detailPostings.map((posting, index) => <li key={index}>{posting.account_id} · key {posting.idempotency_key}</li>)}</ul></div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No batch loaded. Select a prepared batch above — a fresh reviewer session loads the same server state without preparing again.</p>
          )}
        </div>
        <form onSubmit={prepareCutover} className="space-y-3">
          <label className={labelClass}>Cutover date<input type="date" required value={cutoverDate} onChange={(event) => setCutoverDate(event.target.value)} className={inputClass} /></label>
          {balanceRows.map((row, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-4">
              <label className={labelClass}>Account<select required value={row.accountId} onChange={(event) => setBalanceRows((rows) => rows.map((current, i) => (i === index ? { ...current, accountId: event.target.value } : current)))} className={inputClass}><option value="">Select</option>{accountOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={labelClass}>Equity offset<select required value={row.equityAccountId} onChange={(event) => setBalanceRows((rows) => rows.map((current, i) => (i === index ? { ...current, equityAccountId: event.target.value } : current)))} className={inputClass}><option value="">Select</option>{accountOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={labelClass}>Entry date<input type="date" required value={row.entryDate} onChange={(event) => setBalanceRows((rows) => rows.map((current, i) => (i === index ? { ...current, entryDate: event.target.value } : current)))} className={inputClass} /></label>
              <label className={labelClass}>Amount<input type="number" min="0.01" step="0.01" required value={row.amount} onChange={(event) => setBalanceRows((rows) => rows.map((current, i) => (i === index ? { ...current, amount: event.target.value } : current)))} className={inputClass} /></label>
            </div>
          ))}
          <div className="flex gap-2">
            <AccountingButton tone="secondary" onClick={() => setBalanceRows((rows) => [...rows, emptyBalanceRow(cutoverDate)])}>Add balance row</AccountingButton>
            {balanceRows.length > 1 && <AccountingButton tone="secondary" onClick={() => setBalanceRows((rows) => rows.slice(0, -1))}>Remove last row</AccountingButton>}
          </div>
          <AccountingButton busy={busy === 'prepare'} disabled={!canManage || actionDisabled('prepare')} onClick={prepareCutover}>Prepare cutover batch</AccountingButton>
        </form>
        {batchDetail?.id && batchDetail.status === 'prepared' && (
          <form onSubmit={approveCutover} className="mt-4 space-y-3 border-t border-slate-200 pt-4">
            <p className="text-sm"><strong>Reviewing batch:</strong> {batchDetail.id}{batchDetail.opening_payload_hash ? ` · hash ${String(batchDetail.opening_payload_hash).slice(0, 12)}…` : ' · hash unavailable'}{batchDetail.source_manifest_hash ? ` · source ${String(batchDetail.source_manifest_hash).slice(0, 12)}…` : ''}</p>
            {user?.id && <p className="text-sm text-slate-600">You are acting as {user.name || user.email || user.id}. The server rejects approval by the same operator who prepared the batch.</p>}
            <p className="text-sm text-slate-600">Review notes alone do not authorize approval: confirm that you reviewed the exact evidence shown above, then approve. Approval re-checks that evidence immediately before submitting.</p>
            {(!reviewSnapshot || reviewSnapshot.batchId !== batchDetail.id) ? (
              <AccountingButton tone="secondary" busy={busy === 'review'} disabled={!canManage || actionDisabled('review')} onClick={confirmReview}>Confirm review of displayed evidence</AccountingButton>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-emerald-800">Review confirmed for opening hash {reviewSnapshot.openingPayloadHash.slice(0, 12)}…. Any change to the batch clears this confirmation.</p>
                <AccountingButton tone="secondary" onClick={() => { setReviewSnapshot(null); setNotice('Review confirmation cleared. Confirm review again against the displayed evidence before approving.') }}>Re-review</AccountingButton>
              </div>
            )}
            <label className={labelClass}>Independent review notes<textarea required minLength={8} rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} className={inputClass} placeholder="What did you verify against source evidence?" /></label>
            <AccountingButton busy={busy === 'approve'} disabled={!canManage || actionDisabled('approve') || selfPrepared || !reviewSnapshot || reviewSnapshot.batchId !== batchDetail.id} onClick={approveCutover}>Approve cutover batch</AccountingButton>
            {selfPrepared && <p className="text-sm text-amber-800">You prepared this batch, so approval is disabled for you. A different authorised reviewer must approve it.</p>}
          </form>
        )}
        {batchDetail?.id && batchDetail.status === 'approved' && (
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4" data-testid="cutover-apply-section">
            <p className="text-sm"><strong>Batch {batchDetail.id} is independently approved.</strong> Applying posts each opening balance once under server idempotency keys and freezes the batch.</p>
            <AccountingButton busy={busy === `apply:${batchDetail.id}`} disabled={!canManage || busy !== ''} onClick={applyCutover}>Apply opening balances</AccountingButton>
          </div>
        )}
        {batchDetail?.id && batchDetail.status === 'applied' && (
          <p className="mt-4 text-sm text-slate-600">Batch {batchDetail.id} is applied. Its stored posting references are shown above; re-applying returns them without reposting.</p>
        )}
      </AccountingPanel>

      <AccountingPanel title="3 · Activate" description="Explicit approval with exact arguments. The server re-checks readiness, cutover approval, and effective dating.">
        {!canManage && <AccountingNotice type="warning">Activating Accounting requires Restaurant Accounting management access.</AccountingNotice>}
        <form onSubmit={activate} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <label className={labelClass}>Effective from<input type="date" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Configuration version<input required value={configurationVersion} onChange={(event) => setConfigurationVersion(event.target.value)} className={inputClass} placeholder="e.g. 2026-09-pilot" /></label>
            <label className={labelClass}>Cutover batch id (optional)<input value={cutoverBatchId} onChange={(event) => setCutoverBatchId(event.target.value)} className={inputClass} placeholder="Applied batch required when POS sales predate activation" /></label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-1" />
            <span>I approve activating Accounting from {effectiveFrom || '—'} under configuration {configurationVersion.trim() || '—'} and policy {POLICY_VERSION}{cutoverBatchId.trim() ? ` with cutover batch ${cutoverBatchId.trim()}` : ''}.</span>
          </label>
          <AccountingButton busy={busy === 'activate'} disabled={!canManage || actionDisabled('activate')} onClick={activate}>Activate Accounting</AccountingButton>
        </form>
      </AccountingPanel>

      <AccountingPanel title="4 · Suspend (preserves history)" description="Suspending stops new posting. Posted records stay readable through authorised history.">
        {!canManage && <AccountingNotice type="warning">Suspending Accounting requires Restaurant Accounting management access.</AccountingNotice>}
        <form onSubmit={suspend} className="space-y-3">
          <label className={labelClass}>Suspension reason<textarea required minLength={8} rows={2} value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} className={inputClass} /></label>
          <AccountingButton tone="amber" busy={busy === 'suspend'} disabled={!canManage || actionDisabled('suspend')} onClick={suspend}>Suspend Accounting posting</AccountingButton>
        </form>
      </AccountingPanel>
    </div>
  )
}
