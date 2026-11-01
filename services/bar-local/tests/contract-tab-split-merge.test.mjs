import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS } from '@tsa-bonno/bar-contracts'

test('tab split and merge contracts require POS management with approval', () => {
  for (const command of ['tab.split', 'tab.merge']) {
    assert.equal(COMMANDS[command].version, 1)
    assert.equal(COMMANDS[command].capability, CAPABILITIES.POS_MANAGE)
    assert.equal(COMMANDS[command].approval, CAPABILITIES.POS_MANAGE)
  }

  const lineIds = [randomUUID(), randomUUID()]
  const split = COMMANDS['tab.split'].validate({
    source_tab_id: randomUUID(),
    expected_version: 3,
    line_ids: lineIds,
    table_label: '  Patio 2  ',
    reason: '  guests moved  '
  })
  assert.deepEqual(split.line_ids, lineIds)
  assert.equal(split.table_label, 'Patio 2')
  assert.equal(split.reason, 'guests moved')
  assert.equal(split.approval_id, null)

  assert.throws(() => COMMANDS['tab.split'].validate({
    source_tab_id: randomUUID(),
    expected_version: 3,
    line_ids: [lineIds[0], lineIds[0]]
  }), /line_ids/)

  const tabId = randomUUID()
  assert.throws(() => COMMANDS['tab.merge'].validate({
    source_tab_id: tabId,
    source_expected_version: 2,
    target_tab_id: tabId,
    target_expected_version: 1
  }), /target_tab_id/)

  const merge = COMMANDS['tab.merge'].validate({
    source_tab_id: tabId,
    source_expected_version: 2,
    target_tab_id: randomUUID(),
    target_expected_version: 1,
    approval_id: randomUUID(),
    reason: 'combine checks'
  })
  assert.equal(merge.source_expected_version, 2)
  assert.equal(merge.target_expected_version, 1)
})
