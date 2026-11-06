import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { COMMANDS, QUERIES, CAPABILITIES } from '@tsa-bonno/bar-contracts'

test('blind cash-up handover requires exact cash and current shift version without client-authored totals or actor', () => {
  const command = COMMANDS['cashup.handover']
  assert.equal(command.capability, CAPABILITIES.POS_CASHUP)
  assert.equal(command.approval, null)
  const payload = { shift_id: randomUUID(), expected_shift_version: 1, counted_cash: '95.25', notes: ' Counted ' }
  assert.equal(command.validate(payload).notes, 'Counted')
  for (const extra of [{ expected_cash: '95.25' }, { actor_id: randomUUID() }, { status: 'approved' }]) {
    assert.throws(() => command.validate({ ...payload, ...extra }), /allowed field|unknown|unexpected/i)
  }
  assert.throws(() => command.validate({ ...payload, counted_cash: '-1.00' }), /counted_cash/)
  assert.throws(() => command.validate({ ...payload, counted_cash: '1.001' }), /counted_cash/)
  assert.throws(() => command.validate({ ...payload, expected_shift_version: 0 }), /expected_shift_version/)
  assert.equal(QUERIES['cashup.mine'].capability, CAPABILITIES.POS_CASHUP)
  assert.throws(() => QUERIES['cashup.mine'].validate({ staff_id: randomUUID() }), /allowed field|unknown|unexpected/i)
})

test('general shift and cashier cash-up summaries strip reconciliation totals at the query boundary', () => {
  const migration = readFileSync(fileURLToPath(new URL('../db/migrations/0087_blind_cashup_query_projection.sql', import.meta.url)), 'utf8')
  assert.match(migration, /p_query NOT IN \('shift\.current','cashup\.summary'\)/)
  assert.match(migration, /'expected_cash'-'counted_cash'-'variance'-'counted_card'/)
  assert.match(migration, /v_ctx\.role NOT IN \('owner','manager'\)/)
  assert.match(migration, /'expected_cash'-'cash_sales'-'card_sales'-'cash_movements'-'cashup'/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION bar_local\.query_dispatch\(text,uuid,uuid,bigint,text,jsonb\) TO bar_local_runtime/)
})
