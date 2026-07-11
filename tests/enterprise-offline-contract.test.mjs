import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const folioLedgerSource = readFileSync(resolve(__dirname, '../src/main/domains/folioLedger.js'), 'utf8')
const rateCalendarSource = readFileSync(resolve(__dirname, '../src/main/domains/rateCalendar.js'), 'utf8')
const offlineMatrix = readFileSync(resolve(__dirname, '../docs/OFFLINE_MATRIX.md'), 'utf8')

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
  test(`folioLedger.js: ${fnName} handles offline state`, () => {
    const fnMarker = `export async function ${fnName}(`
    const idx = folioLedgerSource.indexOf(fnMarker)
    assert.ok(idx >= 0, `Function ${fnName} should exist in folioLedger.js`)

    const fnBody = folioLedgerSource.slice(idx)
    const closingBrace = findMatchingBrace(fnBody)
    const fnBlock = fnBody.slice(0, closingBrace + 1)

    const hasOfflineCheck = fnBlock.includes('state.isOnline')
    assert.ok(hasOfflineCheck, `${fnName} should check state.isOnline for offline handling`)

    const handlesOffline = fnBlock.includes('queueOperation')
    assert.ok(handlesOffline, `${fnName} should call queueOperation when offline`)
  })
}

test('folioLedger.js: file does not contain online_only or "This operation requires" patterns', () => {
  assert.ok(!folioLedgerSource.includes('online_only'), 'folioLedger should not use online_only label')
  assert.ok(!folioLedgerSource.includes('This operation requires'),
    'folioLedger should not use "This operation requires" error pattern')
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

test('OFFLINE_MATRIX.md has at least 5 queueable operations', () => {
  const queueableMatches = offlineMatrix.match(/\|.*?queueable.*?\|/g)
  assert.ok(queueableMatches, 'Should find queueable entries in the matrix')
  assert.ok(queueableMatches.length >= 5,
    `Should have at least 5 queueable operations, found ${queueableMatches.length}`)
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
