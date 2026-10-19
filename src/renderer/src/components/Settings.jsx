// @ts-check
import { useEffect, useLayoutEffect, useState, useRef, useContext, useMemo, lazy, Suspense } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Building2, Phone, Mail, MapPin, Globe, Hash, Save, Upload, X, Image, Moon, RefreshCw, CheckCircle2, AlertTriangle, Key, ShieldCheck, Clock, CreditCard, Copy, TrendingUp, ArrowUpCircle, Settings as SettingsIcon, MessageCircle, FileText, Info, Send, Sparkles, Download, RotateCcw, Sun, Monitor, Store } from 'lucide-react'
import { useAccess, useAuth, useSettings, UnsavedChangesContext } from '../app-context'
import { Modal } from './shared/Modal'
import { ErrorNotice } from './shared/ErrorNotice'
import { extractReleaseHighlights, formatReleaseDate, normalizeReleaseNotes, toReleaseSections } from '../utils/updatePresentation'
import { applyThemeMode, getStoredThemeMode, resolveThemeMode, saveThemeMode } from '../utils/themeMode'
import {
  buildOperatingProfile,
  normalizePropertyType,
  propertyTypeToBusinessType,
  isRestaurantOnly,
  isBarOnlyMode,
  HOSPITALITY_MODES,
  getExplicitHospitalityMode,
  PROPERTY_TYPE_LABELS
} from '../../../shared/propertyTypes'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import {
  getLodgingTypeOptions,
  getPropertyPresentation,
  isSameProductTransition,
  describePresentationDiff,
  mapPropertyTransitionError,
  summarizeAccommodationMix,
  toSupportedLodgingType
} from '../../../shared/propertyPresentation'
import { getUiVocabulary } from '../../../shared/uiVocabulary'
import {
  OPERATION_STORAGE_VERSION,
  TransitionStorageError,
  buildStorageKey,
  canEditDuringPending,
  createTransitionController,
  describeArchivedTerminal,
  isSameOperation,
  listArchivedTransitionOps,
  loadStoredTransitionOp,
  shortOperationKey
} from '../../../shared/propertyTransitionOperation'
import { canAccessCapability } from '../../../shared/accessControl'
import {
  DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES,
  TILL_OPERATOR_MODES,
  getTillOperatorPolicy,
  normalizeTillOperatorInactivityMinutes
} from '../../../shared/tillOperatorPolicy'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_HOTEL_PRODUCT = BUILD_PRODUCT.id === 'hotel'
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'
const IS_HOSPITALITY_POS_PRODUCT = BUILD_PRODUCT.id === 'hospitality-pos'
const SystemHealthPanel = lazy(() => import('./SystemHealthPanel'))
const SubscriptionAccessPanel = lazy(() => import('./SubscriptionAccessPanel'))

const BOOKING_SITE_BASE = 'https://borokoonlinebookings.netlify.app'
const PUBLIC_OFFER_DEFAULTS = {
  public_offer_rooms: true,
  public_offer_multi_room: true,
  public_offer_full_lodge: false,
  public_offer_day_use: false,
  public_offer_events: false
}
const PUBLIC_OFFER_DEFAULT_TRUE = new Set(['public_offer_rooms', 'public_offer_multi_room'])
// The main process has a 15-second end-to-end budget; keep a small IPC slack
// so the renderer does not report failure just as the main process resolves.
const SETTINGS_SAVE_TIMEOUT_MS = 20000
/** @typedef {Pick<import('../types/desktop-api.js').DesktopUpdateStateReadView, 'version' | 'releaseName' | 'releaseDate' | 'releaseNotes'> & {progress?: import('../types/desktop-api.js').DesktopUpdateProgressReadView | null}} SettingsUpdateMetadataReadView */
/** @typedef {SettingsUpdateMetadataReadView | {version?: undefined, releaseName?: undefined, releaseDate?: undefined, releaseNotes?: undefined, progress: import('../types/desktop-api.js').DesktopUpdateProgressReadView}} SettingsUpdateMetaReadView */
const EMAIL_PROVIDER_PRESETS = {
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Gmail address and a Gmail App Password.'
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Outlook or Microsoft 365 email and password or app password.'
  },
  zoho: {
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use your full Zoho mailbox and password or app password.'
  },
  cpanel: {
    label: 'cPanel / Business Email',
    host: 'mail.yourdomain.com',
    port: 465,
    allow_insecure_tls: false,
    hint: 'Use the mailbox details from your hosting provider.'
  },
  custom: {
    label: 'Other SMTP',
    host: '',
    port: 587,
    allow_insecure_tls: false,
    hint: 'Use this if your provider gave you custom SMTP details.'
  }
}

function inferEmailProvider(host = '') {
  const normalized = String(host || '').trim().toLowerCase()
  if (normalized.includes('smtp.gmail.com')) return 'gmail'
  if (normalized.includes('office365.com') || normalized.includes('outlook.com')) return 'outlook'
  if (normalized.includes('zoho.com')) return 'zoho'
  if (normalized.startsWith('mail.') || normalized.includes('cpanel')) return 'cpanel'
  return 'custom'
}

function normalizePlanName(plan) {
  const raw = String(plan || '').trim().toLowerCase()
  if (raw === 'premium') return 'Pro'
  if (raw === 'basic') return 'Starter'
  if (raw === 'pro') return 'Pro'
  if (raw === 'standard') return 'Standard'
  if (raw === 'starter') return 'Starter'
  return plan || ''
}

