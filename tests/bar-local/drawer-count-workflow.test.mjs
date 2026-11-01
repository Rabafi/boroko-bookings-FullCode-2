import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const modern = readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx'), 'utf8')
const legacy = readFileSync(path.join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8')
const contracts = readFileSync(path.join(root, 'packages/bar-contracts/src/registry.ts'), 'utf8')
const migration = readFileSync(path.join(root, 'services/bar-local/db/migrations/0046_drawer_cash_count.sql'), 'utf8')
const databaseTest = readFileSync(path.join(root, 'services/bar-local/tests/db-drawer-movements.test.mjs'), 'utf8')
const { COMMANDS } = await import(pathToFileURL(path.join(root, 'packages/bar-contracts/dist/index.js')).href)

test('Modern and Legacy expose local physical drawer counts with explicit balance semantics', () => {
  for (const source of [modern, legacy]) {
    assert.match(source, /<option value="count">Count till cash<\/option>/)
    assert.match(source, /Physical cash counted/)
    assert.match(source, /variance \$\{displayMoney\(result\.result\.variance\)\}/)
    assert.match(source, /count does not change the drawer balance/)
  }
})

test('drawer count contract permits zero while the service snapshots expected cash and preserves replay', () => {
  assert.match(contracts, /allowZero:\s*type === 'count'/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /bar_local\.expected_shift_cash\(v_shift\.id\)/)
  assert.match(migration, /'expected_cash', v_expected_cash/)
  assert.match(migration, /'variance', v_amount - v_expected_cash/)
  assert.match(databaseTest, /countReplay\.replayed, true/)
  assert.match(databaseTest, /physical counts must not alter expected drawer cash/)
})

test('shared drawer contract accepts a zero cash count but rejects zero cash movements', () => {
  const payload = { shift_id: '2cf3a847-6db0-485a-8832-d51302b8a7e1', type: 'count', amount: '0.00', reason: 'Empty till count' }
  assert.doesNotThrow(() => COMMANDS['drawer.movement'].validate(payload))
  assert.throws(() => COMMANDS['drawer.movement'].validate({ ...payload, type: 'paid_in' }), /non-negative|greater|positive/i)
})

test('tip payouts use the approved workforce contract, not generic drawer movements', () => {
  const shift_id = '2cf3a847-6db0-485a-8832-d51302b8a7e1'
  const staff_id = 'd7781927-cafe-4f21-b21a-cf3aa473522a'
  const approval_id = 'e0823859-7688-4fe6-9747-482518c1012b'
  assert.throws(() => COMMANDS['drawer.movement'].validate({
    shift_id, type: 'tip_payout', amount: '10.00', reason: 'Tip payout'
  }), /type/i)
  const payout = COMMANDS['workforce.tip.payout']
  assert.equal(payout.approval, 'pos.cashup')
  assert.doesNotThrow(() => payout.validate({
    shift_id, staff_id, amount: '10.00', reason: 'Tip payout', approval_id
  }))
})
