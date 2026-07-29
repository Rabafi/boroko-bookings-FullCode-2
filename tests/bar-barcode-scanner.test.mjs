import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BARCODE_SCANNER_DEFAULTS,
  createBarcodeScannerDecoder,
  normalizeBarcode,
} from '../src/shared/barcodeScanner.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function scan(value, terminator = 'Enter', interval = 5) {
  const decoder = createBarcodeScannerDecoder()
  let output
  for (const [index, key] of [...String(value)].entries()) {
    output = decoder.consumeKey({ key, timeStamp: index * interval })
  }
  return decoder.consumeKey({ key: terminator, timeStamp: String(value).length * interval })
}

test('normalization preserves leading zeroes and rejects control/oversized values', () => {
  assert.equal(normalizeBarcode(' 00012345 '), '00012345')
  assert.equal(normalizeBarcode('abc\n123'), null)
  assert.equal(normalizeBarcode('x'.repeat(BARCODE_SCANNER_DEFAULTS.maxLength + 1)), null)
})

test('decoder completes Enter and Tab terminated scans', () => {
  const enter = scan('00012345', 'Enter')
  const tab = scan('ABC12345', 'Tab')
  assert.equal(enter.type, 'completed')
  assert.equal(enter.result.success, true)
  assert.equal(enter.result.barcode, '00012345')
  assert.equal(enter.result.terminator, 'Enter')
  assert.equal(tab.result.terminator, 'Tab')
})

test('decoder supports idle completion and resets after a slow gap', () => {
  const decoder = createBarcodeScannerDecoder()
  for (const [index, key] of [...'00012345'].entries()) decoder.consumeKey({ key, timeStamp: index * 5 })
  const idle = decoder.flush('idle')
  assert.equal(idle.result.barcode, '00012345')

  const resetDecoder = createBarcodeScannerDecoder()
  resetDecoder.consumeKey({ key: 'A', timeStamp: 0 })
  resetDecoder.consumeKey({ key: 'B', timeStamp: 5 })
  resetDecoder.consumeKey({ key: 'C', timeStamp: 500 })
  assert.equal(resetDecoder.getBuffer(), 'C')
})

test('decoder ignores modifiers/repeats and rejects short scans', () => {
  const decoder = createBarcodeScannerDecoder()
  assert.equal(decoder.consumeKey({ key: 'A', repeat: true }).type, 'ignored')
  assert.equal(decoder.consumeKey({ key: 'A', ctrlKey: true }).type, 'ignored')
  decoder.consumeKey({ key: '1', timeStamp: 1 })
  const short = decoder.consumeKey({ key: 'Enter', timeStamp: 2 })
  assert.equal(short.type, 'completed')
  assert.equal(short.result.code, 'scan_too_short')
})

test('decoder clamps invalid length configuration to a safe ordered range', () => {
  const decoder = createBarcodeScannerDecoder({ minLength: 80, maxLength: 4 })
  assert.equal(decoder.getOptions().minLength, 80)
  assert.equal(decoder.getOptions().maxLength, 80)
})

test('Till and Legacy POS use shared scanner decoder and guard scanner focus', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const legacy = read('legacy-pos/src/renderer/src/screens/POSTerminal.jsx')
  assert.match(terminal, /createBarcodeScannerDecoder/)
  assert.match(terminal, /Scanner paused/)
  assert.match(terminal, /duplicate_barcode/)
  assert.match(terminal, /wrong_outlet/)
  assert.match(terminal, /isScannerEditableTarget/)
  assert.match(legacy, /createBarcodeScannerDecoder/)
  assert.match(legacy, /normalizeBarcode/)
})

test('System Health exposes scanner verification and tunable keyboard-wedge settings', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx')
  assert.match(health, /Verify scanner input/)
  assert.match(health, /Minimum characters/)
  assert.match(health, /Inter-key limit/)
  assert.match(health, /Prefix \(optional\)/)
  assert.match(health, /Confirm captured barcode/)
})
