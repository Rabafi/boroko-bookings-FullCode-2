import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function readFileLines(filePath) {
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
}

// ── Migration file exists ─────────────────────────────────────────────────────

test('Migration file exists for hotel_folio_ledger', () => {
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations')
  const files = fs.readdirSync(migrationsDir)
  const migration = files.find((f) => f.includes('hotel_folio_ledger'))
  assert.ok(migration, 'hotel_folio_ledger migration file not found')
})

const MIGRATION_PATH = (() => {
  const dir = path.join(ROOT, 'supabase', 'migrations')
  const file = fs.readdirSync(dir).find((f) => f.includes('hotel_folio_ledger'))
  return file ? path.join(dir, file) : null
})()

const migrationLines = MIGRATION_PATH ? readFileLines(MIGRATION_PATH) : []

// ── Tables ────────────────────────────────────────────────────────────────────

test('Migration creates hotel_folios table', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS hotel_folios'), 'hotel_folios table not found')
})

test('Migration creates folio_line_items table', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS folio_line_items'), 'folio_line_items table not found')
})

test('Migration has folio_type CHECK constraint', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes("CHECK (folio_type IN ('guest', 'master', 'company', 'department', 'incidental'))"), 'folio_type check not found')
})

test('Migration has status CHECK constraint', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes("CHECK (status IN ('open', 'closed', 'locked', 'void'))"), 'status check not found')
})

test('Migration has line_type CHECK constraint', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes("CHECK (line_type IN ('charge', 'payment', 'transfer_in', 'transfer_out', 'void', 'adjustment'))"), 'line_type check not found')
})

test('Migration has audit_before and audit_after columns', () => {
  const content = migrationLines.join('\n')
  assert.ok(content.includes('audit_before JSONB'), 'audit_before not found')
  assert.ok(content.includes('audit_after JSONB'), 'audit_after not found')
})

// ── RLS ───────────────────────────────────────────────────────────────────────

test('Migration enables RLS on both tables', () => {
  const content = migrationLines.join('\n')
  const rlsCount = (content.match(/ENABLE ROW LEVEL SECURITY/g) || []).length
  assert.ok(rlsCount >= 2, `Expected at least 2 ENABLE ROW LEVEL SECURITY, found ${rlsCount}`)
})

// ── Required RPCs ─────────────────────────────────────────────────────────────

const REQUIRED_RPCS = [
  'create_hotel_folio',
  'get_hotel_folios',
  'get_folio_line_items',
  'add_folio_charge',
  'add_folio_payment',
  'transfer_folio_charge',
  'split_folio',
  'void_folio_line',
  'close_folio',
  'reopen_folio',
  'lock_folio',
  'get_folio_balance'
]

for (const rpcName of REQUIRED_RPCS) {
  test(`Migration creates RPC: ${rpcName}`, () => {
    const content = migrationLines.join('\n')
    assert.ok(content.includes(`CREATE OR REPLACE FUNCTION ${rpcName}`), `RPC ${rpcName} not found`)
  })
}

test('Migration uses app_require_lodge_role pattern', () => {
  const content = migrationLines.join('\n')
  const matches = content.match(/app_require_lodge_role/g)
  assert.ok(matches && matches.length >= 12, `Expected >=12 app_require_lodge_role calls, found ${matches ? matches.length : 0}`)
})

test('Migration grants execute to authenticated on all RPCs', () => {
  const content = migrationLines.join('\n')
  const grantCount = (content.match(/GRANT EXECUTE ON FUNCTION /g) || []).length
  assert.ok(grantCount >= 13, `Expected >=13 GRANT EXECUTE statements, found ${grantCount}`)
  assert.ok(content.includes('TO authenticated, service_role'), 'grants missing service_role')
})

// ── Domain file exists ────────────────────────────────────────────────────────

test('Domain file exists (folioLedger.js)', () => {
  const domainPath = path.join(ROOT, 'src', 'main', 'domains', 'folioLedger.js')
  assert.ok(fs.existsSync(domainPath), 'folioLedger.js not found')
})

