import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'

test('Migration file exists', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  assert.ok(migration, 'Expected abandoned_payment_recovery migration to exist')
})

test('Creates abandoned_payment_sessions table', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  const content = fs.readFileSync(path.join(migrationDir, migration), 'utf8')
  assert.ok(content.includes('create table if not exists abandoned_payment_sessions'), 'Expected create table abandoned_payment_sessions')
})

test('Has all 5 RPCs', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  const content = fs.readFileSync(path.join(migrationDir, migration), 'utf8')

  const expectedRpcs = [
    'log_abandoned_session',
    'get_abandoned_sessions',
    'recover_abandoned_session',
    'expire_abandoned_sessions',
    'get_pending_recovery_sessions'
  ]

  for (const rpc of expectedRpcs) {
    assert.ok(content.includes(rpc), `Expected ${rpc} RPC function`)
  }
})

test('Uses app_require_lodge_role', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  const content = fs.readFileSync(path.join(migrationDir, migration), 'utf8')
  assert.ok(content.includes('app_require_lodge_role'), 'Expected app_require_lodge_role calls')
})

test('Enables RLS', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  const content = fs.readFileSync(path.join(migrationDir, migration), 'utf8')
  assert.ok(content.includes('enable row level security'), 'Expected RLS to be enabled')
})

test('Grants execute to authenticated and service_role', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('abandoned_payment_recovery'))
  const content = fs.readFileSync(path.join(migrationDir, migration), 'utf8')
  const grantCount = (content.match(/grant execute/g) || []).length
  assert.ok(grantCount >= 5, 'Expected at least 5 GRANT EXECUTE statements')
})

test('Domain file exists', () => {
  const domainPath = path.resolve('src/main/domains/abandonedPaymentRecovery.js')
  assert.ok(fs.existsSync(domainPath), 'Expected abandonedPaymentRecovery.js to exist')
})

test('Domain exports all functions', () => {
  const domainPath = path.resolve('src/main/domains/abandonedPaymentRecovery.js')
  const content = fs.readFileSync(domainPath, 'utf8')

  const expectedExports = [
    'logAbandonedSession',
    'getAbandonedSessions',
    'recoverSession',
    'expireSessions',
    'getPendingRecoverySessions'
  ]

  for (const fn of expectedExports) {
    assert.ok(content.includes(`export function ${fn}`) || content.includes(`export const ${fn}`),
      `Expected export function ${fn}`)
  }
})

test('IPC handlers exist', () => {
  const indexPath = path.resolve('src/main/index.js')
  const content = fs.readFileSync(indexPath, 'utf8')

  const expectedHandlers = [
    'abandonedPayments:logSession',
    'abandonedPayments:getSessions',
    'abandonedPayments:recoverSession',
    'abandonedPayments:expireSessions',
    'abandonedPayments:getPendingRecovery'
  ]

  for (const handler of expectedHandlers) {
    assert.ok(content.includes(`ipcMain.handle('${handler}'`) || content.includes(`ipcMain.handle("${handler}"`),
      `Expected IPC handler ${handler}`)
  }
})

test('Preload has abandonedPayments section', () => {
  const preloadPath = path.resolve('src/preload/index.js')
  const content = fs.readFileSync(preloadPath, 'utf8')

  assert.ok(content.includes('abandonedPayments:'), 'Expected abandonedPayments IPC calls in preload')
  assert.ok(content.includes('abandonedPayments:logSession'), 'Expected logSession in preload')
  assert.ok(content.includes('abandonedPayments:getSessions'), 'Expected getSessions in preload')
  assert.ok(content.includes('abandonedPayments:recoverSession'), 'Expected recoverSession in preload')
  assert.ok(content.includes('abandonedPayments:expireSessions'), 'Expected expireSessions in preload')
  assert.ok(content.includes('abandonedPayments:getPendingRecovery'), 'Expected getPendingRecovery in preload')
})

test('database.js exports abandoned payment functions', () => {
  const dbPath = path.resolve('src/main/database.js')
  const content = fs.readFileSync(dbPath, 'utf8')

  const expectedExports = [
    'logAbandonedSession',
    'getAbandonedSessions',
    'recoverSession',
    'expireSessions',
    'getPendingRecoverySessions'
  ]

  for (const fn of expectedExports) {
    assert.ok(content.includes(fn), `Expected database.js to export ${fn}`)
  }
})
