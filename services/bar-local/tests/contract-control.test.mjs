import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('control contracts require management and versioned evidence', () => {
  for (const name of ['control.checklist.start', 'control.checklist.item.set', 'control.incident.log', 'control.incident.resolve']) {
    assert.equal(COMMANDS[name].version, 1)
    assert.equal(COMMANDS[name].capability, CAPABILITIES.POS_MANAGE)
    assert.equal(COMMANDS[name].approval, null)
  }
  for (const name of ['control.templates.list', 'control.checklists.list', 'control.checklist.get', 'control.incidents.list']) {
    assert.equal(QUERIES[name].capability, CAPABILITIES.POS_MANAGE)
  }

  const start = COMMANDS['control.checklist.start'].validate({ template_key: 'bar.opening' })
  assert.equal(start.template_key, 'bar.opening')
  assert.equal(start.checklist_date, null)
  assert.throws(() => COMMANDS['control.checklist.start'].validate({ template_key: 'Bad Key' }), /template_key/)

  const checklistId = randomUUID()
  const itemId = randomUUID()
  const set = COMMANDS['control.checklist.item.set'].validate({
    checklist_id: checklistId,
    item_id: itemId,
    completed: true,
    note: 'Verified',
    expected_version: 2
  })
  assert.equal(set.expected_version, 2)
  assert.throws(() => COMMANDS['control.checklist.item.set'].validate({
    checklist_id: checklistId, item_id: itemId, completed: true, expected_version: 0
  }), /expected_version/)

  const incident = COMMANDS['control.incident.log'].validate({
    category: 'Safety',
    severity: 'high',
    description: 'Broken glass',
    immediate_action: 'Area cleared'
  })
  assert.equal(incident.severity, 'high')
  assert.equal(incident.incident_date, null)
  assert.throws(() => COMMANDS['control.incident.log'].validate({
    category: 'Safety', severity: 'urgent', description: 'Broken glass'
  }), /severity/)

  const resolved = COMMANDS['control.incident.resolve'].validate({
    incident_id: randomUUID(), expected_version: 1, resolution: 'Removed safely'
  })
  assert.equal(resolved.expected_version, 1)
  assert.throws(() => COMMANDS['control.incident.resolve'].validate({
    incident_id: randomUUID(), expected_version: 1, resolution: ''
  }), /resolution/)
})