const domainLines = readFileLines(path.join(ROOT, 'src', 'main', 'domains', 'folioLedger.js'))
const domainContent = domainLines.join('\n')

test('Domain imports from state.js', () => {
  assert.ok(domainContent.includes("from '../state.js'"), 'state.js import not found')
})

test('Domain imports infrastructure helpers', () => {
  assert.ok(domainContent.includes("from './infrastructure.js'"), 'infrastructure.js import not found')
  assert.ok(domainContent.includes('logActivity'), 'logActivity not imported')
  assert.ok(domainContent.includes('dedupePromise'), 'dedupePromise not imported')
})

const REQUIRED_DOMAIN_EXPORTS = [
  'getFolios',
  'getLineItems',
  'createFolio',
  'addCharge',
  'addPayment',
  'transferCharge',
  'splitFolio',
  'voidLineItem',
  'closeFolio',
  'reopenFolio',
  'lockFolio',
  'getBalance'
]

for (const exportName of REQUIRED_DOMAIN_EXPORTS) {
  test(`Domain exports ${exportName}`, () => {
    assert.ok(domainContent.includes(`export async function ${exportName}`) || domainContent.includes(`export function ${exportName}`), `export ${exportName} not found`)
  })
}

test('Domain uses dedupePromise for getFolios', () => {
  assert.ok(domainContent.includes('dedupePromise'), 'dedupePromise not used')
})

test('Domain checks state.isOnline', () => {
  assert.ok(domainContent.includes('state.isOnline'), 'state.isOnline not checked')
})

test('Domain rejects offline financial mutations (online-only per OFFLINE_MATRIX)', () => {
  assert.ok(domainContent.includes('requireOnline') || domainContent.includes('onlineOnly'), 'must enforce online-only')
  assert.ok(!domainContent.includes('queueOperation('), 'must not queue folio financial mutations offline')
  assert.ok(domainContent.includes('cannot be queued offline') || domainContent.includes('requires an internet connection'))
})

// ── database.js exports ───────────────────────────────────────────────────────

test('database.js exports folioLedger', () => {
  const dbLines = readFileLines(path.join(ROOT, 'src', 'main', 'database.js'))
  const content = dbLines.join('\n')
  assert.ok(content.includes("export * as folioLedger from './domains/folioLedger.js'"), 'folioLedger export not found in database.js')
})

// ── IPC handlers in main/index.js ─────────────────────────────────────────────

const mainIndexLines = readFileLines(path.join(ROOT, 'src', 'main', 'index.js'))
const mainIndexContent = mainIndexLines.join('\n')

const REQUIRED_IPC_HANDLERS = [
  'folioLedger:getFolios',
  'folioLedger:getLineItems',
  'folioLedger:createFolio',
  'folioLedger:addCharge',
  'folioLedger:addPayment',
  'folioLedger:transferCharge',
  'folioLedger:splitFolio',
  'folioLedger:voidLineItem',
  'folioLedger:closeFolio',
  'folioLedger:reopenFolio',
  'folioLedger:lockFolio',
  'folioLedger:getBalance'
]

for (const handler of REQUIRED_IPC_HANDLERS) {
  test(`IPC handler exists: ${handler}`, () => {
    assert.ok(mainIndexContent.includes(`'${handler}'`), `IPC handler ${handler} not found in main/index.js`)
  })
}

test('IPC handlers use requireCapability for folios.view', () => {
  const viewHandlers = ['folioLedger:getFolios', 'folioLedger:getLineItems', 'folioLedger:getBalance']
  for (const h of viewHandlers) {
    assert.ok(mainIndexContent.includes(`requireCapability('folios.view')`), `${h} missing folios.view capability check`)
  }
})

test('IPC handlers use requireCapability for folios.manage', () => {
  const manageHandlers = ['folioLedger:createFolio', 'folioLedger:addCharge', 'folioLedger:addPayment', 'folioLedger:transferCharge', 'folioLedger:splitFolio', 'folioLedger:voidLineItem', 'folioLedger:closeFolio', 'folioLedger:reopenFolio', 'folioLedger:lockFolio']
  for (const h of manageHandlers) {
    assert.ok(mainIndexContent.includes(`requireCapability('folios.manage')`), `${h} missing folios.manage capability check`)
  }
})

