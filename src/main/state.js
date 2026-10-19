// @ts-check

// Runtime state is shared by the main-process domain modules. Keep this
// declaration aligned with the fields initialized here and the existing
// infrastructure/session producers; values from cache and session boundaries
// stay unknown until their consumers validate them.
/**
 * @typedef {Record<string, unknown> & {
 *   id: unknown,
 *   email: unknown,
 *   name: unknown,
 *   role: unknown,
 *   lodge_id: unknown,
 *   status: unknown,
 *   capability_overrides: Record<string, unknown>,
 *   isMasterAdmin?: unknown,
 *   allowed_outlet_ids?: unknown
 * }} MainStateUser
 */
/**
 * @typedef {object} MainState
 * @property {import('@supabase/supabase-js').SupabaseClient | undefined} supabase
 * @property {import('@supabase/supabase-js').SupabaseClient | null | undefined} adminDb
 * @property {boolean} isOnline
 * @property {string | undefined} cacheRootDir
 * @property {string | undefined} profilesCacheDir
 * @property {string | undefined} cacheDir
 * @property {MainStateUser | null} currentUser
 * @property {boolean} backupIntervalStarted
 * @property {string | null} lodgeId
 * @property {boolean} syncInProgress
 * @property {Promise<unknown> | null} syncQueuePromise
 * @property {boolean} replayAuthReady
 * @property {{ token?: unknown, expires_at?: unknown, session_type?: unknown } | null} backendSession
 * @property {number} consecutiveConnectivityFailures
 * @property {boolean} connectivityCheckInProgress
 * @property {{ stale: boolean, names: string[], attempts: number, lastError: string, lastFailedAt: string | number | null }} syncRefreshState
 * @property {string | null} lastSuccessfulSyncAt
 * @property {ReturnType<typeof setTimeout> | null} syncRefreshRetryTimer
 * @property {string | null} lastUsageSyncAt
 * @property {boolean} _initialized
 * @property {string} [deviceId]
 * @property {{ id?: unknown, name?: unknown, email?: unknown } | null} [user]
 * @property {(type: string, table: string, data: unknown, id?: unknown, meta?: Record<string, unknown>) => unknown} [queueOperation]
 * @property {string} [reviewBookingId]
 * @property {string} [collectPaymentBookingId]
 */
/** @type {MainState} */
export const state = {
  supabase: undefined,
  adminDb: undefined,
  isOnline: false,
  cacheRootDir: undefined,
  profilesCacheDir: undefined,
  cacheDir: undefined,
  currentUser: null,
  backupIntervalStarted: false,
  lodgeId: null,
  syncInProgress: false,
  syncQueuePromise: null,
  replayAuthReady: false,
  backendSession: null,
  consecutiveConnectivityFailures: 0,
  connectivityCheckInProgress: false,
  syncRefreshState: {
    stale: false,
    names: [],
    attempts: 0,
    lastError: '',
    lastFailedAt: null
  },
  lastSuccessfulSyncAt: null,
  syncRefreshRetryTimer: null,
  lastUsageSyncAt: null,
  _initialized: false
}

export function resetState() {
  if (state.syncRefreshRetryTimer) {
    clearTimeout(state.syncRefreshRetryTimer)
  }

  state.supabase = undefined
  state.adminDb = undefined
  state.isOnline = false
  state.cacheRootDir = undefined
  state.profilesCacheDir = undefined
  state.cacheDir = undefined
  state.currentUser = null
  state.backupIntervalStarted = false
  state.lodgeId = null
  state.syncInProgress = false
  state.syncQueuePromise = null
  state.replayAuthReady = false
  state.backendSession = null
  state.consecutiveConnectivityFailures = 0
  state.connectivityCheckInProgress = false
  state.syncRefreshState = {
    stale: false,
    names: [],
    attempts: 0,
    lastError: '',
    lastFailedAt: null
  }
  state.lastSuccessfulSyncAt = null
  state.syncRefreshRetryTimer = null
  state.lastUsageSyncAt = null
  state._initialized = false
}
