import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const dialog = readFileSync('src/renderer/src/components/hospitality-pos/HposTillOperatorDialog.jsx', 'utf8')
const terminal = readFileSync('src/renderer/src/components/hospitality-pos/HposTerminal.jsx', 'utf8')

test('unlock dialog lists only clocked-in staff when the attendance list is known', () => {
  assert.match(dialog, /activeStaffIds = null, isOnline = null/)
  assert.match(dialog, /const canFilter = Array\.isArray\(activeStaffIds\)/)
  assert.match(dialog, /visibleStaff/)
  assert.match(dialog, /staff\.filter\(\(member\) => activeSet\.has\(String\(member\.id\)\)\)/)
  assert.match(dialog, /effectiveStaffId/)
})

test('unlock dialog shows loading progress while the shift roster arrives', () => {
  assert.match(dialog, /loadingShiftRoster/)
  assert.match(dialog, /Loading who is on shift/)
  assert.match(dialog, /Checking who is clocked in/)
})

test('unlock dialog says plainly when no one is clocked in', () => {
  assert.match(dialog, /No one is clocked in right now\./)
  assert.match(dialog, /Clock in at Staff shift close first/)
  assert.match(dialog, /hpos-till-unlock-empty/)
})

test('unlock dialog filters offline from the cached roster and fails open only when unknown', () => {
  // Offline uses the last saved shift roster (cache-backed attendance), not
  // every employee. Only a failed read falls back to the full list — the
  // server refusal stays the backstop.
  assert.match(dialog, /visibleStaff = canFilter \? .* : staff/)
  assert.match(dialog, /server stays the/)
  assert.match(dialog, /Only staff currently clocked in are listed\./)
  assert.match(dialog, /last saved shift roster/)
})

test('the Till feeds the dialog fresh attendance plus online state on every open', () => {
  assert.match(terminal, /unlockActiveStaffIds/)
  assert.match(terminal, /unlockIsOnline/)
  assert.match(terminal, /getActiveShifts\?\.\(\)/)
  assert.match(terminal, /sync\?\.getStatus\?\.\(\)/)
  assert.match(terminal, /activeStaffIds=\{unlockActiveStaffIds\}/)
  assert.match(terminal, /isOnline=\{unlockIsOnline\}/)
})