test('IPC handlers reference db.folioLedger', () => {
  assert.ok(mainIndexContent.includes('db.folioLedger.'), 'db.folioLedger not referenced in handlers')
})

// ── Preload has folioLedger section ───────────────────────────────────────────

const preloadLines = readFileLines(path.join(ROOT, 'src', 'preload', 'index.js'))
const preloadContent = preloadLines.join('\n')

test('Preload has folioLedger section', () => {
  assert.ok(preloadContent.includes('folioLedger:'), 'folioLedger section not found in preload')
})

const REQUIRED_PRELOAD_METHODS = [
  'getFolios',
  'getLineItems',
  'createFolio',
  'addCharge',
  'addPayment',
  'transferCharge',
  'splitFolio',
  'voidLineItem',
  'closeFolio',
  'reopenFolio',
  'lockFolio',
  'getBalance'
]

for (const method of REQUIRED_PRELOAD_METHODS) {
  test(`Preload has folioLedger method: ${method}`, () => {
    assert.ok(preloadContent.includes(method), `folioLedger.${method} not found in preload`)
  })
}

test('Preload folioLedger methods invoke folioLedger: IPC channels', () => {
  for (const method of REQUIRED_PRELOAD_METHODS) {
    const camelToKebab = method.replace(/[A-Z]/g, (c) => ':' + c.toLowerCase())
    const channel = `folioLedger:${camelToKebab}`
    assert.ok(preloadContent.includes(channel) || preloadContent.includes(`folioLedger:${method}`), `IPC channel for ${method} not found in preload`)
  }
})

// ── Folios.jsx references window.api.folioLedger ──────────────────────────────

test('Folios.jsx references window.api.folioLedger', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  assert.ok(fs.existsSync(foliosPath), 'Folios.jsx not found')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes('window.api.folioLedger'), 'window.api.folioLedger not referenced in Folios.jsx')
})

test('Folios.jsx has Ledger tab', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes("activeTab === 'ledger'"), 'Ledger tab not found')
  assert.ok(content.includes("activeTab === 'overview'"), 'Overview tab not found')
})

test('Folios.jsx has Split Folio button', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes('Split'), 'Split button not found in Folios.jsx')
})

test('Folios.jsx has Transfer Charge button', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes('Transfer'), 'Transfer button not found in Folios.jsx')
})

test('Folios.jsx has Close/Lock action buttons', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes("handleLedgerAction('close'") || content.includes('closeFolio'), 'Close action not found')
  assert.ok(content.includes("handleLedgerAction('lock'") || content.includes('lockFolio'), 'Lock action not found')
})

test('Folios.jsx has Add Charge inline form', () => {
  const foliosPath = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'Folios.jsx')
  const content = readFileLines(foliosPath).join('\n')
  assert.ok(content.includes('Add Charge'), 'Add Charge button not found')
  assert.ok(content.includes('handleLedgerCharge'), 'handleLedgerCharge not found')
})

// ── Access control: folios capabilities exist ─────────────────────────────────

test('folios.view capability registered in accessControl.js', () => {
  const acLines = readFileLines(path.join(ROOT, 'src', 'shared', 'accessControl.js'))
  const content = acLines.join('\n')
  assert.ok(content.includes("'folios.view'"), 'folios.view not found in accessControl.js')
})

test('folios.manage capability registered in accessControl.js', () => {
  const acLines = readFileLines(path.join(ROOT, 'src', 'shared', 'accessControl.js'))
  const content = acLines.join('\n')
  assert.ok(content.includes("'folios.manage'"), 'folios.manage not found in accessControl.js')
})

test('folios module registered in moduleCatalog.js', () => {
  const mcLines = readFileLines(path.join(ROOT, 'src', 'shared', 'moduleCatalog.js'))
  const content = mcLines.join('\n')
  assert.ok(content.includes("'folios.view'") && content.includes("'folios.manage'"), 'folios capabilities not found in moduleCatalog.js')
})
