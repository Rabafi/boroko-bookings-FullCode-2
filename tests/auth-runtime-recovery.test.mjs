import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('src/main/domains/authSession.js', 'utf8')
const appSource = fs.readFileSync('src/renderer/src/App.jsx', 'utf8')
const mainSource = fs.readFileSync('src/main/index.js', 'utf8')
const start = source.indexOf('async function validateCurrentSessionImpl()')
const end = source.indexOf('\nlet authValidationPromise', start)
assert.ok(start >= 0 && end > start, 'validator implementation source must be present')
const validatorSource = source.slice(start, end)

function fixture({ token = 'token-1', rpc = async () => ({ data: [], error: null }), nonce = null, checkOnline = async () => true } = {}) {
  const state = {
    currentUser: { id: 'actor-1', lodge_id: 'lodge-1', role: 'manager' },
    lodgeId: 'lodge-1', isOnline: true, replayAuthReady: true,
    authSessionGeneration: 4, authSessionGenerationToken: token,
    backendSession: token ? { token, session_type: 'desktop', expires_at: '2099-01-01T00:00:00Z' } : null,
    supabase: { rpc }
  }
  const publishAuthRuntimeStatus = (status, reason) => {
    state.authRuntimeStatus = { status, reason }
  }
  const deps = {
    state, publishAuthRuntimeStatus,
    getBackendSession: () => state.backendSession,
    assertCachedSettingsMatchCurrentProduct: () => true,
    clearSessionForProductMismatch: () => {},
    readSessionNonce: () => nonce,
    normalizeLodgeId: (value) => String(value || '').toLowerCase(),
    applyBackendSession: (session) => { state.backendSession = session },
    clearBackendSession: () => { state.backendSession = null },
    clearSessionNonce: () => {},
    checkOnline,
    normalizeSessionUser: (user) => user,
    setCurrentUser: (user) => { state.currentUser = user },
    upsertCachedUser: () => {},
    touchUserPresence: async () => {},
    writeSessionNonce: () => true,
    authTrace: () => {},
    setTimeout: () => 0
  }
  const validate = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps;\n${validatorSource}\nreturn validateCurrentSessionImpl;`)(deps)
  return { state, validate }
}

test('missing online token clears display authority and stops replay', async () => {
  const { state, validate } = fixture({ token: null })
  assert.equal(await validate(), null)
  assert.equal(state.currentUser, null)
  assert.equal(state.replayAuthReady, false)
  assert.equal(state.authRuntimeStatus.status, 'sign_in_required')
})

test('server authorization denial stays visible and pauses financial replay', async () => {
  const { state, validate } = fixture({ rpc: async () => ({ data: null, error: { code: '42501' } }) })
  assert.ok(await validate())
  assert.equal(state.currentUser.id, 'actor-1')
  assert.equal(state.replayAuthReady, false)
  assert.equal(state.authRuntimeStatus.status, 'access_denied')
})

test('temporary validation failure preserves identity but marks access unverified', async () => {
  const { state, validate } = fixture({ rpc: async () => { throw new Error('temporary network failure') } })
  assert.ok(await validate())
  assert.equal(state.currentUser.id, 'actor-1')
  assert.equal(state.replayAuthReady, false)
  assert.equal(state.authRuntimeStatus.status, 'validation_unavailable')
})

test('a response from an older session generation cannot clear a newer login', async () => {
  let stateRef
  const { state, validate } = fixture({ rpc: async () => {
    stateRef.authSessionGeneration += 1
    stateRef.currentUser = { id: 'actor-2', lodge_id: 'lodge-1', role: 'manager' }
    stateRef.backendSession = { token: 'token-2', session_type: 'desktop' }
    return { data: [], error: null }
  } })
  stateRef = state
  assert.equal((await validate()).id, 'actor-2')
  assert.equal(state.currentUser.id, 'actor-2')
  assert.equal(state.backendSession.token, 'token-2')
})

test('a login during reachability check cannot be overwritten by stale session validation', async () => {
  let stateRef
  let rpcCalls = 0
  const { state, validate } = fixture({ checkOnline: async () => {
    stateRef.authSessionGeneration += 1
    stateRef.currentUser = { id: 'actor-2', lodge_id: 'lodge-2', role: 'manager' }
    stateRef.lodgeId = 'lodge-2'
    stateRef.backendSession = { token: 'token-2', session_type: 'desktop' }
    return true
  }, rpc: async () => { rpcCalls += 1; return { data: [], error: null } } })
  stateRef = state
  assert.equal((await validate()).id, 'actor-2')
  assert.equal(state.currentUser.id, 'actor-2')
  assert.equal(state.lodgeId, 'lodge-2')
  assert.equal(state.backendSession.token, 'token-2')
  assert.equal(rpcCalls, 0)
})

test('stale protected-request failure cannot validate or revoke a newer session', async () => {
  const helperStart = source.indexOf('function authRequestContextIsCurrent(context)')
  const helperEnd = source.indexOf('\nfunction bumpAuthSessionGeneration', helperStart)
  const reporterStart = source.indexOf('export async function reportAuthRequestFailure(')
  assert.ok(helperStart >= 0 && helperEnd > helperStart && reporterStart >= 0)
  const reporterSource = `${source.slice(helperStart, helperEnd)}\n${source.slice(reporterStart).replace('export async function', 'async function')}`
  const state = {
    authSessionGeneration: 8,
    currentUser: { id: 'actor-2' }, lodgeId: 'lodge-2', replayAuthReady: true,
    authRuntimeStatus: { status: 'authenticated' }
  }
  let validations = 0
  const deps = {
    state,
    normalizeLodgeId: (value) => String(value || '').toLowerCase(),
    getAuthRequestContext: () => ({ generation: state.authSessionGeneration, actorId: state.currentUser.id, lodgeId: state.lodgeId }),
    validateCurrentSession: async () => { validations += 1; state.currentUser = null },
    publishAuthRuntimeStatus: (status, reason) => { state.authRuntimeStatus = { status, reason } }
  }
  const report = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps;\n${reporterSource}\nreturn reportAuthRequestFailure;`)(deps)
  await report(new Error('Not authenticated'), 'events:getAll', { generation: 7, actorId: 'actor-1', lodgeId: 'lodge-1' })
  assert.equal(validations, 0)
  assert.equal(state.currentUser.id, 'actor-2')
  assert.equal(state.authRuntimeStatus.status, 'authenticated')
})

