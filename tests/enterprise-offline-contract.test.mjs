import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const folioLedgerSource = readFileSync(resolve(__dirname, '../src/main/domains/folioLedger.js'), 'utf8')
const rateCalendarSource = readFileSync(resolve(__dirname, '../src/main/domains/rateCalendar.js'), 'utf8')
const offlineMatrix = readFileSync(resolve(__dirname, '../docs/OFFLINE_MATRIX.md'), 'utf8')
const corporateBillingSource = readFileSync(resolve(__dirname, '../src/main/domains/corporateBilling.js'), 'utf8')
const nightAuditSource = readFileSync(resolve(__dirname, '../src/main/domains/nightAudit.js'), 'utf8')

const FOLIO_FUNCTIONS = [
  'addCharge',
  'addPayment',
  'transferCharge',
  'splitFolio',
  'voidLineItem',
  'closeFolio',
  'reopenFolio',
  'lockFolio'
]

for (const fnName of FOLIO_FUNCTIONS) {
  test(`folioLedger.js: ${fnName} is online_only (reject offline, never queue)`, () => {
    const fnMarker = `export async function ${fnName}(`
    const idx = folioLedgerSource.indexOf(fnMarker)
    assert.ok(idx >= 0, `Function ${fnName} should exist in folioLedger.js`)

    const fnBody = folioLedgerSource.slice(idx)
    const closingBrace = findMatchingBrace(fnBody)
    const fnBlock = fnBody.slice(0, closingBrace + 1)

    assert.ok(
      fnBlock.includes('requireOnline(') || fnBlock.includes('state.isOnline'),
      `${fnName} should enforce online_only via requireOnline / isOnline`
    )
    assert.ok(
      !fnBlock.includes('queueOperation'),
      `${fnName} must NOT call queueOperation (online_only financial mutation)`
    )
  })
}

test('folioLedger.js: requireOnline sets onlineOnly and internet connection message', () => {
  assert.ok(folioLedgerSource.includes('function requireOnline'), 'requireOnline helper required')
  assert.ok(folioLedgerSource.includes('onlineOnly = true') || folioLedgerSource.includes('err.onlineOnly = true'))
  assert.ok(
    folioLedgerSource.includes('requires an internet connection'),
    'folioLedger should use internet-connection error pattern for online_only ops'
  )
  assert.ok(
    !folioLedgerSource.includes('queueOperation'),
    'folioLedger must not import or call queueOperation for financial mutations'
  )
})

test('corporateBilling.js: financial mutations online_only without queue', () => {
  assert.ok(corporateBillingSource.includes('function requireOnline'))
  assert.ok(!corporateBillingSource.includes('queueOperation'))
  for (const label of [
    'Charge to corporate account',
    'Record corporate payment',
    'Suspend corporate account',
    'Reactivate corporate account'
  ]) {
    assert.ok(
      corporateBillingSource.includes(label),
      `corporate billing should guard: ${label}`
    )
  }
})

test('nightAudit.js: close/reopen/resolve online_only without queue', () => {
  assert.ok(nightAuditSource.includes('function requireOnline'))
  assert.ok(nightAuditSource.includes("requireOnline('Close night audit')"))
  assert.ok(nightAuditSource.includes("requireOnline('Reopen night audit')"))
  assert.ok(nightAuditSource.includes("requireOnline('Resolve night audit exception')"))
  assert.ok(!nightAuditSource.includes('queueOperation'))
})

test('rateCalendar.js: getYieldRules handles offline', () => {
  const fnMarker = 'async function _getYieldRules()'
  const idx = rateCalendarSource.indexOf(fnMarker)
  assert.ok(idx >= 0, '_getYieldRules should exist in rateCalendar.js')

  const fnBody = rateCalendarSource.slice(idx)
  const closingBrace = findMatchingBrace(fnBody)
  const fnBlock = fnBody.slice(0, closingBrace + 1)

  assert.ok(fnBlock.includes('state.isOnline'), '_getYieldRules should check state.isOnline')
  assert.ok(fnBlock.includes('readCache'), '_getYieldRules should fall back to cache when offline')
})

test('rateCalendar.js: calculateOccupancyBasedRate handles offline', () => {
  const fnMarker = 'async function _calculateOccupancyBasedRate('
  const idx = rateCalendarSource.indexOf(fnMarker)
  assert.ok(idx >= 0, '_calculateOccupancyBasedRate should exist in rateCalendar.js')

  const fnBody = rateCalendarSource.slice(idx)
  const closingBrace = findMatchingBrace(fnBody)
  const fnBlock = fnBody.slice(0, closingBrace + 1)

  assert.ok(fnBlock.includes('state.isOnline'), '_calculateOccupancyBasedRate should check state.isOnline')
  assert.ok(fnBlock.includes("note: 'offline'"), '_calculateOccupancyBasedRate should return offline note when offline')
})

test('OFFLINE_MATRIX.md exists and contains expected sections', () => {
  assert.ok(offlineMatrix.includes('# Enterprise Offline Mutation Matrix'),
    'OFFLINE_MATRIX.md should have the main heading')
  assert.ok(offlineMatrix.includes('## Classification'),
    'OFFLINE_MATRIX.md should have Classification section')
  assert.ok(offlineMatrix.includes('## Financial Mutations'),
    'OFFLINE_MATRIX.md should have Financial Mutations section')
  assert.ok(offlineMatrix.includes('## Operational Mutations'),
    'OFFLINE_MATRIX.md should have Operational Mutations section')
  assert.ok(offlineMatrix.includes('## Queue Contract'),
    'OFFLINE_MATRIX.md should have Queue Contract section')
  assert.ok(offlineMatrix.includes('## Online-Only Handling'),
    'OFFLINE_MATRIX.md should have Online-Only Handling section')
})

test('OFFLINE_MATRIX.md has at least 10 online_only operations', () => {
  const onlineOnlyMatches = offlineMatrix.match(/\|.*?online_only.*?\|/g)
  assert.ok(onlineOnlyMatches, 'Should find online_only entries in the matrix')
  assert.ok(onlineOnlyMatches.length >= 10,
    `Should have at least 10 online_only operations, found ${onlineOnlyMatches.length}`)
})

test('OFFLINE_MATRIX.md documents queueable operations where implemented', () => {
  // Room moves and maintenance tickets remain the primary proved queueable hotel ops.
  assert.ok(
    offlineMatrix.includes('queueable'),
    'Should document queueable operations'
  )
  assert.ok(
    offlineMatrix.includes('roomMoves') || offlineMatrix.includes('Room moves') || offlineMatrix.includes('move_booking_room'),
    'Should document room move queueability'
  )
})

function findMatchingBrace(str) {
  let depth = 0
  let inString = false
  let stringChar = null
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === stringChar) inString = false
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return str.length - 1
}
