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