function cloneSettings(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function settingsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function withSettingsSaveTimeout(promise, timeoutMs = SETTINGS_SAVE_TIMEOUT_MS) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Saving settings timed out. Check the internet connection and try Save Settings again.')
      error.code = 'settings_save_timeout'
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function newTransitionUuid() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  } catch {}
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`.toLowerCase()
}

function readTransitionResult(res) {
  if (res && typeof res === 'object' && res.success === true) return { ok: true, result: res }
  const error = new Error(res?.error || res?.message || 'The property-type service rejected this request.')
  error.code = res?.code || 'property_transition_rejected'
  return { ok: false, error }
}

// Scoped local persistence for the pending property-transition operation.
// Only identifiers are stored (lodge, user scope, target, expected state,
// reason, key) — never credentials or tokens.
//
// Durability is fail-closed (R4): the shared storage helpers throw a
// TransitionStorageError when storage is missing, blocked or failing, and no
// mutation is ever submitted unless the operation is verifiably durable
// (write + re-read match). Terminal operations are never permanently deleted:
// they retire into the append-only per-scope archive and stay recoverable by
// key. Another scope's record is read-only here — counted, never opened,
// submitted, modified or deleted.
function scopeKeyForTransition(lodgeId, userId) {
  try {
    return buildStorageKey({ lodgeId, userId })
  } catch {
    return null
  }
}

function readTransitionStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

// Fail-closed scoped load. Returns `{ op, storageError }`: a blocked store
// surfaces an actionable TransitionStorageError instead of silently
// orphaning the operation key.
function loadScopedTransitionOp(storageKey) {
  const storage = readTransitionStorage()
  try {
    if (!storageKey || !storage) {
      throw new TransitionStorageError(
        'Local recovery storage is unavailable, so a pending property-type operation cannot be recovered on this device right now. Nothing was submitted — enable local storage, then use “Check outcome” with the original operation key before retrying.',
        { scope: null, key: typeof storageKey === 'string' ? storageKey : null, cause: 'missing-or-blocked-storage' }
      )
    }
    return { op: loadStoredTransitionOp(storage, storageKey), storageError: null }
  } catch (error) {
    if (error instanceof TransitionStorageError) return { op: null, storageError: error }
    return { op: null, storageError: null }
  }
}

// Pending records filed under a different scope key (another lodge/user on
// this device). Presence only: details are never read for display, and
// nothing here is ever submitted, modified or deleted from this scope.
function findForeignTransitionKeys(currentKey) {
  try {
    const storage = readTransitionStorage()
    if (!storage) return []
    const prefix = `${OPERATION_STORAGE_VERSION}::`
    const out = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith(prefix) || key === currentKey) continue
      try {
        if (loadStoredTransitionOp(storage, key)) out.push(key)
      } catch {
        // A blocked store yields no foreign list rather than a crash; the
        // scoped load above already reports the storage failure truthfully.
      }
    }
    return out
  } catch {
    return []
  }
}

// Append-only terminal-operation history for this scope (archived instead of
// deleted). Read-only here: entries are listed for recovery by their ORIGINAL
// keys and are never edited, resubmitted or deleted. Listing is scoped to the
// current lodge/user — switching scope shows only that scope's history.
function listScopedArchivedOps(lodgeId, userId) {
  try {
    const storage = readTransitionStorage()
    if (!storage || !lodgeId) return []
    const entries = listArchivedTransitionOps(storage, { lodgeId, userId })
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

function transitionTargetLabel(targetType) {
  try {
    return getLodgingTypeOptions().find((option) => option.value === targetType)?.label || String(targetType || '')
  } catch {
    return String(targetType || '')
  }
}

/**
 * Controlled same-product property-type change (LodgingOS only).
 * Ordinary settings save never touches classification: this section keeps its
 * own target/preview/confirm state and commits only through the dedicated
 * atomic, audited, idempotent server contract. Enforcement (capability, lodge
 * scope, same-product, expected version, key binding) is server-side; this UI
 * only previews, confirms explicitly, and recovers.
 */
export function PropertyTypeSection({ globalSettings, access, canManage, onCommitted }) {
  const { user } = useAuth() || {}
  const lodgeId = globalSettings?.lodge_id || null
  const userScopeId = user?.id || user?.email || null
  const scopeKey = scopeKeyForTransition(lodgeId, userScopeId)
  const currentType = normalizePropertyType(globalSettings?.property_type || globalSettings?.business_type || 'lodge')
  const currentSupported = toSupportedLodgingType(globalSettings?.property_type || globalSettings?.business_type || '')
  const settingsIdentity = `${globalSettings?.lodge_id || ''}::${currentType}::${globalSettings?.updated_at || ''}`
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [commitBusy, setCommitBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [ackPreserved, setAckPreserved] = useState(false)
  const [reason, setReason] = useState('')
  // The pending operation is the source of truth; operationKey mirrors it.
  // Both initialize from the scoped stored record (reopen/restart recovery),
  // never from an empty default that would orphan a stored key. The shared
  // transition controller (`createTransitionController`) owns durability,
  // submission, status recovery, fencing and archiving; this React state only
  // mirrors it for rendering.
  const [pendingOp, setPendingOp] = useState(() => loadScopedTransitionOp(scopeKeyForTransition(globalSettings?.lodge_id || null, user?.id || user?.email || null))?.op || null)
  const [operationKey, setOperationKey] = useState(() => loadScopedTransitionOp(scopeKeyForTransition(globalSettings?.lodge_id || null, user?.id || user?.email || null))?.op?.idempotencyKey || '')
  const [foreignKeys, setForeignKeys] = useState(() => findForeignTransitionKeys(scopeKeyForTransition(globalSettings?.lodge_id || null, user?.id || user?.email || null)))
  const [archiveEntries, setArchiveEntries] = useState(() => listScopedArchivedOps(globalSettings?.lodge_id || null, user?.id || user?.email || null))
  // Scoped archive/history recovery selection: which archived entry the
  // operator chose to check, its latest read-only lookup, and in-flight flag.
  const [selectedArchivedKey, setSelectedArchivedKey] = useState(null)
  const [archivedLookups, setArchivedLookups] = useState({})
  const [archivedBusy, setArchivedBusy] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(() => loadScopedTransitionOp(scopeKeyForTransition(globalSettings?.lodge_id || null, user?.id || user?.email || null))?.storageError || null)
  const [discardArmed, setDiscardArmed] = useState(false)
  const [refreshWarning, setRefreshWarning] = useState(null)
  const [notice, setNotice] = useState(null)
  const [failure, setFailure] = useState(null)
  const [statusReport, setStatusReport] = useState(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  // Live scope mirror for fenced async callbacks: late results for a previous
  // scope or superseded key are ignored and can never clear a newer operation.
  const scopeRef = useRef({ lodgeId, userId: userScopeId, scopeKey })
  scopeRef.current = { lodgeId, userId: userScopeId, scopeKey }
  // A key-only comparison misses A → B → A while an archived status request
  // is in flight. A layout effect increments the epoch before promise
  // callbacks can publish a result for the newly committed scope.
  const scopeEpochRef = useRef(0)
  const previousScopeKeyRef = useRef(scopeKey)
  const archivedLookupTicketRef = useRef(0)
  const controllerRef = useRef(null)
  // Records the latest outcome check per operation key ('NOT_FOUND …',
  // 'stored outcome not yet completed', 'authoritative outcome found') so the
  // archive-and-supersede reason can state what the operator ACTUALLY did.
  const statusCheckRef = useRef({})
  // Set when the server confirmed a mutation but the on-device archive write
  // failed: the outcome stays visible and the op stays checkable by key.
  const archiveFailedRef = useRef(false)

  useLayoutEffect(() => {
    if (previousScopeKeyRef.current !== scopeKey) {
      previousScopeKeyRef.current = scopeKey
      scopeEpochRef.current += 1
    }
  }, [scopeKey])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener?.('online', goOnline)
    window.addEventListener?.('offline', goOffline)
    return () => {
      window.removeEventListener?.('online', goOnline)
      window.removeEventListener?.('offline', goOffline)
    }
  }, [])

  // Mount + scope recovery: whenever the lodge/user scope changes, adopt the
  // operation stored under that scope WITHOUT submitting anything. A stored
  // record restores the exact draft (target/reason) so retries stay
  // byte-identical; records from other scopes are only counted, never opened,
  // submitted, modified or deleted. In-memory key state always clears on scope
  // change; storage is left for a switch-back. A blocked store surfaces an
  // actionable error instead of silently orphaning the key.
  useEffect(() => {
    archivedLookupTicketRef.current += 1
    const controller = controllerRef.current
    if (controller) {
      try {
        controller.setScope({ lodgeId, userId: userScopeId })
      } catch {
        // Scope shape is validated when an operation starts; recovery keeps
        // whatever is already held rather than crashing Settings.
      }
      try {
        controller.recover()
        setStorageBlocked(null)
      } catch (error) {
        setStorageBlocked(error instanceof TransitionStorageError ? error : null)
      }
    }
    const stored = controller?.getStored() || loadScopedTransitionOp(scopeKey)?.op || null
    setPendingOp(stored)
    setOperationKey(stored?.idempotencyKey || '')
    setForeignKeys(findForeignTransitionKeys(scopeKey))
    // Scope isolation: show only this scope's history; drop any previous
    // scope's selection/lookup so it can never render under the new scope.
    setArchiveEntries(listScopedArchivedOps(lodgeId, userScopeId))
    setSelectedArchivedKey(null)
    setArchivedLookups({})
    setArchivedBusy(false)
    setDiscardArmed(false)
    if (stored) {
      setTarget(stored.targetType)
      setReason(stored.reason || '')
      setNotice({
        tone: 'info',
        message: `Resumed pending operation ${shortOperationKey(stored.idempotencyKey)} for ${transitionTargetLabel(stored.targetType)} — check outcome before retrying. Target and reason are locked until it is resolved or archived-and-superseded.`
      })
    }
  }, [scopeKey])

  // A new target, or reloaded settings underneath, invalidates any preview.
  useEffect(() => {
    setPreview(null)
    setConfirmText('')
    setAckPreserved(false)
    setStatusReport(null)
  }, [target, settingsIdentity])

  const api = window.api?.settings || {}
  const previewAvailable = typeof api.previewPropertyTypeChange === 'function'
  const commitAvailable = typeof api.commitPropertyTypeChange === 'function'
  const statusAvailable = typeof api.getPropertyTypeTransitionStatus === 'function'
  const contractAvailable = previewAvailable && commitAvailable && statusAvailable

  const mixSummary = summarizeAccommodationMix(
    globalSettings?.operating_profile?.accommodation_mix,
    globalSettings?.operating_profile
  )
  let currentWording = null
  try {
    currentWording = getPropertyPresentation({ propertyType: currentType, operatingProfile: globalSettings?.operating_profile })
  } catch {
    currentWording = null
  }
  const targetOption = getLodgingTypeOptions().find((option) => option.value === target) || null
  const previewForTarget = preview && preview.targetType === target ? preview : null
  const previewFresh = Boolean(
    previewForTarget
    && previewForTarget.expectedPropertyType === currentType
    && (previewForTarget.expectedUpdatedAt || null) === (globalSettings?.updated_at || null)
  )
  const confirmReady = Boolean(
    previewFresh && targetOption && canManage && online
    && confirmText.trim().toLowerCase() === targetOption.label.toLowerCase()
    && ackPreserved
  )
  const previewBlockers = Array.isArray(previewForTarget?.data?.blockers) ? previewForTarget.data.blockers : []
  const previewNotes = Array.isArray(previewForTarget?.data?.navigation?.notes) ? previewForTarget.data.navigation.notes : []
  // While a same-scope operation is pending, target/reason are immutable
  // (canEditDuringPending() is always false). Changing them requires an
  // explicit discard of the pending operation first.
  const pendingLock = Boolean(pendingOp && !canEditDuringPending())
  const pendingLabel = pendingOp ? transitionTargetLabel(pendingOp.targetType) : null
  const retryReady = Boolean(
    pendingOp && pendingLabel && canManage && online && !commitBusy && !statusBusy
    && confirmText.trim().toLowerCase() === pendingLabel.toLowerCase()
    && ackPreserved
  )

  const runPreview = async () => {
    if (!target || previewBusy || commitBusy) return
    if (!isSameProductTransition(currentType, target)) {
      setFailure({ kind: 'conflict', message: 'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel).', retryable: false })
      return
    }
    setFailure(null)
    setNotice(null)
    setStatusReport(null)
    if (!online) {
      setFailure(mapPropertyTransitionError({ code: 'property_transition_offline' }))
      return
    }
    if (!previewAvailable) {
      // Advisory local wording diff only; server blockers stay unknown.
      setPreview({
        advisory: true,
        targetType: target,
        expectedPropertyType: currentType,
        expectedUpdatedAt: globalSettings?.updated_at || null,
        diff: describePresentationDiff(currentType, target),
        at: new Date().toISOString()
      })
      setNotice({ tone: 'warning', message: 'Server preview is unavailable in this build, so blockers could not be checked. Update the desktop app before committing a property-type change.' })
      return
    }
    setPreviewBusy(true)
    try {
      const res = await api.previewPropertyTypeChange(target)
      const read = readTransitionResult(res)
      if (!read.ok) throw read.error
      setPreview({
        advisory: false,
        targetType: target,
        expectedPropertyType: currentType,
        expectedUpdatedAt: globalSettings?.updated_at || null,
        data: read.result.data || null,
        at: new Date().toISOString()
      })
      if (read.result.data?.expected_match === false) {
        setNotice({ tone: 'warning', message: 'Settings changed since this preview was requested. Reload settings, then preview again before committing.' })
      }
    } catch (error) {
      setPreview(null)
      setFailure(mapPropertyTransitionError(error))
    } finally {
      setPreviewBusy(false)
    }
  }

  // Mirror the controller (single source of truth for the operation) into
  // React state for rendering.
  const syncFromController = () => {
    const controller = controllerRef.current
    const stored = controller?.getStored() || null
    setPendingOp(stored)
    setOperationKey(stored?.idempotencyKey || '')
    setArchiveEntries(listScopedArchivedOps(scopeRef.current.lodgeId, scopeRef.current.userId))
    return stored
  }

  const clearTransitionForm = () => {
    setTarget('')
    setPreview(null)
    setConfirmText('')
    setAckPreserved(false)
    setReason('')
    setStatusReport(null)
  }

  const storageFailureOf = (error) => (error instanceof TransitionStorageError
    ? { kind: 'storage', message: error.message, retryable: true }
    : mapPropertyTransitionError(error))

  // Authoritative post-commit reconciliation (R5): the controller already ran
  // the awaited server read (`refreshSettingsFromServer`, never a cache-first
  // get) and reported it truthfully. Only when that read succeeded do we sync
  // the open form from the now-fresh cache; a stale cache must never be
  // reapplied after the server committed. Entitlement/access refresh failure
  // is reported truthfully too. The completed mutation is retained in every
  // path and is NEVER resubmitted to repair a refresh failure.
  const settleRefreshPending = async (serverRefresh) => {
    if (!serverRefresh || serverRefresh.ok !== true) {
      const reason = serverRefresh ? (serverRefresh.reason || 'refresh-failed') : 'refresh-unavailable'
      const detail = serverRefresh?.detail ? ` (${serverRefresh.detail})` : ''
      setRefreshWarning(`Change saved on server, but local refresh failed (${reason}${detail}) — use “Retry refresh only” below. No new submission will be made.`)
      return false
    }
    try {
      await onCommitted?.()
    } catch {
      // Form sync is best-effort; the authoritative server read above is the
      // truth and the cache it wrote is already fresh.
    }
    try {
      await access?.refreshEntitlement?.({ forceFresh: true })
    } catch (error) {
      const reason = error?.message || String(error)
      setRefreshWarning(`Change saved on server, but access/entitlement refresh failed (${reason}) — use “Retry refresh only” below. No new submission will be made.`)
      return false
    }
    setRefreshWarning(null)
    return true
  }

  // Refresh-only recovery: re-runs the authoritative settings read without
  // submitting any mutation. The controller asserts by construction that no
  // commit happens on this path.
  const retryRefreshOnly = async () => {
    const controller = controllerRef.current
    if (!controller) return
    setFailure(null)
    try {
      const res = await controller.retryRefreshOnly()
      if (res && res.ok === true) {
        const ok = await settleRefreshPending({ ok: true })
        if (ok) {
          setNotice({ tone: 'success', message: 'Settings and access refreshed from the server — no new submission was made.' })
        }
      } else {
        setRefreshWarning(`Local refresh still failing (${res?.reason || 'refresh-failed'}) — use “Retry refresh only” again later. No new submission will be made.`)
      }
    } catch (error) {
      setFailure(storageFailureOf(error))
    }
    syncFromController()
  }

  // Background controller events (late completions after a timeout UI was
  // already shown, scope-fenced stale callbacks, recovery). User-clicked
  // submit/check flows settle inline after their await; this handler only
  // reconciles completions that arrive outside those flows. late-retired and
  // refresh-pending are idempotent with the inline paths.
  const handleControllerEvent = (name, detail) => {
    const controller = controllerRef.current
    if (!controller) return
    if (name === 'late-retired') {
      const op = detail?.op || null
      syncFromController()
      clearTransitionForm()
      setFailure(null)
      const label = op ? transitionTargetLabel(op.targetType) : 'The property type'
      setNotice({ tone: 'success', message: `The earlier request finished on the server after the timeout — ${label} is now recorded. No duplicate was submitted.` })
      const rs = controller.getRefreshState()
      void settleRefreshPending(rs && rs.ok === true ? { ok: true } : (rs || { ok: false, reason: 'refresh-failed' }))
    } else if (name === 'refresh-pending') {
      syncFromController()
      const rs = controller.getRefreshState()
      const reason = rs ? (rs.reason || 'refresh-failed') : 'refresh-failed'
      setRefreshWarning(`Change saved on server, but local refresh failed (${reason}) — use “Retry refresh only” below. No new submission will be made.`)
    } else if (name === 'archive-failed') {
      // The server outcome is already retired in memory (never resubmitted);
      // only the on-device archive write failed. Flag it so the inline path
      // keeps the outcome visible instead of clearing it.
      archiveFailedRef.current = true
    } else if (name === 'recovered' || name === 'superseded') {
      syncFromController()
    }
    // 'stale-ignored': a late/stale callback for a previous scope or a
    // superseded key — intentionally no UI change, never clears a newer op.
  }

  // The REAL production operation controller for this section: durable
  // write-verify-submit discipline end to end. ensureDurable/beginNew persist
  // + verify by re-read and throw TransitionStorageError BEFORE any submit;
  // submitCurrent builds the payload via buildCommitPayload(storedOp) once per
  // in-flight request and never mints a replacement key after an ambiguous
  // timeout; checkOutcome retires + archives only on an authoritative
  // completed outcome; archiveAndSupersede is the only way to abandon an op.
  if (!controllerRef.current) {
    controllerRef.current = createTransitionController({
      storage: readTransitionStorage(),
      api: {
        commit: (payload) => {
          if (typeof window !== 'undefined' && typeof window.api?.settings?.commitPropertyTypeChange === 'function') {
            return window.api.settings.commitPropertyTypeChange(payload)
          }
          const error = new Error('The property-type commit service is unavailable in this build.')
          error.code = 'unavailable'
          return Promise.reject(error)
        },
        status: (idempotencyKey) => {
          if (typeof window !== 'undefined' && typeof window.api?.settings?.getPropertyTypeTransitionStatus === 'function') {
            return window.api.settings.getPropertyTypeTransitionStatus(idempotencyKey)
          }
          const error = new Error('The property-type status service is unavailable in this build.')
          error.code = 'unavailable'
          return Promise.reject(error)
        },
        refresh: () => {
          if (typeof window !== 'undefined' && typeof window.api?.settings?.refreshSettingsFromServer === 'function') {
            return window.api.settings.refreshSettingsFromServer()
          }
          return Promise.resolve({ ok: false, reason: 'refresh-unavailable' })
        }
      },
      timers: { commitTimeoutMs: SETTINGS_SAVE_TIMEOUT_MS },
      scope: { lodgeId, userId: userScopeId },
      generateKey: () => newTransitionUuid(),
      onEvent: handleControllerEvent
    })
  }

  // Submit the CURRENT stored operation through the shared controller. The
  // payload comes from buildCommitPayload(storedOp), computed once per
  // in-flight request and reused byte-identically on retry. At most one
  // request is in flight; an ambiguous timeout keeps the op
  // (awaiting-outcome) instead of minting a replacement key, and a late
  // completion retires exactly once via the controller event above.
  const submitStoredOp = async (op) => {
    const controller = controllerRef.current
    if (!controller || !op) {
      setFailure({ kind: 'unknown', message: 'No pending property-type operation to submit.', retryable: false })
      return
    }
    // Fence: submit only the operation the controller currently holds. A
    // superseded key or a scope switch between render and click never submits.
    const held = controller.getStored()
    if (!held || !isSameOperation(held, op)) {
      syncFromController()
      setFailure({
        kind: 'conflict',
        message: 'This is no longer the current pending operation (scope changed or it was superseded). The current operation is shown above — use “Check outcome” with its values.',
        retryable: false
      })
      return
    }
    setCommitBusy(true)
    try {
      const res = await controller.submitCurrent()
      if (res?.stale) {
        // A scope switch or supersede landed mid-flight: nothing changed.
        syncFromController()
        return
      }
      if (res?.retired) {
        const label = transitionTargetLabel(op.targetType)
        const changed = res?.result?.data?.changed !== false
        const replayed = res?.result?.replayed === true
        const archived = archiveFailedRef.current
        archiveFailedRef.current = false
        syncFromController()
        clearTransitionForm()
        setDiscardArmed(false)
        setFailure(null)
        setNotice({
          tone: 'success',
          message: replayed
            ? `Recorded already (same operation key). Showing the authoritative stored outcome for ${label}.`
            : (changed
              ? `Property type is now ${label}. Settings and access are refreshing.`
              : `Already ${label} — recorded as a checked no-op.`)
        })
        if (archived) {
          setNotice({ tone: 'warning', message: `Property type is now ${label}, but the on-device archive write failed — the outcome stays visible above and remains checkable by its key. No duplicate was submitted.` })
        }
        await settleRefreshPending(res?.refresh)
        return
      }
      // A non-retiring response keeps the op checkable; never invent success.
      syncFromController()
      setNotice({ tone: 'info', message: 'The server response was not a completed change. The operation is kept — use “Check outcome” before retrying.' })
    } catch (error) {
      syncFromController()
      const mapped = storageFailureOf(error)
      if (mapped.kind === 'stale') {
        // Stale-version rejection: force a fresh preview, keep the stored
        // operation locked so the original values stay checkable.
        setPreview(null)
        setFailure(mapped)
      } else if (mapped.kind === 'conflict') {
        setFailure({ ...mapped, message: `${mapped.message} Showing the original values for “Check outcome” below — no new key was created.` })
      } else {
        setFailure(mapped)
      }
      // Ambiguous timeout (or unknown outcome): the controller preserved the
      // stored op (awaiting-outcome) and reconciles a late success without
      // resubmitting — nothing further to do here.
    } finally {
      setCommitBusy(false)
    }
  }

  const runCommit = async () => {
    if (commitBusy) return
    setFailure(null)
    setNotice(null)
    setStatusReport(null)
    setRefreshWarning(null)
    if (!online) {
      setFailure(mapPropertyTransitionError({ code: 'property_transition_offline' }))
      return
    }
    if (!commitAvailable) {
      setFailure(mapPropertyTransitionError({ code: 'unavailable' }))
      return
    }
    if (pendingOp) {
      // Exact retry of the pending operation: the live draft must still match
      // the captured values, otherwise the submit is blocked and the operator
      // is directed to Check outcome (never a silent new key).
      if (target !== pendingOp.targetType || reason.trim() !== String(pendingOp.reason || '')) {
        setFailure({
          kind: 'conflict',
          message: `This change differs from pending operation ${shortOperationKey(pendingOp.idempotencyKey)} (${pendingLabel}). Use “Check outcome” with the original values, or explicitly discard the pending operation to start a new change.`,
          retryable: false
        })
        return
      }
      if (previewForTarget
        && (previewForTarget.expectedPropertyType !== pendingOp.expectedPropertyType
          || (previewForTarget.expectedUpdatedAt ?? null) !== (pendingOp.expectedUpdatedAt ?? null))) {
        setFailure({
          kind: 'stale',
          message: 'The fresh preview no longer matches the pending operation. Use “Check outcome” with the original values first.',
          retryable: true
        })
        return
      }
      if (!retryReady) return
      await submitStoredOp(pendingOp)
      return
    }
    if (!confirmReady) return
    // beginNew mints a FRESH key and durably persists (write + re-read verify)
    // BEFORE any RPC call. A blocked store throws TransitionStorageError here
    // with zero RPC calls — the change is NOT submitted. A later genuine
    // change mints its own fresh key because retire/archive clears the record.
    let op
    try {
      op = controllerRef.current.beginNew({
        targetType: target,
        expectedPropertyType: previewForTarget.expectedPropertyType,
        expectedUpdatedAt: previewForTarget.expectedUpdatedAt,
        reason: reason.trim()
      })
    } catch (error) {
      setFailure(storageFailureOf(error))
      return
    }
    syncFromController()
    await submitStoredOp(op)
  }

  // Archive-and-supersede is the ONLY way to abandon an operation: the
  // unresolved op is retained in the append-only on-device archive under its
  // ORIGINAL key (recoverable via its own “Check outcome” in the history
  // list below), then cleared so a genuinely new change may mint a fresh key.
  // There is no permanent-delete path, and a blocked archive keeps the op in
  // place instead of losing it. Offered as a two-step action. The archived
  // reason states what the operator ACTUALLY did (recorded outcome check for
  // this key, or explicitly none) — never an unconditional "outcome checked"
  // assertion — and keeps superseded-unresolved distinct from completed.
  const archivePending = () => {
    const controller = controllerRef.current
    const stored = controller?.getStored()
    if (!stored) return
    if (!discardArmed) {
      setDiscardArmed(true)
      return
    }
    const checked = statusCheckRef.current[stored.idempotencyKey]
    const stamp = new Date().toISOString()
    const truthfulReason = checked
      ? `operator archive-and-supersede from Property type section after recorded ${checked} at ${stamp}; unresolved operation retained in on-device history under its original key`
      : `operator archive-and-supersede from Property type section with no recorded outcome check at ${stamp}; unresolved operation retained in on-device history under its original key`
    try {
      controller.archiveAndSupersede(truthfulReason)
    } catch (error) {
      setFailure(storageFailureOf(error))
      return
    }
    syncFromController()
    clearTransitionForm()
    setDiscardArmed(false)
    setStatusReport(null)
    setNotice({ tone: 'info', message: `Operation ${shortOperationKey(stored.idempotencyKey)} archived on this device (kept in the history list below under its original key — select it there to check a late outcome) and superseded. A genuinely new change will mint a fresh operation key.` })
  }

  // Scoped archive/history recovery (F2): check ONE archived operation by its
  // ORIGINAL key through the shared controller. Read-only by construction —
  // the controller never submits on this path and never touches the current
  // stored op — and fenced here too: a scope switch or a different selection
  // mid-flight drops the result instead of showing it under the wrong entry.
  const checkArchivedEntry = async (entryKey) => {
    const controller = controllerRef.current
    if (!controller || !entryKey || archivedBusy) return
    const ticketScope = scopeRef.current.scopeKey
    const ticketEpoch = scopeEpochRef.current
    const ticketLookup = ++archivedLookupTicketRef.current
    const lookupIsCurrent = () => archivedLookupTicketRef.current === ticketLookup
      && scopeEpochRef.current === ticketEpoch
      && scopeRef.current.scopeKey === ticketScope
    setSelectedArchivedKey(entryKey)
    setArchivedBusy(true)
    setFailure(null)
    try {
      const res = await controller.checkArchivedOutcome(entryKey)
      if (!lookupIsCurrent()) return
      if (res?.stale) {
        setNotice({ tone: 'info', message: 'That archived lookup returned a mismatched receipt — nothing was displayed as its outcome and nothing was changed. The current operation above is untouched.' })
        return
      }
      setArchivedLookups((prev) => ({ ...prev, [entryKey]: res }))
      if (res && res.found === false) {
        setNotice({ tone: 'info', message: `No recorded server result yet for archived operation ${shortOperationKey(entryKey)} — an earlier request may still finish. The current operation above is untouched (nothing was resubmitted).` })
      }
    } catch (error) {
      if (!lookupIsCurrent()) return
      setFailure(storageFailureOf(error))
    } finally {
      if (lookupIsCurrent()) setArchivedBusy(false)
    }
  }

  // Status recovery through the shared controller: retires + archives only on
  // an authoritative completed outcome whose identity matches the current op
  // (lodge + key); anything else keeps the op for exact retry. A recovered
  // outcome reconciles canonical settings via the authoritative server read;
  // a refresh failure keeps the retired result visible with refresh-only
  // recovery and never resubmits.
  const checkOutcome = async () => {
    const controller = controllerRef.current
    const stored = controller?.getStored() || loadScopedTransitionOp(scopeKey)?.op || null
    if (!stored) {
      setFailure({ kind: 'unknown', message: 'No property-type operation has been started yet, so there is no outcome to check.', retryable: false })
      return
    }
    if (!controller?.getStored()) {
      // Re-adopt a record that exists in storage but not in the controller.
      try {
        controller.recover()
      } catch (error) {
        setFailure(storageFailureOf(error))
        return
      }
      syncFromController()
      setTarget(stored.targetType)
      setReason(stored.reason || '')
    }
    setFailure(null)
    setNotice(null)
    setRefreshWarning(null)
    if (!online) {
      setFailure(mapPropertyTransitionError({ code: 'property_transition_offline' }))
      return
    }
    if (!statusAvailable) {
      setFailure(mapPropertyTransitionError({ code: 'unavailable' }))
      return
    }
    setStatusBusy(true)
    try {
      const res = await controller.checkOutcome()
      if (res?.stale) {
        // A scope switch or supersede landed mid-flight: nothing changed.
        syncFromController()
        setNotice({ tone: 'info', message: 'This check belongs to a previous scope or a superseded operation — nothing was changed. The current operation is shown above.' })
        return
      }
      if (res && res.found === false) {
        // NOT_FOUND is not a green light for a different change: an earlier
        // request may still land. The ORIGINAL operation (same key) remains
        // safe to retry; the key must not be reused for anything else.
        statusCheckRef.current[stored.idempotencyKey] = 'outcome check: no recorded result (NOT_FOUND)'
        setStatusReport({ found: false, code: 'NOT_FOUND', message: '' })
        setNotice({ tone: 'info', message: `No recorded result for that key right now — an earlier request may still finish; retrying the ORIGINAL operation remains safe (same key), but do not start a different change with this key.` })
        return
      }
      const outcome = res?.result?.data || res?.result || {}
      if (!res?.retired) {
        statusCheckRef.current[stored.idempotencyKey] = 'outcome check: stored outcome not yet completed'
        setStatusReport({
          found: true,
          targetType: res?.result?.target_type || outcome.target_type || stored.targetType || '',
          previousType: res?.result?.previous_type || outcome.previous_type || '',
          changed: outcome.changed,
          at: res?.result?.created_at || ''
        })
        setNotice({ tone: 'info', message: 'The stored outcome is not a completed change yet. Keep this operation and check again before retrying.' })
        return
      }
      const archived = archiveFailedRef.current
      archiveFailedRef.current = false
      statusCheckRef.current[stored.idempotencyKey] = 'outcome check: authoritative outcome found'
      setStatusReport({
        found: true,
        targetType: res?.result?.target_type || outcome.target_type || stored.targetType || '',
        previousType: res?.result?.previous_type || outcome.previous_type || '',
        changed: outcome.changed,
        at: res?.result?.created_at || ''
      })
      syncFromController()
      clearTransitionForm()
      setDiscardArmed(false)
      setNotice({ tone: 'success', message: 'Found the authoritative stored outcome below. Refreshing settings and access to match it.' })
      if (archived) {
        setNotice({ tone: 'warning', message: 'Found the authoritative stored outcome below, but the on-device archive write failed — the outcome stays visible above and remains checkable by its key.' })
      }
      await settleRefreshPending(res?.refresh)
    } catch (error) {
      setFailure(storageFailureOf(error))
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mb-6" data-testid="property-type-section">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-1 flex items-center gap-2">
        <Building2 size={15} className="text-green-600" /> Property type
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Same-product reclassification inside LodgingOS only. Product identity (LodgingOS vs HotelOS vs POS) cannot be switched here.
      </p>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
        <p><span className="font-semibold">Current type:</span> {currentSupported ? getLodgingTypeOptions().find((option) => option.value === currentSupported)?.label : currentType}</p>
        <p className="mt-1 text-xs text-gray-500">
          Accommodation mix: {mixSummary}
          {currentWording ? ` · Inventory shows as “${currentWording.inventoryLabel}” · Exclusive use reads “${currentWording.exclusiveUseLabel}”.` : ''}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Bookings, ledgers, rates, invoices, stock, IDs and history are preserved — only wording, navigation and presentation defaults change.
        </p>
      </div>

      {!canManage && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You can view this section, but only a lodge manager with general-settings permission can preview or commit a property-type change.
        </div>
      )}
      {!online && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          You are offline. Property-type changes are online-only and are never queued — reconnect before previewing or committing.
        </div>
      )}
      {!contractAvailable && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The property-type transition service is unavailable in this build (missing desktop service). Advisory wording preview only — update the app before committing.
        </div>
      )}

      <div className="mt-4">
        <p className="block text-sm font-medium text-gray-700 mb-2">Change to (same LodgingOS product only)</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Target property type">
          {getLodgingTypeOptions().map((option) => {
            const isCurrent = option.value === currentSupported
            const selected = target === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canManage || commitBusy || pendingLock}
                onClick={() => { if (pendingLock) return; setTarget(option.value); setFailure(null); setNotice(null); }}
                className={`flex items-start gap-3 border-2 p-3 text-left transition-all rounded-xl ${selected ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-gray-300'} ${(!canManage || commitBusy) ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">
                    {option.label}
                    {isCurrent ? <span className="ml-2 text-[11px] font-semibold text-gray-500">(current)</span> : null}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{option.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {pendingLock && pendingOp ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="property-transition-pending">
          <p className="font-semibold">Pending operation {shortOperationKey(pendingOp.idempotencyKey)} for {pendingLabel} — target and reason are locked.</p>
          <p className="mt-1">Use “Check outcome” before retrying. To choose a different target or reason, first check the outcome, then archive the operation below (it stays in on-device history under its key — nothing is ever permanently deleted).</p>
          <button
            type="button"
            onClick={archivePending}
            disabled={!canManage || commitBusy || statusBusy}
            className="btn-secondary mt-2 text-xs"
            title="Checking the outcome first is recommended — a late request may still land on the server. The operation stays recoverable by its original key in the history list below."
          >
            {discardArmed ? 'Confirm archive and supersede (kept in history)' : 'Archive operation and start new'}
          </button>
        </div>
      ) : null}
      {storageBlocked ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="property-transition-storage-blocked">
          <p className="font-semibold">On-device recovery storage is blocked</p>
          <p className="mt-1">{storageBlocked.message || 'Local recovery storage is unavailable.'} Nothing was submitted.</p>
        </div>
      ) : null}
      {foreignKeys.length > 0 ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700" data-testid="property-transition-foreign">
          <p className="font-semibold">Another property or user has a pending property-type check on this device ({foreignKeys.length}).</p>
          <p className="mt-1">Switch back to that property/user to resolve it. Its details are hidden here and it will never be submitted, modified or deleted from this scope.</p>
        </div>
      ) : null}
      {archiveEntries.length > 0 ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3" data-testid="property-transition-archive-history">
          <p className="text-sm font-semibold text-gray-800">On-device history ({archiveEntries.length}) — this property and user only</p>
          <p className="mt-1 text-[11px] text-gray-500">Archived operations stay recoverable under their original keys. Checking an archived operation never resubmits it and never touches the current operation above. Switching property or user shows only that scope&apos;s history.</p>
          <ul className="mt-2 space-y-2">
            {archiveEntries.map((entry) => {
              const entryOp = entry && typeof entry === 'object' && entry.op && typeof entry.op === 'object' ? entry.op : {}
              const entryKey = entryOp.idempotencyKey || ''
              const terminal = describeArchivedTerminal(entry)
              const lookup = archivedLookups[entryKey]
              const selected = selectedArchivedKey === entryKey && lookup
              const lookupOutcome = lookup?.result?.data || lookup?.result || {}
              const badgeTone = terminal.kind === 'completed'
                ? 'bg-green-100 text-green-800'
                : terminal.kind === 'unresolved'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-gray-100 text-gray-600'
              return (
                <li key={entryKey} data-testid="property-transition-archive-item" data-key={entryKey} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">{transitionTargetLabel(entryOp.targetType)} </span>
                    <span className="text-gray-400">({shortOperationKey(entryKey)})</span>{' '}
                    <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeTone}`}>{terminal.label}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500 break-all">
                    Archived {entry?.terminal?.at || 'at an unknown time'}{entry?.terminal?.reason ? ` — ${entry.terminal.reason}` : ''}
                  </p>
                  {terminal.kind === 'unresolved' ? (
                    <button
                      type="button"
                      onClick={() => { void checkArchivedEntry(entryKey) }}
                      disabled={archivedBusy || statusBusy || commitBusy}
                      className="btn-secondary mt-2 text-xs"
                      data-testid="property-transition-archive-check"
                      title="Look up the authoritative stored outcome for this archived operation's ORIGINAL key. Never resubmits; never touches the current operation."
                    >
                      {archivedBusy && selectedArchivedKey === entryKey ? 'Checking…' : 'Check outcome (original key)'}
                    </button>
                  ) : null}
                  {selected && lookup ? (
                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900" data-testid="property-transition-archive-result">
                      {lookup.found === false ? (
                        <p>No recorded server result yet for {shortOperationKey(entryKey)} — an earlier request may still finish. Nothing was resubmitted.</p>
                      ) : (
                        <p>Server reports a recorded outcome for {shortOperationKey(entryKey)}: previous {lookupOutcome.previous_type || lookupOutcome.previousType || '—'} → target {lookupOutcome.target_type || lookup?.result?.target_type || entryOp.targetType || '—'} · {lookupOutcome.changed === false ? 'recorded no-op' : 'change recorded'}. The current operation above is untouched.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={!target || previewBusy || commitBusy || !canManage || !online || pendingLock}
          className="btn-secondary text-sm"
        >
          {previewBusy ? 'Previewing…' : 'Preview impact'}
        </button>
        {(operationKey || pendingOp) ? (
          <button
            type="button"
            onClick={checkOutcome}
            disabled={statusBusy || commitBusy}
            className="btn-secondary text-sm"
            title="Look up the authoritative stored outcome for the current operation key before retrying."
          >
            {statusBusy ? 'Checking…' : 'Check outcome'}
          </button>
        ) : null}
        {pendingOp ? (
          <button
            type="button"
            onClick={() => { void submitStoredOp(pendingOp) }}
            disabled={!canManage || !online || commitBusy || statusBusy}
            className="btn-secondary text-sm"
            title="Resubmit the ORIGINAL captured operation with the same key and identical payload."
          >
            {commitBusy ? 'Retrying…' : 'Retry original operation (same key)'}
          </button>
        ) : null}
      </div>
      {pendingOp ? (
        <p className="mt-2 text-[11px] text-gray-400 break-all">Operation key: {pendingOp.idempotencyKey} — reused for every retry and status check of this change. A new change mints a fresh key.</p>
      ) : operationKey ? (
        <p className="mt-2 text-[11px] text-gray-400 break-all">Operation key: {operationKey} — reused for every retry and status check of this change.</p>
      ) : null}

      {previewForTarget ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3">
          <p className="text-sm font-semibold text-gray-800">Impact preview — {targetOption?.label}</p>
          {!previewFresh ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              This preview is stale: settings changed underneath it. Reload settings, then preview again before committing.
            </p>
          ) : null}
          {previewForTarget.advisory ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
              {previewForTarget.diff.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <>
              {previewForTarget.data?.wording ? (
                <p className="mt-2 text-sm text-gray-700">
                  “{previewForTarget.data.wording.from_label}” → “{previewForTarget.data.wording.to_label}” · units “{previewForTarget.data.wording.unit_label_from}” → “{previewForTarget.data.wording.unit_label_to}” · exclusive use “{previewForTarget.data.wording.exclusive_use_from}” → “{previewForTarget.data.wording.exclusive_use_to}”.
                </p>
              ) : null}
              {previewForTarget.data?.accommodation_mix ? (
                <p className="mt-1 text-xs text-gray-500">
                  Live inventory: {previewForTarget.data.accommodation_mix.rooms} room-style + {previewForTarget.data.accommodation_mix.sites} site-style unit(s) — all preserved with IDs, bookings and rates unchanged.
                </p>
              ) : null}
              {previewNotes.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                  {previewNotes.map((note, index) => <li key={`${note?.code || 'note'}-${index}`}>{note?.message || note}</li>)}
                </ul>
              ) : null}
              {previewForTarget.data?.expected_match === false ? (
                <p className="mt-2 text-sm font-medium text-amber-800">Settings changed since this preview was requested. Reload settings, then preview again before committing.</p>
              ) : null}
            </>
          )}
          {previewBlockers.length > 0 ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm font-semibold text-red-800">Blocked — resolve before committing:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-700 space-y-1">
                {previewBlockers.map((blocker, index) => (
                  <li key={`${blocker?.code || 'blocker'}-${index}`}>
                    {blocker?.message || blocker}
                    {blocker?.repair ? ` Repair: ${blocker.repair}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 space-y-3 border-t border-blue-100 pt-3">
            <label className="block text-sm text-gray-700">
              <span className="font-medium">Reason for change (optional, kept in the audit record)</span>
              <input
                className="input mt-1"
                value={reason}
                onChange={(e) => { if (pendingLock) return; setReason(e.target.value) }}
                placeholder="e.g. Re-registered as a camp"
                maxLength={200}
                disabled={pendingLock}
                title={pendingLock ? 'Locked while a pending operation exists. Discard it explicitly to enter a different reason.' : undefined}
              />
              {pendingLock ? <span className="mt-1 block text-[11px] text-gray-500">Locked while the pending operation is unresolved.</span> : null}
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={ackPreserved}
                onChange={(e) => setAckPreserved(e.target.checked)}
              />
              <span>I understand bookings, ledgers, rates, invoices, stock and history are preserved, and only wording, navigation and presentation defaults change.</span>
            </label>
            <label className="block text-sm text-gray-700">
              <span className="font-medium">Type “{targetOption?.label}” to confirm this exact change</span>
              <input
                className="input mt-1"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={targetOption?.label || ''}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={runCommit}
              disabled={pendingOp ? (!retryReady || commitBusy) : (!confirmReady || commitBusy || previewBlockers.length > 0)}
              className="btn-primary text-sm"
              title={pendingOp ? 'Retry the ORIGINAL captured operation with the same key.' : (previewBlockers.length > 0 ? 'Resolve the listed blockers before committing.' : undefined)}
            >
              {commitBusy ? 'Committing…' : `Commit change to ${pendingOp ? pendingLabel : (targetOption?.label || '')}`}
            </button>
            {!online ? <p className="text-xs text-red-600">Online connection required to commit.</p> : null}
          </div>
        </div>
      ) : null}

      {statusReport?.found ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">Stored outcome for this operation key</p>
          <p className="mt-1">Previous: {statusReport.previousType || '—'} → Target: {statusReport.targetType || '—'} · {statusReport.changed === false ? 'recorded no-op' : 'change recorded'}{statusReport.at ? ` · ${statusReport.at}` : ''}.</p>
        </div>
      ) : null}
      {statusReport && !statusReport.found && statusReport.code === 'NOT_FOUND' ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700" data-testid="property-transition-not-found">
          <p className="font-semibold">No recorded result for that key right now</p>
          <p className="mt-1">An earlier request may still finish; retrying the ORIGINAL operation remains safe (same key), but do not start a different change with this key.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={checkOutcome} disabled={statusBusy || commitBusy} className="btn-secondary text-xs">
              {statusBusy ? 'Checking…' : 'Check outcome again'}
            </button>
            {pendingOp ? (
              <button type="button" onClick={() => { void submitStoredOp(pendingOp) }} disabled={!canManage || !online || commitBusy || statusBusy} className="btn-secondary text-xs">
                {commitBusy ? 'Retrying…' : 'Retry original operation (same key)'}
              </button>
            ) : null}
          </div>
        </div>
      ) : statusReport && !statusReport.found ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {statusReport.message}
        </div>
      ) : null}
      {notice ? (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${notice.tone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : notice.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
          {notice.message}
        </div>
      ) : null}
      {refreshWarning ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-testid="property-transition-refresh-warning">
          <p>{refreshWarning}</p>
          <button
            type="button"
            onClick={() => { void retryRefreshOnly() }}
            className="btn-secondary mt-2 text-xs"
            data-testid="property-transition-refresh-retry"
            title="Re-runs only the authoritative settings read. Never submits a new mutation."
          >
            Retry refresh only (no new submission)
          </button>
        </div>
      ) : null}
      {failure ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Property-type change {failure.kind === 'offline' ? 'needs a connection' : failure.kind === 'denied' ? 'not permitted' : failure.kind === 'stale' ? 'needs a fresh preview' : failure.kind === 'blocker' ? 'blocked' : 'could not complete'}</p>
          <p className="mt-1">{failure.message}</p>
          {(failure.kind === 'timeout' || failure.kind === 'unknown') && (pendingOp || operationKey) ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={checkOutcome} disabled={statusBusy || commitBusy} className="btn-secondary text-xs">
                {statusBusy ? 'Checking…' : 'Check outcome before retrying'}
              </button>
              {pendingOp ? (
                <button type="button" onClick={() => { void submitStoredOp(pendingOp) }} disabled={!canManage || !online || commitBusy || statusBusy} className="btn-secondary text-xs">
                  {commitBusy ? 'Retrying…' : 'Retry original operation (same key)'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}



export default function Settings() {
  const navigate = useNavigate()
  const UPDATE_SNOOZE_KEY = 'bb_update_snooze_until'
  const access = useAccess()
  const { settings: globalSettings, setSettings: setGlobalSettings } = useSettings()
  const propertyType = globalSettings?.property_type || globalSettings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const barOnlyMode = restaurantMode && isBarOnlyMode(globalSettings)
  const hotelMode = IS_HOTEL_PRODUCT
  const vocab = getUiVocabulary({ settings: globalSettings, propertyType, productId: BUILD_PRODUCT.id })
  const businessLabel = vocab.noun
  const businessLabelTitle = vocab.nounTitle
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || location.state?.activeTab || 'general')

  useEffect(() => {
    if (restaurantMode && activeTab === 'system') navigate('/hpos/system-health', { replace: true })
    if (activeTab === 'document-templates') {
      setActiveTab('general')
      setSearchParams({ tab: 'general' }, { replace: true })
    }
  }, [activeTab, navigate, restaurantMode, setSearchParams])

  // Keep System Health / tab deep-links working from HPOS More menu and banners.
  useEffect(() => {
    const nextTab = searchParams.get('tab') || location.state?.activeTab
    if (nextTab && nextTab !== activeTab) setActiveTab(nextTab)
  }, [searchParams, location.state?.activeTab])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [heroPreview, setHeroPreview] = useState(null)
  const [bookingFaqText, setBookingFaqText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const heroInputRef = useRef(null)
  const savedFormSnapshotRef = useRef(null)
  const savedEmailSnapshotRef = useRef(null)
  const formRef = useRef(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)
  const pendingNavRef = useRef(null)
  const navGuard = useContext(UnsavedChangesContext)

  // Theme mode
  const [themeMode, setThemeMode] = useState(() => getStoredThemeMode())
  const [darkModeActive, setDarkModeActive] = useState(() => resolveThemeMode(getStoredThemeMode()))

  // App updates
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(/** @type {'idle' | 'checking' | 'uptodate' | 'available' | 'error'} */ ('idle'))
  const [updateMessage, setUpdateMessage] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(/** @type {import('../types/desktop-api.js').DesktopUpdateProgressReadView | null} */ (null))
  const [updateReady, setUpdateReady] = useState(false)
  const [updateMeta, setUpdateMeta] = useState(/** @type {SettingsUpdateMetaReadView | null} */ (null))
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [updateSnoozedUntil, setUpdateSnoozedUntil] = useState('')
  const updateListenersAdded = useRef(false)
  const [emailConfig, setEmailConfig] = useState({
    provider: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    user: '',
    pass: '',
    from: '',
    reply_to: '',
    to: '',
    allow_insecure_tls: false,
    auto_send_quotations: true,
    auto_send_booking_invoice: true,
    auto_send_booking_confirmation: true,
    auto_send_booking_cancellation: true
  })
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailTesting, setEmailTesting] = useState(false)
  const [emailStatus, setEmailStatus] = useState(null)
  const [emailTouched, setEmailTouched] = useState(false)

  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const isFormDirty = useMemo(() => {
    if (!form || !savedFormSnapshotRef.current) return false
    return JSON.stringify(form) !== JSON.stringify(savedFormSnapshotRef.current)
  }, [form])

  const isEmailDirty = useMemo(() => {
    if (!savedEmailSnapshotRef.current) return false
    return JSON.stringify(emailConfig) !== JSON.stringify(savedEmailSnapshotRef.current)
  }, [emailConfig])

  const isDirty = isFormDirty || (emailTouched && isEmailDirty)
  const canManageGeneralSettings = canAccessCapability(access, 'settings.manage_general')

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (!navGuard) return
    navGuard.current = isDirty
      ? {
          isDirty: true,
          confirmLeave: (onProceed) => {
            pendingNavRef.current = onProceed
            setShowUnsavedModal(true)
          }
        }
      : { isDirty: false, confirmLeave: null }
    return () => {
      navGuard.current = { isDirty: false, confirmLeave: null }
    }
  }, [isDirty, navGuard])

  useEffect(() => {
    if (activeTab !== 'general') return
    window.api.updates.getVersion().then(setAppVersion).catch(() => {})
    try {
      const raw = window.localStorage.getItem(UPDATE_SNOOZE_KEY)
      const until = Number(raw)
      if (Number.isFinite(until) && until > Date.now()) {
        setUpdateSnoozedUntil(new Date(until).toLocaleString())
      } else {
        setUpdateSnoozedUntil('')
      }
    } catch {
      setUpdateSnoozedUntil('')
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general') return
    window.api.updates.getState()
      .then((info) => {
        if (!info) return
        if (['available', 'downloading', 'ready', 'error'].includes(info.phase)) {
          setUpdateMeta(info)
        }
        if (info.phase === 'downloading') {
          setUpdateStatus('available')
          setUpdateMessage(info.progress?.bytesPerSecond > 0 ? `Downloading at ${formatBytes(info.progress.bytesPerSecond)}/s` : 'Downloading update…')
          setDownloadProgress(info.progress || null)
        } else if (info.phase === 'ready') {
          setUpdateReady(true)
          setUpdateStatus('available')
          setUpdateMessage('Download complete. Restart to install.')
        } else if (info.phase === 'error') {
          setUpdateStatus('error')
          setUpdateMessage(info.error || 'Update failed.')
        }
      })
      .catch(() => {})
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general') return
    let active = true
    window.api.email.getConfig()
      .then((config) => {
        if (!active || !config) return
        const provider = inferEmailProvider(config.host)
        const preset = EMAIL_PROVIDER_PRESETS[provider] || EMAIL_PROVIDER_PRESETS.custom
        const initialConfig = {
          provider,
          host: config.host || preset.host,
          port: Number(config.port) || preset.port,
          user: config.user || '',
          pass: config.pass || '',
          from: config.from || '',
          reply_to: config.reply_to || '',
          to: config.to || '',
          allow_insecure_tls: config.allow_insecure_tls === true,
          auto_send_quotations: config.auto_send_quotations === true,
          auto_send_booking_invoice: config.auto_send_booking_invoice === true,
          auto_send_booking_confirmation: config.auto_send_booking_confirmation === true,
          auto_send_booking_cancellation: config.auto_send_booking_cancellation === true
        }
        setEmailConfig(initialConfig)
        if (!savedEmailSnapshotRef.current) {
          savedEmailSnapshotRef.current = JSON.parse(JSON.stringify(initialConfig))
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'general' || updateListenersAdded.current) return
    updateListenersAdded.current = true
    const cleanupAvailable = window.api.updates.onAvailable((info) => {
      setUpdateMeta(info)
      setUpdateStatus('available')
      setUpdateMessage(`v${info.version} is available to download.`)
      setDownloadProgress(null)
      setUpdateReady(false)
    })
    const cleanupNotAvailable = window.api.updates.onNotAvailable(() => {
      setUpdateMeta(null)
      setUpdateStatus('uptodate')
      setUpdateMessage('You\'re running the latest version.')
      setDownloadProgress(null)
      setUpdateReady(false)
    })
    const cleanupProgress = window.api.updates.onProgress((p) => {
      setUpdateStatus('available')
      setDownloadProgress(p)
      setUpdateMeta((current) => ({ ...(current || {}), progress: p }))
      setUpdateMessage(p.bytesPerSecond > 0 ? `Downloading at ${formatBytes(p.bytesPerSecond)}/s` : 'Preparing download...')
    })
    const cleanupReady = window.api.updates.onReady((info) => {
      setUpdateMeta(info)
      setUpdateReady(true)
      setUpdateStatus('available')
      setUpdateMessage('Download complete. Restart to install.')
    })
    const cleanupError = window.api.updates.onError((info) => {
      setUpdateStatus('error')
      setUpdateMessage(info?.message || 'Update failed.')
      setUpdateReady(false)
    })

    return () => {
      updateListenersAdded.current = false
      cleanupAvailable?.()
      cleanupNotAvailable?.()
      cleanupProgress?.()
      cleanupReady?.()
      cleanupError?.()
    }
  }, [activeTab])

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateMessage('')
    setDownloadProgress(null)
    setUpdateReady(false)
    try {
      const res = await window.api.updates.check()
      if (res.dev) {
        setUpdateStatus('uptodate')
        setUpdateMessage('Running in development mode — update checks disabled.')
      } else if (!res.success) {
        setUpdateStatus('error')
        setUpdateMessage(res.error || 'Could not reach update server.')
      } else if (res.updateAvailable) {
        setUpdateMeta({
          version: res.latestVersion,
          releaseName: res.releaseName || '',
          releaseDate: res.releaseDate || '',
          releaseNotes: normalizeReleaseNotes(res.releaseNotes)
        })
        setUpdateStatus('available')
        setUpdateMessage(`v${res.latestVersion} is available to download.`)
      } else {
        setUpdateMeta(null)
        setUpdateStatus('uptodate')
        setUpdateMessage('You\'re running the latest version.')
      }
    } catch (e) {
      setUpdateStatus('error')
      setUpdateMessage(e.message || 'Update check failed.')
    }
  }

  const downloadUpdate = async () => {
    setUpdateStatus('available')
    setUpdateMessage('Preparing download...')
    setDownloadProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
    setUpdateReady(false)
    try {
      const res = await window.api.updates.download()
      if (!res?.success) {
        setUpdateStatus('error')
        setUpdateMessage(res?.error || 'Could not start the update download.')
        setDownloadProgress(null)
      }
    } catch (error) {
      setUpdateStatus('error')
      setUpdateMessage(error?.message || 'Could not start the update download.')
      setDownloadProgress(null)
    }
  }

  const snoozeUpdate = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000
    try {
      window.localStorage.setItem(UPDATE_SNOOZE_KEY, String(until))
    } catch {}
    setUpdateSnoozedUntil(new Date(until).toLocaleString())
  }

  useEffect(() => {
    setDarkModeActive(applyThemeMode(themeMode))
    if (themeMode !== 'system') return undefined
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handleSystemTheme = () => setDarkModeActive(applyThemeMode('system'))
    media.addEventListener?.('change', handleSystemTheme)
    return () => media.removeEventListener?.('change', handleSystemTheme)
  }, [themeMode])

  const setTheme = (mode) => {
    setThemeMode(mode)
    setDarkModeActive(saveThemeMode(mode))
  }

  // License & Billing
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState(null) // { type: 'success'|'error', text }
  const [lodgeIdCopied, setLodgeIdCopied] = useState(false)
  const [slugCopied, setSlugCopied] = useState(false)

  // Auto-generate slug from lodge name (only when slug is blank)
  const toSlug = (name) =>
    (name || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
      .replace(/-+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50)

  const faqToText = (items) => {
    if (!Array.isArray(items) || items.length === 0) return ''
    return items
      .map((item) => `${item?.question || ''} | ${item?.answer || ''}`.trim())
      .filter((line) => line !== '|' && line !== '')
      .join('\n')
  }

  const textToFaq = (value) => {
    return String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [question, ...rest] = line.split('|')
        return {
          question: (question || '').trim(),
          answer: rest.join('|').trim()
        }
      })
      .filter((item) => item.question && item.answer)
  }

  const normalizedPlan = normalizePlanName(licenseStatus?.plan || licenseStatus?.subscription_plan)
  const onlinePlanOk = licenseStatus?.effective_features?.online_booking === true || normalizedPlan === 'Pro'
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeSending, setUpgradeSending] = useState(false)
  const [upgradeSent, setUpgradeSent] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [generalDataLoaded, setGeneralDataLoaded] = useState(false)
  const [licenseDataLoaded, setLicenseDataLoaded] = useState(false)

  const refreshLicenseStatus = (lodgeId, { forceFresh = false } = {}) => {
    if (lodgeId && window.api?.trial) {
      return window.api.trial.getStatus(lodgeId, { forceFresh: forceFresh === true }).then((status) => {
        setLicenseStatus(status)
        return status
      }).catch(() => null)
    }
    return Promise.resolve(null)
  }

  useEffect(() => {
    if (!globalSettings?.lodge_id || licenseDataLoaded) return
    refreshLicenseStatus(globalSettings?.lodge_id)
    setLicenseDataLoaded(true)
  }, [globalSettings?.lodge_id, licenseDataLoaded])

  useEffect(() => {
    if (activeTab !== 'license') return
    if (licenseStatus?.status === 'licensed' && globalSettings?.lodge_id && window.api?.trial?.getInvoices) {
      window.api.trial.getInvoices(globalSettings.lodge_id).then(setInvoices).catch(() => {})
    }
  }, [activeTab, licenseStatus?.status, globalSettings?.lodge_id])

  useEffect(() => {
    if (activeTab !== 'general' || generalDataLoaded) return
    setGeneralDataLoaded(true)
  }, [activeTab, generalDataLoaded])

  const handleActivate = async () => {
    setActivateMsg(null)
    setActivating(true)
    try {
      const lodgeId = globalSettings?.lodge_id
      const res = await window.api.trial.activateKey(lodgeId, licenseKey)
      if (res?.success) {
        setActivateMsg({ type: 'success', text: `License activated! Plan: ${res.plan || 'Starter'}` })
        setLicenseKey('')
        const nextStatus = await access?.refreshEntitlement?.({ forceFresh: true })
        if (nextStatus) setLicenseStatus(nextStatus)
        else await refreshLicenseStatus(lodgeId, { forceFresh: true })
      } else {
        setActivateMsg({ type: 'error', text: res?.error || 'Activation failed.' })
      }
    } catch (e) {
      setActivateMsg({ type: 'error', text: e.message || 'Activation failed.' })
    }
    setActivating(false)
  }

  const copyLodgeId = () => {
    navigator.clipboard.writeText(globalSettings?.lodge_id || '').then(() => {
      setLodgeIdCopied(true)
      setTimeout(() => setLodgeIdCopied(false), 2000)
    })
  }

  const handleUpgradeRequest = async () => {
    if (!upgradeMsg.trim()) return
    setUpgradeSending(true)
    try {
      await window.api.admin.createSupportTicket({
        lodge_id: globalSettings?.lodge_id || 'unknown',
        lodge_name: globalSettings?.lodge_name || form?.lodge_name || '',
        title: 'Upgrade Request',
        description: upgradeMsg.trim(),
        category: 'Upgrade Request',
        priority: 'High'
      })
      setUpgradeSent(true)
      setUpgradeMsg('')
      setTimeout(() => { setUpgradeSent(false); setUpgradeOpen(false) }, 3000)
    } catch {
      // silently fail — user can try again
    }
    setUpgradeSending(false)
  }

  useEffect(() => {
    if (globalSettings) {
      const s = normalizeSettingsForForm(globalSettings)
      // A global settings refresh can happen while this page is open. Never
      // replace a draft that the operator has already started editing.
      if (formRef.current && savedFormSnapshotRef.current && !settingsEqual(formRef.current, savedFormSnapshotRef.current)) {
        return
      }
      setForm(s)
      savedFormSnapshotRef.current = cloneSettings(s)
      setLogoPreview(s?.logo || null)
      setHeroPreview(s?.hero_image || null)
      setBookingFaqText(faqToText(s?.booking_faq))
      return
    }

    window.api.settings.get().then((sn) => {
      const s = normalizeSettingsForForm(sn)
      if (formRef.current && savedFormSnapshotRef.current && !settingsEqual(formRef.current, savedFormSnapshotRef.current)) {
        return
      }
      setForm(s)
      savedFormSnapshotRef.current = cloneSettings(s)
      setLogoPreview(s?.logo || null)
      setHeroPreview(s?.hero_image || null)
      setBookingFaqText(faqToText(s?.booking_faq))
    })
  }, [globalSettings])

  const normalizeSettingsForForm = (settings) => {
    if (!settings) return settings
    const normalized = {
      ...PUBLIC_OFFER_DEFAULTS,
      ...settings
    }
    if (!settings.slug && settings.lodge_name) {
      return { ...normalized, slug: settings.lodge_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
    }
    return normalized
  }

  const applySavedSettings = (settings) => {
    const savedSettings = normalizeSettingsForForm(settings)
    setGlobalSettings(savedSettings)
    setForm(JSON.parse(JSON.stringify(savedSettings)))
    savedFormSnapshotRef.current = JSON.parse(JSON.stringify(savedSettings))
    setLogoPreview(savedSettings?.logo || null)
    setHeroPreview(savedSettings?.hero_image || null)
    setBookingFaqText(faqToText(savedSettings?.booking_faq))
  }

  // After a property-type commit (or a recovered stored outcome), refresh the
  // canonical settings, entitlement/access snapshot and derived profile so no
  // surface keeps a stale classification. A failed refresh never implies the
  // database change failed — the outcome panel stays visible for recovery.
  const refreshAfterPropertyTransition = async () => {
    try {
      const fresh = await window.api.settings.get()
      if (fresh) applySavedSettings(fresh)
    } catch {
      // Keep the committed outcome visible; the operator can reload Settings.
    }
    try {
      await access?.refreshEntitlement?.({ forceFresh: true })
    } catch {
      // Entitlement refresh is best-effort here; access re-resolves on next load.
    }
  }

  const discardChanges = () => {
    const savedSettings = savedFormSnapshotRef.current
      ? JSON.parse(JSON.stringify(savedFormSnapshotRef.current))
      : null
    if (savedSettings) {
      setForm(savedSettings)
      setGlobalSettings(savedSettings)
      setLogoPreview(savedSettings?.logo || null)
      setHeroPreview(savedSettings?.hero_image || null)
      setBookingFaqText(faqToText(savedSettings?.booking_faq))
    }
    if (savedEmailSnapshotRef.current) {
      setEmailConfig(JSON.parse(JSON.stringify(savedEmailSnapshotRef.current)))
    }
    setEmailTouched(false)
    setSaveError('')
    setSaveNotice(null)
  }

  const set = (field, value) => {
    setSaveNotice(null)
    setSaveError('')
    setForm((f) => ({ ...f, [field]: value }))
  }

  const tillOperatorPolicy = getTillOperatorPolicy(form || globalSettings || {})
  const setTillOperatorPolicy = (field, value) => {
    setSaveNotice(null)
    setSaveError('')
    setForm((current) => ({
      ...current,
      operating_profile: {
        ...(current?.operating_profile || {}),
        till_operator_policy: {
          ...(current?.operating_profile?.till_operator_policy || {}),
          [field]: value
        }
      }
    }))
  }

  const toggleAssistant = () => {
    const nextEnabled = form?.assistant_enabled !== true
    set('assistant_enabled', nextEnabled)
  }

  // ── Logo handling ──────────────────────────────────────────────────────────

  const processImageFile = (file, onDone, { max = 400, minWidth = 1, minHeight = 1, label = 'Image' } = {}) => {
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        if (img.width < minWidth || img.height < minHeight) {
          window.alert(`${label} is too small. Minimum size is ${minWidth}x${minHeight}px. Your image is ${img.width}x${img.height}px.`)
          return
        }
        const canvas = document.createElement('canvas')
        const ratio = Math.min(max / img.width, max / img.height, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/png')
        onDone(base64)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e) => {
    processImageFile(e.target.files[0], (base64) => {
      setSaveNotice(null)
      setSaveError('')
      setLogoPreview(base64)
      setForm((f) => ({ ...f, logo: base64 }))
    }, { max: 400, minWidth: 128, minHeight: 128, label: 'Logo' })
  }

  const handleHeroFileChange = (e) => {
    processImageFile(e.target.files[0], (base64) => {
      setSaveNotice(null)
      setSaveError('')
      setHeroPreview(base64)
      setForm((f) => ({ ...f, hero_image: base64 }))
    }, { max: 1400, minWidth: 800, minHeight: 400, label: 'Hero image' })
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    processImageFile(e.dataTransfer.files[0], (base64) => {
      setSaveNotice(null)
      setSaveError('')
      setLogoPreview(base64)
      setForm((f) => ({ ...f, logo: base64 }))
    }, { max: 400, minWidth: 128, minHeight: 128, label: 'Logo' })
  }

  const removeLogo = () => {
    setSaveNotice(null)
    setSaveError('')
    setLogoPreview(null)
    setForm((f) => ({ ...f, logo: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeHeroImage = () => {
    setSaveNotice(null)
    setSaveError('')
    setHeroPreview(null)
    setForm((f) => ({ ...f, hero_image: '' }))
    if (heroInputRef.current) heroInputRef.current.value = ''
  }

  const validateSettingsForm = (draft) => {
    if (!draft?.lodge_name?.trim()) return `Enter your ${businessLabel.toLowerCase()} name before saving.`
    return ''
  }

  const buildSettingsSavePayload = (draft) => {
    const propertyType = normalizePropertyType(draft?.property_type || draft?.business_type || 'lodge')
    const existingProfile = draft?.operating_profile || globalSettings?.operating_profile || {}
    return {
      ...draft,
      property_type: propertyType,
      business_type: propertyTypeToBusinessType(propertyType),
      operating_profile: buildOperatingProfile(
        propertyType,
        draft?.subscription_plan || globalSettings?.subscription_plan || 'Starter',
        draft?.enterprise_addons || globalSettings?.enterprise_addons || [],
        {
          hospitalityMode: existingProfile.hospitality_mode || draft?.hospitality_mode || null,
          campsitesEnabled: existingProfile?.campsite_profile?.enabled === true,
          roomsOrUnits: existingProfile?.accommodation_mix?.rooms_or_units !== false,
          wholeProperty: existingProfile?.accommodation_mix?.whole_property_exclusive_use === true,
          tillOperatorPolicy: existingProfile?.till_operator_policy || {
            mode: TILL_OPERATOR_MODES.STRICT,
            inactivity_minutes: DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES
          }
        }
      )
    }
  }

  const preserveDraftChanges = (serverSettings, savedDraft, latestDraft) => {
    const merged = { ...serverSettings }
    Object.keys(latestDraft || {}).forEach((field) => {
      if (!settingsEqual(latestDraft[field], savedDraft?.[field])) merged[field] = latestDraft[field]
    })
    return merged
  }

  const getSaveNotice = (res, draftChangedDuringSave) => {
    const meta = res?.meta || {}
    const skippedColumns = Array.isArray(meta.skippedColumns) ? meta.skippedColumns : []
    const warnings = Array.isArray(meta.warnings) ? meta.warnings.filter(Boolean) : []
    if (meta.persistence === 'device_only' || meta.online === false) {
      return {
        tone: 'warning',
        message: 'Saved on this computer only. Reconnect to the internet and save again to sync these changes to the lodge.'
      }
    }
    if (skippedColumns.length > 0) {
      return {
        tone: 'warning',
        message: 'Saved online, but some optional settings are not available in the server schema. Ask an administrator to apply the current database migration, then save again.'
      }
    }
    if (warnings.length > 0) {
      return {
        tone: 'warning',
        message: `Settings saved online with a warning: ${warnings[0]}`
      }
    }
    if (draftChangedDuringSave) {
      return {
        tone: 'warning',
        message: 'The first changes were saved. You still have newer edits to save.'
      }
    }
    return { tone: 'success', message: 'Settings saved to this lodge.' }
  }

  const saveSettingsDraft = async () => {
    if (saving) return { success: false, error: 'A settings save is already in progress.' }
    if (!canManageGeneralSettings) {
      const error = 'You do not have permission to change general settings. Ask a lodge manager to save these changes.'
      setSaveNotice(null)
      setSaveError(error)
      return { success: false, error }
    }
    const validationError = validateSettingsForm(form)
    if (validationError) {
      setSaveNotice(null)
      setSaveError(validationError)
      return { success: false, error: validationError }
    }
    if (!isFormDirty) {
      const notice = { tone: 'info', message: 'There are no general settings changes to save.' }
      setSaveError('')
      setSaveNotice(notice)
      return { success: true, noop: true }
    }

    const draftAtSave = cloneSettings(form)
    const savePayload = buildSettingsSavePayload(draftAtSave)
    setSaving(true)
    setSaveNotice(null)
    setSaveError('')
    try {
      const res = await withSettingsSaveTimeout(
        window.api.settings.save(savePayload),
        SETTINGS_SAVE_TIMEOUT_MS
      )
      if (!res?.success) throw new Error(res?.error || 'Settings could not be saved right now.')

      const latestDraft = formRef.current
      const draftChangedDuringSave = !settingsEqual(latestDraft, draftAtSave)
      const serverSettings = normalizeSettingsForForm(res.data || savePayload)
      const meta = res?.meta || {}
      const skippedColumns = Array.isArray(meta.skippedColumns) ? meta.skippedColumns : []
      const retryablePending = meta.persistence === 'device_only' || meta.pending === true || skippedColumns.length > 0
      const previousServerSettings = cloneSettings(savedFormSnapshotRef.current || globalSettings || {})
      if (retryablePending) {
        // Offline and partial-schema saves must remain retryable. Keep the
        // server snapshot authoritative and leave the draft dirty so Save
        // remains available after reconnecting or applying the migration.
        const retrySnapshot = meta.persistence === 'device_only'
          ? previousServerSettings
          : { ...serverSettings, ...Object.fromEntries(skippedColumns.map((field) => [field, previousServerSettings?.[field]])) }
        const retryDraft = draftChangedDuringSave
          ? preserveDraftChanges(retrySnapshot, draftAtSave, latestDraft)
          : (latestDraft || draftAtSave)
        // Keep the locally saved draft effective for this session, while the
        // separate snapshot below preserves which values still need a server
        // retry.
        setGlobalSettings(retryDraft)
        setForm(retryDraft)
        savedFormSnapshotRef.current = cloneSettings(retrySnapshot)
        setLogoPreview(retryDraft?.logo || null)
        setHeroPreview(retryDraft?.hero_image || null)
        setBookingFaqText(faqToText(retryDraft?.booking_faq))
      } else if (!draftChangedDuringSave) {
        applySavedSettings(serverSettings)
      } else {
        // Reconcile the server result without clobbering edits made while the
        // request was in flight. The saved snapshot remains server-authoritative,
        // so the newer edits stay visibly dirty and must be saved separately.
        const savedSnapshot = cloneSettings(serverSettings)
        const mergedDraft = preserveDraftChanges(savedSnapshot, draftAtSave, latestDraft)
        setGlobalSettings(savedSnapshot)
        setForm(mergedDraft)
        savedFormSnapshotRef.current = savedSnapshot
        setLogoPreview(mergedDraft?.logo || null)
        setHeroPreview(mergedDraft?.hero_image || null)
        setBookingFaqText(faqToText(mergedDraft?.booking_faq))
      }
      setSaveNotice(getSaveNotice(res, draftChangedDuringSave))
      return { ...res, draftChangedDuringSave, retryablePending }
    } catch (err) {
      console.error(err)
      const message = err?.message || 'Settings could not be saved right now.'
      setSaveError(message)
      return { success: false, error: message }
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (e) => {
    e?.preventDefault?.()
    return saveSettingsDraft()
  }

  const setEmailField = (field, value) => {
    setEmailTouched(true)
    setEmailConfig((current) => ({ ...current, [field]: value }))
  }

  const applyEmailProvider = (provider) => {
    const preset = EMAIL_PROVIDER_PRESETS[provider] || EMAIL_PROVIDER_PRESETS.custom
    setEmailTouched(true)
    setEmailConfig((current) => ({
      ...current,
      provider,
      host: preset.host,
      port: preset.port,
      allow_insecure_tls: preset.allow_insecure_tls
    }))
    setEmailStatus(null)
  }

  const saveEmailSetup = async () => {
    setEmailSaving(true)
    setEmailStatus(null)
    try {
      const fromValue = emailConfig.from?.trim()
        || (form?.lodge_name?.trim() && emailConfig.user?.trim()
          ? `"${form.lodge_name.trim()}" <${emailConfig.user.trim()}>`
          : '')
      const result = await window.api.email.saveConfig({
        ...emailConfig,
        from: fromValue
      })
      if (result?.success) {
        setEmailStatus({ ok: true, msg: `Email setup saved. Automatic ${restaurantMode ? 'customer' : 'guest'} emails can now use these details.` })
        const nextConfig = { ...emailConfig, from: fromValue || emailConfig.from }
        setEmailConfig(nextConfig)
        savedEmailSnapshotRef.current = JSON.parse(JSON.stringify(nextConfig))
        setEmailTouched(false)
      } else {
        setEmailStatus({ ok: false, msg: result?.error || 'Could not save email setup right now.' })
      }
    } catch (error) {
      setEmailStatus({ ok: false, msg: error?.message || 'Could not save email setup right now.' })
    }
    setEmailSaving(false)
  }

  const testEmailSetup = async () => {
    setEmailTesting(true)
    setEmailStatus(null)
    try {
      const fromValue = emailConfig.from?.trim()
        || (form?.lodge_name?.trim() && emailConfig.user?.trim()
          ? `"${form.lodge_name.trim()}" <${emailConfig.user.trim()}>`
          : '')
      const result = await window.api.email.test({
        ...emailConfig,
        from: fromValue
      })
      if (result?.success) {
        setEmailStatus({ ok: true, msg: `Test email sent to ${emailConfig.to || 'your test inbox'}.` })
      } else {
        setEmailStatus({ ok: false, msg: result?.error || 'Test email failed.' })
      }
    } catch (error) {
      setEmailStatus({ ok: false, msg: error?.message || 'Test email failed.' })
    }
    setEmailTesting(false)
  }

  // Outlet setup hooks live ABOVE the `if (!form)` early return by design:
  // hooks must run unconditionally on every render. Declaring useState /
  // useEffect below that return changes the hook count once the form loads
  // and React throws "Rendered more hooks than during the previous render",
  // landing Settings on the recovery screen (crashed opening ?tab=outlets
  // from Cash & close). Do not move these back down.
  const [outletSetupOutlets, setOutletSetupOutlets] = useState([])
  const [outletSetupOutletId, setOutletSetupOutletId] = useState('')
  const [outletSetupChoice, setOutletSetupChoice] = useState('shared_drawer')
  const [outletSetupBusy, setOutletSetupBusy] = useState(false)
  const [outletSetupError, setOutletSetupError] = useState('')
  const [outletSetupNotice, setOutletSetupNotice] = useState('')
  const loadOutletSetup = async () => {
    try {
      const rows = await window.api?.outlets?.getAll?.()
      const all = Array.isArray(rows) ? rows : []
      setOutletSetupOutlets(all)
      setOutletSetupOutletId((current) => (current && all.some((row) => row.id === current) ? current : all[0]?.id || ''))
    } catch {
      setOutletSetupOutlets([])
    }
  }
  useEffect(() => { if (activeTab === 'outlets') loadOutletSetup() }, [activeTab])
  useEffect(() => {
    const found = outletSetupOutlets.find((row) => row.id === outletSetupOutletId)
    setOutletSetupChoice(found?.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank')
  }, [outletSetupOutlets, outletSetupOutletId])

  if (!form) return (
    <div className="p-6 flex items-center justify-center h-64 text-gray-400">
      Loading settings...
    </div>
  )

  // ── Helpers for License tab ────────────────────────────────────────────────

  const fmtDate = (d) => {
    if (!d) return '—'
    const date = new Date(d)
    if (isNaN(date.getTime())) return '—'
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const paymentBadge = (status) => {
    if (!status) return null
    const map = {
      active:    { bg: 'bg-green-100 text-green-700',  label: 'Active' },
      overdue:   { bg: 'bg-red-100 text-red-700',      label: 'Overdue' },
      free:      { bg: 'bg-gray-100 text-gray-600',    label: 'Free' },
      cancelled: { bg: 'bg-amber-100 text-amber-700',  label: 'Cancelled' },
    }
    const s = map[status] || { bg: 'bg-gray-100 text-gray-600', label: status }
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg}`}>{s.label}</span>
  }

  const tabs = [
    { id: 'general', label: 'General', icon: <SettingsIcon size={14} /> },
    { id: 'outlets', label: 'Outlets', icon: <Store size={14} /> },
    { id: 'license', label: 'Subscription & Access', icon: <CreditCard size={14} /> },
    { id: 'system', label: 'System Health', icon: <ShieldCheck size={14} /> },
  ]
  // Outlet setup (moved from Cash & close): outlet picker + cash counting
  // switch. Base feature, no multi-outlet add-on needed. The server still
  // enforces admin-only + zero open activity; this surface only asks the
  // question and reports the authoritative answer. (Hooks live above the
  // `if (!form)` early return; only plain consts remain here.)
  const outletSetupRole = String(access?.role || '').toLowerCase()
  const canSwitchOutletCashModel = ['admin', 'super_admin'].includes(outletSetupRole)
  const switchOutletCashModel = async () => {
    const outlet = outletSetupOutlets.find((row) => row.id === outletSetupOutletId)
    if (!outlet || outletSetupBusy) return
    const current = outlet.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank'
    const wanted = outletSetupChoice === 'shared_drawer' ? 'one shared drawer' : 'separate pouches'
    if (current === outletSetupChoice) {
      setOutletSetupNotice(`${outlet.name || 'This outlet'} already counts ${wanted}.`)
      return
    }
    if (!window.confirm(`Switch ${outlet.name || 'this outlet'} to ${wanted}? Switching needs zero open Till shifts, drawer periods and reviews in the outlet — close or review them first.`)) return
    setOutletSetupBusy(true)
    setOutletSetupError('')
    setOutletSetupNotice('')
    try {
      const result = await window.api?.pos?.setOutletCashModel?.(outlet.id, outletSetupChoice)
      if (!result?.success) throw new Error(result?.error || 'The cash counting model could not be changed.')
      setOutletSetupNotice(`${outlet.name || 'Outlet'} now counts ${wanted}. Open the drawer in Staff shift close before trading.`)
      await loadOutletSetup()
    } catch (switchError) {
      setOutletSetupError(switchError?.message || 'The cash counting model could not be changed.')
      // Resync the dropdown to the authoritative model: a refused switch must
      // never leave the control displaying the unapplied choice as truth.
      await loadOutletSetup()
    } finally {
      setOutletSetupBusy(false)
    }
  }

  const tabLoader = (
    <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
      Loading panel...
    </div>
  )

  return (
    <div className={restaurantMode ? 'hpos-settings-workspace' : 'p-6 max-w-7xl mx-auto'}>
      <div className={restaurantMode ? 'hpos-settings-hero' : 'mb-5 flex items-center justify-between gap-4'}>
        <div><p className={restaurantMode ? 'hpos-eyebrow' : 'hidden'}>{restaurantMode ? 'Business setup' : ''}</p><h1 className="text-2xl font-bold text-gray-800">{restaurantMode ? `${barOnlyMode ? 'Bar' : 'Restaurant'} settings` : 'Settings'}</h1>{restaurantMode&&<p>Identity, tax, contact details, access and device preferences for this POS.</p>}</div>
        {activeTab === 'general' && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !canManageGeneralSettings || !isFormDirty}
            className={restaurantMode ? 'hpos-primary-action' : 'btn-primary flex items-center gap-2'}
            title={!canManageGeneralSettings ? 'You need settings.manage_general permission to save.' : undefined}
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        )}
      </div>
      {activeTab === 'general' && (isDirty || saveNotice || saveError) && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
          saveError ? 'border-red-200 bg-red-50 text-red-700'
            : saveNotice?.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800'
              : saveNotice?.tone === 'info' ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {saveError || saveNotice?.message || 'You have unsaved changes. Save when you are ready.'}
        </div>
      )}

{/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className={restaurantMode ? 'hpos-settings-tabs' : 'flex gap-1 bg-gray-100 rounded-xl p-1 mb-6'}>
        {tabs.filter(tab => !restaurantMode || !['document-templates','system'].includes(tab.id)).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            data-testid={`settings-tab-${tab.id}`}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          GENERAL TAB
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'general' && (
        <>
          {!canManageGeneralSettings && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You can view these settings, but only a lodge manager with general-settings permission can change or save them.
            </div>
          )}

          {/* ── Assistant Visibility ────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Sparkles size={17} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Tsa Bonno Assistant</p>
                <p className="text-xs text-gray-400">
                  {IS_HOSPITALITY_POS_PRODUCT || restaurantMode
                    ? 'Show Assistant in the top bar and floating guide button (POS dock stays free for selling)'
                    : 'Show Assistant in the sidebar, header, and floating guide button'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAssistant}
              disabled={saving || !canManageGeneralSettings}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                form?.assistant_enabled === true ? 'bg-green-600' : 'bg-gray-200'
              }`}
              aria-pressed={form?.assistant_enabled === true}
              aria-label="Toggle Tsa Bonno Assistant"
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                  form?.assistant_enabled === true ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* ── Theme ───────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
                <Moon size={17} className="text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Appearance</p>
                <p className="text-xs text-gray-400">
                  {themeMode === 'system'
                    ? `Following this computer: ${darkModeActive ? 'dark' : 'light'}`
                    : 'Saved on this computer'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 rounded-xl border border-gray-200 bg-gray-100 p-1 text-xs font-semibold text-gray-500">
              {[
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: Monitor }
              ].map((option) => {
                const Icon = option.icon
                const active = themeMode === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    className={`inline-flex min-w-[88px] items-center justify-center gap-2 rounded-lg px-3 py-2 transition ${
                      active ? 'bg-white text-gray-800 shadow-sm' : 'hover:text-gray-700'
                    }`}
                    aria-pressed={active}
                  >
                    <Icon size={14} />
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {restaurantMode && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
                  <ShieldCheck size={17} className="text-amber-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800">Till operator verification</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    New companies use Strict mode. Shift mode is an explicit shared-terminal exception for a staffed bar Till;
                    the active operator remains recorded on every sale and cash-up.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="text-xs font-semibold text-gray-700">
                  Verification mode
                  <select
                    value={tillOperatorPolicy.mode}
                    onChange={(event) => setTillOperatorPolicy('mode', event.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800"
                  >
                    <option value={TILL_OPERATOR_MODES.STRICT}>Strict — PIN for every order (default)</option>
                    <option value={TILL_OPERATOR_MODES.SHIFT}>Shift — PIN once, then stay unlocked</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-gray-700">
                  Inactivity lock (minutes)
                  <input
                    type="number"
                    min="5"
                    max="240"
                    step="1"
                    value={tillOperatorPolicy.inactivityMinutes}
                    onChange={(event) => setTillOperatorPolicy('inactivity_minutes', normalizeTillOperatorInactivityMinutes(event.target.value))}
                    disabled={tillOperatorPolicy.mode !== TILL_OPERATOR_MODES.SHIFT}
                    className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Shift mode locks after inactivity, app restart, outlet change, shift close, or manual operator switch.
                Sensitive corrections still require manager approval.
              </p>
            </div>
          )}

          {/* ── App Updates ─────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                  <RefreshCw size={17} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">App Updates</p>
                  <p className="text-xs text-gray-400">
                    Current version: <span className="font-mono font-medium text-gray-600">v{appVersion || '…'}</span>
                  </p>
                  {updateMeta?.version && updateMeta.version !== appVersion && (
                    <p className="mt-1 text-xs text-blue-600">
                      Latest available: <span className="font-mono font-medium">v{updateMeta.version}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={checkForUpdates}
                  disabled={updateStatus === 'checking'}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  <RefreshCw size={13} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
                  {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
                </button>
                {updateMeta?.releaseNotes && (
                  <button
                    type="button"
                    onClick={() => setReleaseNotesOpen(true)}
                    className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-4 py-2 rounded-lg transition-colors hover:bg-slate-50"
                  >
                    <FileText size={13} />
                    View Details
                  </button>
                )}
              </div>
            </div>

            {updateMessage && (
              <div className={`flex items-start gap-2 mt-3 px-3 py-2 rounded-lg text-xs ${
                updateStatus === 'uptodate' ? 'bg-green-50 text-green-700' :
                updateStatus === 'available' ? 'bg-blue-50 text-blue-700' :
                'bg-red-50 text-red-700'
              }`}>
                {updateStatus === 'uptodate' && <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />}
                {updateStatus === 'available' && <RefreshCw size={13} className="flex-shrink-0 mt-0.5 animate-spin" />}
                {updateStatus === 'error'     && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                <span>{updateMessage}</span>
              </div>
            )}

            {updateMeta?.version && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{BUILD_PRODUCT.brandName} v{updateMeta.version}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[updateMeta.releaseName, formatReleaseDate(updateMeta.releaseDate)].filter(Boolean).join(' · ') || 'Latest desktop release'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!updateReady && updateMeta.version !== appVersion && (
                      <button
                        type="button"
                        onClick={downloadUpdate}
                        className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                      >
                        <Download size={13} />
                        Download Update
                      </button>
                    )}
                    {!updateReady && updateMeta.version !== appVersion && (
                      <button
                        type="button"
                        onClick={snoozeUpdate}
                        className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors hover:bg-slate-50"
                      >
                        Remind Tomorrow
                      </button>
                    )}
                    {updateReady && (
                      <button
                        type="button"
                        onClick={() => window.api.updates.install()}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                      >
                        <RotateCcw size={13} />
                        Restart to Install
                      </button>
                    )}
                  </div>
                </div>

                {extractReleaseHighlights(updateMeta.releaseNotes).length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">What this update is about</p>
                    <div className="grid gap-2">
                      {extractReleaseHighlights(updateMeta.releaseNotes).map((item) => (
                        <div key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {updateSnoozedUntil && !updateReady && updateMeta.version !== appVersion && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Update reminders are snoozed until {updateSnoozedUntil}.
                  </div>
                )}
              </div>
            )}

            {downloadProgress && (
              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
                <div className="flex items-center justify-between text-xs text-sky-800 mb-2">
                  <span className="font-semibold">Downloading update…</span>
                  <span className="tabular-nums">{downloadProgress.percent}%</span>
                </div>
                <div className="w-full bg-white rounded-full h-2.5 overflow-hidden shadow-inner">
                  <div
                    className="bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-sky-700">
                  <span>{formatBytes(downloadProgress.transferred)} of {downloadProgress.total ? formatBytes(downloadProgress.total) : 'calculating...'}</span>
                  <span>{downloadProgress.bytesPerSecond > 0 ? `${formatBytes(downloadProgress.bytesPerSecond)}/s` : 'starting...'}</span>
                </div>
              </div>
            )}

            {updateReady && (
              <button
                type="button"
                onClick={() => window.api.updates.install()}
                className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
              >
                Install &amp; Restart
              </button>
            )}
          </div>

          {/* ── About ─────────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center">
                <Info size={17} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">About</p>
                <p className="text-xs text-gray-400">{BUILD_PRODUCT.brandName}</p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
              <p className="text-xs text-slate-600">
                Developed by <span className="font-semibold text-slate-800">Botswapelo Studios Pty Ltd</span>
              </p>
              <p className="text-xs text-slate-500">
                © {new Date().getFullYear()} Botswapelo Studios Pty Ltd. All rights reserved.
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                This software is proprietary and protected by copyright law. Unauthorized reproduction,
                distribution, or modification is strictly prohibited.
              </p>
            </div>
          </div>

          {releaseNotesOpen && (
            <Modal title={`${BUILD_PRODUCT.brandName} v${updateMeta?.version || ''}`} onClose={() => setReleaseNotesOpen(false)} size="lg">
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">Release notes</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {[updateMeta?.releaseName, formatReleaseDate(updateMeta?.releaseDate)].filter(Boolean).join(' · ') || 'Latest desktop release'}
                  </p>
                </div>
                {toReleaseSections(updateMeta?.releaseNotes).length > 0 ? (
                  <div className="space-y-4">
                    {toReleaseSections(updateMeta?.releaseNotes).map((section) => (
                      <div key={section.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                        <div className="mt-3 space-y-2">
                          {section.items.map((item) => (
                            <p key={item} className="text-sm leading-6 text-slate-700">• {item}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                    {normalizeReleaseNotes(updateMeta?.releaseNotes) || 'No release notes were published for this update.'}
                  </pre>
                )}
              </div>
            </Modal>
          )}

          <form onSubmit={handleSave} className="space-y-6">
            <fieldset disabled={saving || !canManageGeneralSettings} className="contents">

            {/* ── Logo Upload ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Image size={15} className="text-green-600" /> {businessLabelTitle} Logo
              </h2>

              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  {logoPreview ? (
                    <div className="relative group">
                      <img
                        src={logoPreview}
                        alt={`${vocab.nounTitle} logo`}
                        className="w-28 h-28 object-contain border-2 border-gray-200 rounded-xl bg-gray-50 p-1"
                      />
                      <button
                        type="button"
                        onClick={removeLogo}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-28 h-28 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300">
                      <Image size={32} />
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                    }`}
                  >
                    <Upload size={20} className="mx-auto mb-2 text-gray-400" />
                    <p className="text-sm font-medium text-gray-600">Click or drag & drop your logo here</p>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG, SVG — max 5 MB. Will be resized to fit.</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  {logoPreview && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">✓ Logo uploaded — will appear on all receipts</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Business Identity ─────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Building2 size={15} className="text-green-600" /> Business Identity
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {vocab.nameLabel} *
                  </label>
                  <input
                    className="input"
                    value={form.lodge_name}
                    onChange={(e) => set('lodge_name', e.target.value)}
                    placeholder={
                      barOnlyMode ? 'e.g. Town Bar, Corner Pub'
                        : restaurantMode ? 'e.g. River Bistro'
                          : hotelMode ? 'e.g. Cresta Hotel'
                            : propertyType === 'camp' ? 'e.g. River Camp'
                              : propertyType === 'guest_house' ? 'e.g. Garden Guest House'
                                : propertyType === 'bnb' ? 'e.g. Willow B&B'
                                  : propertyType === 'motel' ? 'e.g. Highway Motel'
                                    : 'e.g. Sunset Lodge'
                    }
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">Shown as the main heading on receipts</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Registered Company Name</label>
                  <input
                    className="input"
                    value={form.company_name}
                    onChange={(e) => set('company_name', e.target.value)}
                    placeholder={
                      barOnlyMode ? 'e.g. Town Bar (Pty) Ltd'
                        : restaurantMode ? 'e.g. River Bistro (Pty) Ltd'
                          : hotelMode ? 'e.g. Cresta Hospitality (Pty) Ltd'
                            : `e.g. ${businessLabelTitle} Holdings (Pty) Ltd`
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product identity (locked)</label>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                    {IS_HOSPITALITY_POS_PRODUCT
                      ? 'Restaurant / Bar POS'
                      : IS_HOTEL_PRODUCT
                        ? 'Hotel'
                        : 'Tsa Bonno LodgingOS'}
                    <p className="mt-1 text-xs text-gray-500">
                      {PROPERTY_TYPE_LABELS[normalizePropertyType(form.property_type || form.business_type || propertyType)]
                        || (IS_HOSPITALITY_POS_PRODUCT ? 'Restaurant / POS' : IS_HOTEL_PRODUCT ? 'Hotel' : 'Lodge')}
                      {IS_HOSPITALITY_POS_PRODUCT ? (
                        <>
                          {' · '}
                          {getExplicitHospitalityMode(form?.operating_profile) === HOSPITALITY_MODES.BAR_ONLY
                            || getExplicitHospitalityMode(globalSettings?.operating_profile) === HOSPITALITY_MODES.BAR_ONLY
                            ? 'Bar Only'
                            : 'Restaurant + Bar'}
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Product identity is set at setup and cannot be switched in Settings.
                      LodgingOS, HotelOS, and Restaurant &amp; Bar POS are separate apps. Contact Tsa Bonno support if you need a different product.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
                    <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                      <option value="P">P — Botswana Pula</option>
                      <option value="R">R — South African Rand</option>
                      <option value="$">$ — US Dollar</option>
                      <option value="€">€ — Euro</option>
                      <option value="£">£ — British Pound</option>
                      <option value="N$">N$ — Namibian Dollar</option>
                      <option value="ZK">ZK — Zambian Kwacha</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        <Hash size={13} className="inline mr-1" />VAT / Tax
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-gray-500">{form.vat_enabled ? 'Enabled' : 'Disabled'}</span>
                        <div
                          onClick={() => set('vat_enabled', !form.vat_enabled)}
                          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.vat_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.vat_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </label>
                    </div>
                    {form.vat_enabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">VAT Rate (%)</label>
                          <input
                            type="number" min="0" max="100" step="0.1" className="input"
                            value={form.vat_rate || ''}
                            onChange={(e) => set('vat_rate', parseFloat(e.target.value) || 0)}
                            placeholder="e.g. 14"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">VAT Number</label>
                          <input className="input" value={form.vat_number || ''} onChange={(e) => set('vat_number', e.target.value)} placeholder="Optional" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Property type (LodgingOS same-product reclassification) ── */}
            {IS_LODGE_PRODUCT && !restaurantMode && (
              <PropertyTypeSection
                globalSettings={globalSettings}
                access={access}
                canManage={canManageGeneralSettings}
                onCommitted={refreshAfterPropertyTransition}
              />
            )}

            {/* ── Location ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <MapPin size={15} className="text-green-600" /> Location
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Physical Address</label>
                  <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street / Plot number" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City / Town</label>
                    <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Maun" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Contact ──────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Phone size={15} className="text-green-600" /> Contact Details
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Phone size={13} className="inline mr-1" /> Phone Number</label>
                  <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+267 000 0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Mail size={13} className="inline mr-1" /> Email Address</label>
                   <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder={vocab.emailPlaceholder} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><Globe size={13} className="inline mr-1" /> Website</label>
                   <input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder={vocab.websitePlaceholder} />
                </div>
              </div>
            </div>

            {/* ── Email Setup ─────────────────────────────────────────────── */ }
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                    <Mail size={15} className="text-green-600" /> Email Setup
                  </h2>
                  <p className="text-sm text-gray-500 mt-2">
                    {restaurantMode
                      ? `Connect your ${businessLabel} email here so the system can send customer-facing emails automatically.`
                      : hotelMode
                        ? 'Connect your hotel email here so the system can send guest-facing emails automatically.'
                        : 'Connect your lodge email here so the system can send guest-facing emails automatically.'}
                  </p>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {restaurantMode ? 'Customer email' : 'Guest email'}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5">
                <p className="text-sm font-medium text-amber-900">
                  {restaurantMode
                    ? `Set this up on the main ${barOnlyMode ? 'bar counter' : 'restaurant'} computer.`
                    : 'Set this up on the main front desk computer.'}
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  {restaurantMode
                    ? 'This computer can send quotations, account statements, and customer emails when those actions happen here.'
                    : 'This computer will send quotations, booking confirmations, cancellations, and booking invoices when those actions happen here.'}
                </p>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email provider</label>
                    <select
                      className="input"
                      value={emailConfig.provider}
                      onChange={(e) => applyEmailProvider(e.target.value)}
                    >
                      {Object.entries(EMAIL_PROVIDER_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key}>{preset.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">{EMAIL_PROVIDER_PRESETS[emailConfig.provider]?.hint}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SMTP host</label>
                      <input className="input" value={emailConfig.host} onChange={(e) => setEmailField('host', e.target.value)} placeholder="smtp.yourprovider.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                      <input className="input" type="number" value={emailConfig.port} onChange={(e) => setEmailField('port', Number(e.target.value) || '')} placeholder="587" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email / username</label>
                       <input className="input" type="email" value={emailConfig.user} onChange={(e) => setEmailField('user', e.target.value)} placeholder={barOnlyMode || restaurantMode ? vocab.emailPlaceholder.replace(/^info@/, 'orders@') : vocab.emailPlaceholder} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password / app password</label>
                      <input className="input" type="password" value={emailConfig.pass} onChange={(e) => setEmailField('pass', e.target.value)} placeholder="Mailbox password or app password" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From line</label>
                      <input className="input" value={emailConfig.from} onChange={(e) => setEmailField('from', e.target.value)} placeholder={`"${form?.lodge_name || vocab.nameFallback}" <${emailConfig.user || 'you@example.com'}>`} />
                      <p className="text-xs text-gray-400 mt-1">
                        Leave blank to use {vocab.yourNoun} name automatically.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reply-to address</label>
                       <input className="input" type="email" value={emailConfig.reply_to} onChange={(e) => setEmailField('reply_to', e.target.value)} placeholder={barOnlyMode || restaurantMode ? vocab.emailPlaceholder.replace(/^info@/, 'orders@') : vocab.emailPlaceholder} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Test inbox</label>
                     <input className="input" type="email" value={emailConfig.to} onChange={(e) => setEmailField('to', e.target.value)} placeholder={vocab.emailPlaceholder.replace(/^[^@]+@/, 'manager@')} />
                    <p className="text-xs text-gray-400 mt-1">We use this address for the test email and any local email checks from this computer.</p>
                  </div>

                  <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={emailConfig.allow_insecure_tls}
                      onChange={(e) => setEmailField('allow_insecure_tls', e.target.checked)}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Allow insecure TLS only if your provider asks for it</p>
                      <p className="text-xs text-gray-400">
                        Most {vocab.nounPlural} should leave this off.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles size={15} className="text-violet-600" />
                      <p className="text-sm font-semibold text-gray-800">Automatic {restaurantMode ? 'customer' : 'guest'} emails</p>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-start gap-3">
                        <input type="checkbox" checked={emailConfig.auto_send_quotations} onChange={(e) => setEmailField('auto_send_quotations', e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-gray-700">Send quotation email when a quotation is marked as sent</p>
                          <p className="text-xs text-gray-400">Useful when front desk sends a quote after checking dates and rates.</p>
                        </div>
                      </label>
                      {!restaurantMode && (
                        <>
                          <label className="flex items-start gap-3">
                            <input type="checkbox" checked={emailConfig.auto_send_booking_confirmation} onChange={(e) => setEmailField('auto_send_booking_confirmation', e.target.checked)} />
                            <div>
                              <p className="text-sm font-medium text-gray-700">Send booking confirmation when front desk confirms a booking</p>
                              <p className="text-xs text-gray-400">Guests get a clear stay summary and balance information.</p>
                            </div>
                          </label>
                          <label className="flex items-start gap-3">
                            <input type="checkbox" checked={emailConfig.auto_send_booking_invoice} onChange={(e) => setEmailField('auto_send_booking_invoice', e.target.checked)} />
                            <div>
                              <p className="text-sm font-medium text-gray-700">Send booking invoice with the confirmation</p>
                              <p className="text-xs text-gray-400">This sends the guest-facing invoice as soon as the booking is confirmed.</p>
                            </div>
                          </label>
                          <label className="flex items-start gap-3">
                            <input type="checkbox" checked={emailConfig.auto_send_booking_cancellation} onChange={(e) => setEmailField('auto_send_booking_cancellation', e.target.checked)} />
                            <div>
                              <p className="text-sm font-medium text-gray-700">Send cancellation confirmation when front desk cancels a booking</p>
                              <p className="text-xs text-gray-400">Useful when a guest asks for written confirmation that the booking was cancelled.</p>
                            </div>
                          </label>
                        </>
                      )}
                    </div>
                  </div>

                  {!restaurantMode && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-semibold text-blue-900 mb-2">What guests will receive</p>
                    <ul className="space-y-2 text-xs text-blue-900/90">
                      <li>Quotation emails show the quoted room, dates, total, and validity date.</li>
                      <li>Booking confirmations show the stay summary, amount paid, and balance due.</li>
                      <li>Cancellation emails confirm the stay was cancelled and tell the guest to contact {vocab.theNoun} if needed.</li>
                      <li>Booking invoices are sent as a separate guest invoice email when enabled.</li>
                    </ul>
                  </div>
                  )}

                  {emailStatus && (
                    <div className={`rounded-xl px-4 py-3 text-sm ${emailStatus.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {emailStatus.msg}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={saveEmailSetup} disabled={emailSaving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                      <Save size={15} />
                      {emailSaving ? 'Saving...' : 'Save Email Setup'}
                    </button>
                    <button type="button" onClick={testEmailSetup} disabled={emailTesting} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                      <Send size={15} />
                      {emailTesting ? 'Sending...' : 'Send Test Email'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Online Booking Site ──────────────────────────────────────── */}
            {!restaurantMode && (
            <div className="border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-gray-500" />
                <h3 className="font-semibold text-gray-800 text-sm">Online Booking Site</h3>
                <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Pro</span>
              </div>

              {!onlinePlanOk ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-500">
                  Upgrade to <strong>Pro</strong> to unlock a branded booking page for {vocab.thisNoun}, a unique public URL, direct guest enquiries, WhatsApp contact, policies, room amenities, and a stronger direct-booking sales flow.
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    This Pro feature gives {vocab.yourNoun} its own public booking page. Guests can browse rooms, view amenities and policies, contact you directly, and send booking requests from your unique link.
                    Set a short, memorable URL slug below.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Your booking URL slug
                    </label>
                    <div className="flex gap-2">
                      <span className="flex items-center px-3 bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg text-xs text-gray-400 whitespace-nowrap">
                        {BOOKING_SITE_BASE.replace('https://', '')}/
                      </span>
                      <input
                        type="text"
                        value={form?.slug || ''}
                        onChange={e => {
                          const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50)
                          set('slug', raw)
                        }}
                        onFocus={() => {
                          // Auto-populate from lodge name if still empty
                          if (!form?.slug && form?.lodge_name) {
                            set('slug', toSlug(form.lodge_name))
                          }
                        }}
                        placeholder={form?.lodge_name ? toSlug(form.lodge_name) : `your-${String(vocab.noun).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'property'}-name`}
                        className="input flex-1 rounded-l-none border-l-0"
                        spellCheck={false}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Lowercase letters, numbers, and hyphens only. Must be unique.
                    </p>
                  </div>

                  {form?.slug && (
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-500 flex-1 truncate font-mono">
                        {BOOKING_SITE_BASE.replace('https://', '')}/{form.slug}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(`${BOOKING_SITE_BASE}/${form.slug}`)
                          setSlugCopied(true)
                          setTimeout(() => setSlugCopied(false), 2000)
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 shrink-0"
                      >
                        <Copy size={12} />
                        {slugCopied ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Save your settings to publish the page. Booking requests from this public {vocab.noun} URL will appear as <strong>Pending</strong> in your Bookings screen for you to confirm or reject.
                  </p>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">What guests can request online</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ['public_offer_rooms', 'Room stays', 'Guests can request one room.'],
                        ['public_offer_multi_room', 'Multiple rooms', 'Families and companies can request several rooms together.'],
                        ['public_offer_full_lodge', vocab.fullPropertyLabel, `Guests can request exclusive ${vocab.noun} use.`],
                        ['public_offer_day_use', 'Day use', 'Show configured pool, braai, and facility packages.'],
                        ['public_offer_events', 'Events & venues', 'Show venue and event request options.']
                      ].map(([key, label, hint]) => (
                        <label key={key} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={PUBLIC_OFFER_DEFAULT_TRUE.has(key) ? form?.[key] !== false : form?.[key] === true}
                            onChange={(e) => set(key, e.target.checked)}
                          />
                          <span>
                            <span className="block font-semibold text-gray-800">{label}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500">{hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 border-t border-gray-200 pt-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Booking tagline</label>
                        <input
                          className="input"
                          value={form?.booking_tagline || ''}
                          onChange={(e) => set('booking_tagline', e.target.value)}
                          placeholder="e.g. Riverside calm, booked directly"
                        />
                        <p className="text-xs text-gray-400 mt-1">Short headline shown near the top of the booking page.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Property description</label>
                        <textarea
                          className="input resize-none"
                          rows={5}
                          value={form?.booking_description || ''}
                          onChange={(e) => set('booking_description', e.target.value)}
                          placeholder={hotelMode
                            ? 'Describe what makes your hotel special, who it suits best, and what guests can expect on arrival.'
                            : 'Describe what makes your lodge special, who it suits best, and what guests can expect on arrival.'}
                        />
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <MessageCircle size={14} className="text-green-600" />
                          <label className="block text-xs font-medium text-gray-600">WhatsApp number</label>
                        </div>
                        <input
                          className="input"
                          value={form?.whatsapp_number || ''}
                          onChange={(e) => set('whatsapp_number', e.target.value)}
                          placeholder="e.g. 26771234567"
                        />
                        <p className="text-xs text-gray-400 mt-1">Use country code and digits only if possible, for example 26771234567.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-xs font-medium text-gray-600">Hero image</label>
                          {heroPreview && (
                            <button type="button" onClick={removeHeroImage} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                              <X size={12} /> Remove
                            </button>
                          )}
                        </div>
                        {heroPreview ? (
                          <img src={heroPreview} alt="Hero preview" className="h-36 w-full rounded-xl border border-gray-200 object-cover" />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400">
                            Upload a wide welcome image for your booking page
                          </div>
                        )}
                        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 hover:border-green-400 hover:bg-green-50/50">
                          <Image size={15} />
                          {heroPreview ? 'Replace hero image' : 'Upload hero image'}
                          <input
                            ref={heroInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleHeroFileChange}
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Check-in from</label>
                          <input
                            className="input"
                            value={form?.booking_check_in_from || ''}
                            onChange={(e) => set('booking_check_in_from', e.target.value)}
                            placeholder="e.g. 14:00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Check-out until</label>
                          <input
                            className="input"
                            value={form?.booking_check_out_until || ''}
                            onChange={(e) => set('booking_check_out_until', e.target.value)}
                            placeholder="e.g. 10:00"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 border-t border-gray-200 pt-4 lg:grid-cols-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <FileText size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">Cancellation policy</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_cancellation_policy || ''}
                        onChange={(e) => set('booking_cancellation_policy', e.target.value)}
                        placeholder="e.g. Free cancellation up to 48 hours before arrival."
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CreditCard size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">Payment terms</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_payment_terms || ''}
                        onChange={(e) => set('booking_payment_terms', e.target.value)}
                        placeholder="e.g. Deposit required to confirm. Balance due on arrival."
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Info size={14} className="text-green-600" />
                        <label className="block text-xs font-medium text-gray-600">House rules / guest notes</label>
                      </div>
                      <textarea
                        className="input resize-none"
                        rows={5}
                        value={form?.booking_house_rules || ''}
                        onChange={(e) => set('booking_house_rules', e.target.value)}
                        placeholder="e.g. No smoking indoors. Quiet hours from 22:00."
                      />
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Frequently asked questions</label>
                    <textarea
                      className="input resize-none"
                      rows={5}
                      value={bookingFaqText}
                      onChange={(e) => {
                        setBookingFaqText(e.target.value)
                        set('booking_faq', textToFaq(e.target.value))
                      }}
                      placeholder={'Use one line per FAQ.\nExample: Is breakfast included? | Yes, breakfast is served from 06:30 to 09:30.'}
                    />
                    <p className="text-xs text-gray-400 mt-1">Format each line as: question | answer</p>
                  </div>
                </>
              )}
            </div>
            )}

            {/* ── Save ─────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-4 pb-6">
              <button
                type="submit"
                disabled={saving || !canManageGeneralSettings || !isFormDirty}
                title={!canManageGeneralSettings ? 'You need settings.manage_general permission to save.' : undefined}
                className="btn-primary flex items-center gap-2"
              >
                <Save size={15} />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={discardChanges}
                  className="btn-secondary flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  Discard Changes
                </button>
              )}
              {saveNotice && (
                <span className={`text-sm font-medium flex items-center gap-1 ${saveNotice.tone === 'warning' ? 'text-amber-700' : saveNotice.tone === 'info' ? 'text-blue-700' : 'text-green-600'}`}>
                  {saveNotice.tone === 'warning' ? <AlertTriangle size={15} /> : '✓'} {saveNotice.message}
                </span>
              )}
              {saveError && (
                <ErrorNotice className="text-sm text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle size={15} /> {saveError}
                </ErrorNotice>
              )}
            </div>
            </fieldset>
          </form>
        </>
      )}

      {/* ── Unsaved Changes Modal ────────────────────────────────────────── */}
      {showUnsavedModal && (
        <Modal title="Unsaved Changes" onClose={() => setShowUnsavedModal(false)} size="sm">
          <p className="text-sm text-slate-600 mb-5">
            You have unsaved changes. Would you like to save them before leaving?
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowUnsavedModal(false)}
              disabled={modalSaving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                discardChanges()
                setShowUnsavedModal(false)
                pendingNavRef.current?.()
              }}
              disabled={modalSaving}
              className="btn-secondary"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                setModalSaving(true)
                if (!isFormDirty && isEmailDirty) {
                  setSaveNotice({
                    tone: 'warning',
                    message: 'Email setup has unsaved changes. Use Save Email Setup first, then choose Save & Leave.'
                  })
                  setSaveError('')
                  setModalSaving(false)
                  return
                }
                const res = await saveSettingsDraft()
                setModalSaving(false)
                if (res?.success && !res?.draftChangedDuringSave && !res?.retryablePending) {
                  if (isEmailDirty) {
                    setSaveNotice({
                      tone: 'warning',
                      message: 'General settings were saved. Use Save Email Setup before leaving so your email changes are not lost.'
                    })
                    return
                  }
                  setShowUnsavedModal(false)
                  pendingNavRef.current?.()
                }
              }}
              disabled={modalSaving || saving || !canManageGeneralSettings}
              className="btn-primary flex items-center gap-2"
            >
              {modalSaving ? (
                <><RefreshCw size={14} className="animate-spin" /> Saving&hellip;</>
              ) : (
                <><Save size={14} /> Save &amp; Leave</>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          OUTLETS TAB (moved from Cash & close)
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'outlets' && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <div className="mb-4"><p className="hpos-eyebrow">Outlet setup</p><h2 className="text-xl font-bold text-gray-800">How this outlet counts cash</h2><p className="text-sm text-gray-500">One shared drawer counts once per period; separate pouches keep a personal cash-up per seller. Switching needs an admin and zero open Till shifts, drawer periods or reviews.</p></div>
          {outletSetupError && <ErrorNotice>{outletSetupError}</ErrorNotice>}
          {outletSetupNotice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{outletSetupNotice}</div>}
          {outletSetupOutlets.length === 0 ? (
            <p className="text-sm text-gray-500">No outlets found. Create one in Outlet control first.</p>
          ) : (
            <>
              <label className="hpos-outlet-editor__field">Outlet<select value={outletSetupOutletId} onChange={(event) => setOutletSetupOutletId(event.target.value)} disabled={outletSetupBusy}>{outletSetupOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
              {canSwitchOutletCashModel ? (
                <>
                  <label className="hpos-outlet-editor__field">Cash counting<select value={outletSetupChoice} onChange={(event) => setOutletSetupChoice(event.target.value)} disabled={outletSetupBusy}><option value="shared_drawer">One shared drawer</option><option value="personal_bank">Separate pouches</option></select></label>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={switchOutletCashModel} disabled={outletSetupBusy} className="hpos-primary-action">{outletSetupBusy ? 'Switching…' : 'Switch cash counting'}</button>
                    <button type="button" onClick={() => { window.location.hash = '/restaurant/outlet-control' }} className="bb-btn-outline">Open full Outlet control</button>
                  </div>
                </>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Currently counting {(() => { const found = outletSetupOutlets.find((row) => row.id === outletSetupOutletId); return found?.cash_model === 'shared_drawer' ? 'one shared drawer' : 'separate pouches'; })()}. Only an admin can switch it — ask an admin to open this page.</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          LICENSE & BILLING TAB
          ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'license' && (
        <div className="space-y-4">
          <Suspense fallback={tabLoader}>
            <SubscriptionAccessPanel />
          </Suspense>
        </div>
      )}

      {activeTab === 'system' && (
        <Suspense fallback={tabLoader}>
          <SystemHealthPanel />
        </Suspense>
      )}
    </div>
  )
}
