// Behavioral harness driving the REAL property-transition lifecycle logic.
// Map-backed storage stands in for scoped localStorage; fake commit/status
// functions stand in for the desktop domain RPCs (no network, no DOM).
import { randomUUID } from 'node:crypto'
import {
  OPERATION_STORAGE_VERSION,
  buildStorageKey,
  buildCommitPayload,
  captureOperation,
  canEditDuringPending,
  createLifecycle,
  describeRecoveryState,
  isSameOperation,
  parseOperation,
  serializeOperation,
  shouldRetireAfter
} from '../../src/shared/propertyTransitionOperation.js'

export {
  OPERATION_STORAGE_VERSION,
  buildStorageKey,
  buildCommitPayload,
  captureOperation,
  canEditDuringPending,
  createLifecycle,
  describeRecoveryState,
  isSameOperation,
  parseOperation,
  serializeOperation,
  shouldRetireAfter
}

/**
 * Create a harness with fake persistence + fake RPCs.
 * @param {object} options
 * @param {string} options.lodgeId
 * @param {string|null} [options.userId]
 * @param {(payload: object) => unknown} [options.commit] fake commit RPC
 * @param {(idempotencyKey: string) => unknown} [options.status] fake status RPC
 * @param {() => string} [options.generateKey] deterministic key mint for tests
 */
export function createPropertyTransitionHarness({
  lodgeId,
  userId = null,
  commit = async () => ({ success: true, data: { changed: true } }),
  status = async () => ({ success: false, code: 'NOT_FOUND' }),
  generateKey = () => randomUUID()
} = {}) {
  const lifecycle = createLifecycle({ lodgeId, userId, generateKey })
  const store = new Map()
  const submitted = []
  const statusLookups = []
  const flags = { committed: false, refreshFailed: false, refreshWarning: '' }

  const storageKey = () => buildStorageKey({ lodgeId: harness.lodgeId, userId: harness.userId })

  const persist = () => {
    const stored = lifecycle.getStored()
    if (stored) store.set(storageKey(), serializeOperation(stored))
  }
  const unpersist = () => {
    store.delete(storageKey())
  }

  const harness = {
    lifecycle,
    store,
    submitted,
    statusLookups,
    flags,
    lodgeId,
    userId,
    storageKey,
    /** Begin a new operation and persist BEFORE any submit (renderer discipline). */
    begin(draft, keyOverride) {
      const op = lifecycle.begin({ ...draft, idempotencyKey: keyOverride })
      persist()
      return op
    },
    /** Exact payload bytes that would be submitted for the pending operation. */
    payloadBytes() {
      return lifecycle.payloadBytes()
    },
    /** Submit the pending operation through the fake commit RPC. */
    async submit() {
      const payload = lifecycle.payload()
      const bytes = JSON.stringify(payload)
      submitted.push(bytes)
      return commit(payload)
    },
    /** Timeout then exact retry: both submits must carry identical bytes. */
    async submitWithTimeoutThenRetry() {
      const first = lifecycle.payload()
      submitted.push(JSON.stringify(first))
      let firstError = null
      try {
        await commit(first)
      } catch (error) {
        firstError = error
      }
      const retryPayload = lifecycle.markTimeout()
      const retryBytes = JSON.stringify(retryPayload)
      submitted.push(retryBytes)
      const retryResult = await commit(retryPayload)
      return { firstError, retryResult }
    },
    /** Simulate unmount/remount: serialize → parse → rebuild payload. */
    remountPayloadBytes() {
      const json = store.get(storageKey())
      const recovered = parseOperation(json)
      if (!recovered) return null
      return JSON.stringify(buildCommitPayload(recovered))
    },
    /** Simulate process restart: fresh lifecycle restored from stored JSON. */
    restart() {
      const json = store.get(storageKey())
      const fresh = createLifecycle({ lodgeId: harness.lodgeId, userId: harness.userId, generateKey })
      const restored = json ? fresh.restore(json) : null
      return { fresh, restored }
    },
    /** Status lookup through the fake status RPC. */
    async checkStatus() {
      const stored = lifecycle.getStored()
      const key = stored?.idempotencyKey
      statusLookups.push(key)
      return status(key)
    },
    /**
     * Commit-then-refresh discipline used by the renderer: retire on
     * authoritative outcome, then run onCommitted separately so a refresh
     * failure never marks the commit failed and never resubmits.
     */
    async commitThenRefresh(onCommitted) {
      const result = await harness.submit()
      const outcome = lifecycle.markCommitSucceeded(result)
      if (outcome.retired) {
        unpersist()
        flags.committed = true
        try {
          await onCommitted?.(result)
        } catch {
          lifecycle.markRefreshFailed()
          flags.refreshFailed = true
          flags.refreshWarning = 'Change saved on server, but local refresh failed — Reload settings / Check outcome (no resubmit).'
        }
      }
      return { result, outcome }
    },
    discard() {
      const outcome = lifecycle.discard()
      unpersist()
      return outcome
    },
    describe() {
      return describeRecoveryState({
        stored: lifecycle.getStored(),
        currentLodgeId: harness.lodgeId,
        currentUserId: harness.userId
      })
    }
  }
  return harness
}

/** Storage round-trip helper shared by restart-recovery tests. */
export function roundTripOperation(op) {
  return parseOperation(serializeOperation(op))
}