test('a current request with a truly revoked server session is cleared by validation', async () => {
  const { state, validate } = fixture({ rpc: async () => ({ data: null, error: null }) })
  assert.equal(await validate(), null)
  assert.equal(state.currentUser, null)
  assert.equal(state.backendSession, null)
  assert.equal(state.replayAuthReady, false)
  assert.equal(state.authRuntimeStatus.status, 'sign_in_required')
})

test('renderer session restore cannot clear a newer login on stale or unavailable results', () => {
  const restorePromiseIndex = appSource.indexOf('const restorePromise = window.api.auth.restoreCurrentSession()')
  const start = appSource.lastIndexOf('    let active = true', restorePromiseIndex)
  const end = appSource.indexOf('  }, [activeProfile?.lodge_id, clearStoredRendererSession, profilesLoading, user])', start)
  assert.ok(start >= 0 && end > start, 'startup restore effect source must be present')
  const restoreEffect = appSource.slice(start, end)
  assert.match(restoreEffect, /let active = true/)
  assert.match(restoreEffect, /if \(!active\) return null/)
  assert.match(restoreEffect, /return \(\) => \{ active = false \}/)
  assert.match(restoreEffect, /status\?\.status === 'sign_in_required'/)
  assert.doesNotMatch(restoreEffect, /if \(!restored\) \{\s*clearStoredRendererSession\(\)/)
  assert.doesNotMatch(restoreEffect, /if \(!validated\) \{\s*clearStoredRendererSession\(\)/)
  const validateHandler = mainSource.slice(mainSource.indexOf("ipcMain.handle('auth:validateSession'"), mainSource.indexOf("ipcMain.handle('auth:getRuntimeStatus'"))
  assert.match(validateHandler, /return await db\.validateCurrentSession\(\)/)
  assert.doesNotMatch(validateHandler, /catch\s*\{\s*return null\s*\}/)
})

test('failed data reads and unavailable collections are not represented as empty or zero', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8')
  const customerRead = main.slice(main.indexOf("ipcMain.handle('customers:getAll'"), main.indexOf("ipcMain.handle('customers:create'"))
  const bookingRead = main.slice(main.indexOf("ipcMain.handle('bookings:getAll'"), main.indexOf("ipcMain.handle('bookings:getCachedByDateRange'"))
  const eventRead = main.slice(main.indexOf("ipcMain.handle('events:getAll'"), main.indexOf("ipcMain.handle('events:getById'"))
  const eventDetailsRead = main.slice(main.indexOf("ipcMain.handle('events:getDetails'"), main.indexOf("ipcMain.handle('events:create'"))
  const sync = fs.readFileSync('src/main/domains/infrastructure.js', 'utf8')
  const bookings = fs.readFileSync('src/main/domains/bookings.js', 'utf8')
  const collectionSummary = bookings.slice(bookings.indexOf('export async function getCollectionsSummary()'), bookings.indexOf('export async function getBookingById('))
  assert.match(customerRead, /reportAuthRequestFailure[\s\S]*throw error/)
  assert.match(customerRead, /const authRequestContext = db\.getAuthRequestContext\?\.\(\)/)
  assert.match(customerRead, /reportAuthRequestFailure\?\.(?:\(error, 'customers:getAll', authRequestContext\))/)
  assert.match(bookingRead, /reportAuthRequestFailure[\s\S]*throw error/)
  assert.match(bookingRead, /reportAuthRequestFailure\?\.(?:\(error, 'bookings:getAll', authRequestContext\))/)
  assert.match(bookingRead, /reportAuthRequestFailure\?\.(?:\(error, 'bookings:getCollectionsSummary', authRequestContext\))/)
  assert.match(bookingRead, /count: null, amount: null, unavailable: true/)
  assert.doesNotMatch(bookingRead, /count: 0, amount: 0/)
  assert.match(eventRead, /reportAuthRequestFailure[\s\S]*throw error/)
  assert.match(eventRead, /reportAuthRequestFailure\?\.(?:\(error, 'events:getAll', authRequestContext\))/)
  assert.match(eventDetailsRead, /const authRequestContext = db\.getAuthRequestContext\?\.\(\)/)
  assert.match(eventDetailsRead, /reportAuthRequestFailure\?\.(?:\(error, 'events:getDetails', authRequestContext\))/)
  assert.doesNotMatch(eventRead, /catch\(\) => \[\]/)
  assert.match(sync, /await reportAuthRequestFailure\(supabaseError, `sync:/)
  assert.match(sync, /replay_paused_auth_unverified[\s\S]*writeReplayQueue\(pending/)
  assert.match(collectionSummary, /await getBookingInvoices\(\)/)
  assert.match(collectionSummary, /invoices\._complete !== true\) throw new Error/)
  assert.match(collectionSummary, /reconciliation_required \|\| invoice\.balance_due == null/)
  assert.doesNotMatch(collectionSummary, /catch \{[\s\S]{0,80}count: 0, amount: 0/)
})
