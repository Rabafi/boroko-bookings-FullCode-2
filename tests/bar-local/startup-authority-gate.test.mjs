import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', '..', 'src', 'main', 'index.js'), 'utf8')

const registrationAt = source.indexOf('barLocalRuntime = registerBarLocalIpc({ ipcMain, app, safeStorage, dialog, buildProductId: BUILD_PRODUCT_ID })')
const initDatabaseAt = source.indexOf('await db.initDatabase()')
const startupErrorAt = source.indexOf('if (barLocalStartupError !== null) {')
const localGateAt = source.indexOf('if (barLocalRuntime?.mode === AUTHORITY_MODES.BAR_LOCAL || barLocalRuntime?.cloudStartupDeferred) {')

function branchSource(startAt) {
  assert.notEqual(startAt, -1, 'startup branch marker is missing')
  const nextCloudInit = source.indexOf('// Init DB', startAt)
  assert.notEqual(nextCloudInit, -1, 'cloud initialization marker is missing after startup branch')
  return source.slice(startAt, nextCloudInit)
}

test('Modern startup loads the committed authority profile before cloud database initialization', () => {
  assert.match(source, /import \{ AUTHORITY_MODES \} from '\.\/bar-local\/authority\.js'/)
  assert.notEqual(registrationAt, -1, 'local Bar runtime registration is missing')
  assert.notEqual(initDatabaseAt, -1, 'cloud database initialization is missing')
  assert.ok(registrationAt < initDatabaseAt, 'authority profile must be loaded before db.initDatabase()')
  assert.match(source, /!process\.argv\.includes\('--bar-training'\) && !isDedicatedLocalBarWorkspaceArgv\(process\.argv\)/)
})

test('bar_local authority skips cloud database and background startup work', () => {
  assert.notEqual(localGateAt, -1, 'bar_local startup gate is missing')
  assert.ok(localGateAt < initDatabaseAt, 'bar_local gate must run before db.initDatabase()')

  const branch = branchSource(localGateAt)
  assert.match(branch, /createWindow\(\)/, 'local mode must start the local Bar window')
  assert.match(branch, /return\b/, 'local mode must stop before the cloud startup path')
  assert.doesNotMatch(branch, /db\.initDatabase\(\)/, 'local mode must not initialize the cloud database')
  assert.doesNotMatch(branch, /setupAutoUpdater\(/, 'local mode must not start the cloud-gated updater')
  assert.doesNotMatch(branch, /setInterval\(/, 'local mode must not start cloud timers')
  assert.doesNotMatch(branch, /setTimeout\(/, 'local mode must not start cloud timers')
  assert.doesNotMatch(branch, /'mesh:/, 'local mode must not register mesh IPC')
  assert.doesNotMatch(branch, /runScheduledFinancialValidation/, 'local mode must not start cloud financial sync')
  assert.doesNotMatch(branch, /publishDeviceHealth/, 'local mode must not publish cloud device health')
  assert.doesNotMatch(branch, /evaluateAllRules/, 'local mode must not run cloud notification automation')
})

test('an unavailable committed local profile fails closed before cloud initialization', () => {
  assert.notEqual(startupErrorAt, -1, 'startup profile failure branch is missing')
  assert.ok(startupErrorAt < initDatabaseAt, 'profile failure must be handled before db.initDatabase()')

  const branch = branchSource(startupErrorAt)
  assert.match(branch, /dialog\.showErrorBox\(/, 'failure must surface an actionable UI error')
  assert.match(branch, /app\.quit\(\)/, 'failure must stop the application')
  assert.match(branch, /return\b/, 'failure must not continue into cloud startup')
  assert.doesNotMatch(branch, /db\.initDatabase\(\)/, 'failure must not initialize the cloud database')
})

test('authority selection is the committed profile mode, not internet reachability', () => {
  assert.notEqual(localGateAt, -1, 'bar_local startup gate is missing')
  assert.match(source, /barLocalRuntime\?\.mode === AUTHORITY_MODES\.BAR_LOCAL/)
  const gateLine = source.slice(localGateAt, source.indexOf('\n', localGateAt))
  assert.doesNotMatch(gateLine, /online|offline|fetch|navigator|net\.|isOnline/i)
})

test('startup shows progress without implying an internet prerequisite and bounds authority discovery', () => {
  assert.match(source, /Starting the application\./)
  assert.doesNotMatch(source, /Checking internet connection and online database access/)
  const app = readFileSync(join(here, '..', '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf8')
  assert.match(app, /The local Bar check took too long\. Try opening the Bar again\./)
  assert.match(app, /12000\)/)
  assert.match(app, /role="status" aria-live="polite" className="flex min-h-screen/)
  assert.match(app, /Starting the application…/)
  assert.match(app, /Try opening the Bar again/)
})

test('committed pairing recovery does not invite setup or reuse of the pairing code', () => {
  const app = readFileSync(join(here, '..', '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf8')
  const joinHandler = app.slice(app.indexOf('const joinAuthority ='), app.indexOf('return (', app.indexOf('const joinAuthority =')))
  assert.ok(joinHandler.indexOf("setCommittedSetup({ staffId: '', paired: true })") >= 0)
  assert.ok(joinHandler.indexOf("setCommittedSetup({ staffId: '', paired: true })") < joinHandler.indexOf('getStatus()'))
  assert.match(app, /Pairing was committed. Do not reuse the pairing code/ )
  assert.match(app, /This till was paired. Sign in with your staff ID and PIN/ )
  assert.match(app, /!committedSetup && !unavailable/ )
})
