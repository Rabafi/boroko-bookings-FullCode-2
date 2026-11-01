import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('chart account contracts protect codes, versions and posted types', () => {
  const command = COMMANDS['accounting.account.upsert']
  assert.equal(command.version, 1)
  assert.equal(command.capability, CAPABILITIES.ACCOUNTING_MANAGE)
  assert.equal(command.approval, null)
  assert.equal(QUERIES['accounting.accounts.list'].capability, CAPABILITIES.ACCOUNTING_READ)

  const created = command.validate({ code: ' 5000 ', name: ' Utilities ', type: 'expense' })
  assert.equal(created.code, '5000')
  assert.equal(created.name, 'Utilities')
  assert.equal(created.active, true)
  assert.equal(created.expected_version, null)

  const updated = command.validate({
    code: '5000', name: 'Utilities', type: 'expense', active: false, expected_version: 2
  })
  assert.equal(updated.active, false)
  assert.equal(updated.expected_version, 2)

  assert.throws(() => command.validate({ code: ' bad code ', name: 'Bad', type: 'expense' }), /code/)
  assert.throws(() => command.validate({ code: '1000', name: '', type: 'asset' }), /name/)
  assert.throws(() => command.validate({ code: '1000', name: 'Cash', type: 'bank' }), /type/)
  assert.throws(() => command.validate({ code: '1000', name: 'Cash', type: 'asset', expected_version: 0 }), /expected_version/)
})
