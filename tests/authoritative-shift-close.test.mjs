import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { classifyAuthoritativeShiftClose } from '../src/main/domains/posShiftClose.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('shift close requires cash-up capability and authoritative finalization', async () => {
  const main = await read('src/main/index.js')
  const domain = await read('src/main/domains/pos.js')
  const pos = await read('src/renderer/src/components/POS.jsx')

  assert.match(main, /ipcMain\.handle\('pos:closeShift'[\s\S]*?requireCapability\('pos\.cashup'\)/)
  assert.match(domain, /finalize_pos_shift_cashup_v2/)
  assert.match(domain, /cashup_id: closeAttempt\.cashup_id/)
  assert.match(domain, /pos-shift-close-attempts/)
  assert.match(domain, /idempotency_conflict/)
  assert.match(pos, /server and requires supervisor or manager access/)
})

test('failed close paths do not write a locally closed shift', async () => {
  const domain = await read('src/main/domains/pos.js')
  const closeSection = domain.slice(domain.indexOf('export async function closePosShift'), domain.indexOf('export async function getPosHardwareSettings'))

  assert.match(closeSection, /if \(!state\.isOnline \|\| !state\.supabase\)/)
  assert.match(closeSection, /return \{\s*success: false/)
  assert.match(closeSection, /writePosShifts\(\[closed/)
  assert.ok(closeSection.indexOf('if (!result?.success)') < closeSection.indexOf('writePosShifts([closed'), 'cache close occurs only after server success')
})

test('authoritative close evidence resolves only a closed shift with matching cash-up', () => {
  const result = classifyAuthoritativeShiftClose({
    exists: true,
    status: 'closed',
    finalized: true,
    shift: { id: 'shift-1', status: 'closed', close_idempotency_key: 'close-1' },
    cashup_session: { id: 'cashup-1', idempotency_key: 'close-1' }
  }, 'close-1')
  assert.equal(result.success, true)
  assert.equal(result.already_closed, true)
  assert.equal(result.cashup_id, 'cashup-1')
})

test('missing, open, locked, void and unknown shifts never resolve as closed', () => {
  const cases = [
    { exists: false, status: 'missing' },
    { exists: true, status: 'open' },
    { exists: true, status: 'locked' },
    { exists: true, status: 'void' },
    { exists: true, status: 'unknown' },
    { exists: true, status: 'closed', finalized: false, cashup_session: null }
  ]
  for (const resolution of cases) assert.equal(classifyAuthoritativeShiftClose(resolution, 'close-1').success, false)
})

test('a closed shift with the wrong cash-up key remains unresolved', () => {
  const result = classifyAuthoritativeShiftClose({
    exists: true,
    status: 'closed',
    finalized: true,
    shift: { id: 'shift-1', status: 'closed', close_idempotency_key: 'close-other' },
    cashup_session: { id: 'cashup-1', idempotency_key: 'close-other' }
  }, 'close-1')
  assert.equal(result.success, false)
  assert.equal(result.code, 'shift_close_evidence_missing')
})
