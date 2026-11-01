import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

test('control checklists preserve evidence and incidents resolve once', async (t) => {
  const h = await createHarness(t)
  const date = await businessDate(h)

  const templates = await h.query('control.templates.list')
  assert.equal(templates.data.length, 4)
  const opening = templates.data.find((template) => template.template_key === 'bar.opening')
  assert.equal(opening.items.length, 4)

  const startEnvelope = h.envelope('control.checklist.start', {
    template_key: 'bar.opening',
    checklist_date: date
  })
  const started = await h.call('cmd_control_checklist_start', startEnvelope)
  assert.equal(started.ok, true, JSON.stringify(started.error))
  assert.equal(started.result.status, 'open')
  assert.equal(started.result.version, 1)
  assert.equal(started.result.items.length, 4)
  assert.equal(started.result.items.every((item) => item.completed === false), true)
  const checklistId = started.result.checklist_id

  const replay = await h.call('cmd_control_checklist_start', startEnvelope)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.checklist_id, checklistId)

  const firstItem = started.result.items[0]
  const completed = await h.call('cmd_control_checklist_item_set', h.envelope('control.checklist.item.set', {
    checklist_id: checklistId,
    item_id: firstItem.item_id,
    completed: true,
    note: 'Checked at opening',
    expected_version: 1
  }))
  assert.equal(completed.ok, true, JSON.stringify(completed.error))
  assert.equal(completed.result.version, 2)
  assert.equal(completed.result.status, 'open')

  const stale = await h.call('cmd_control_checklist_item_set', h.envelope('control.checklist.item.set', {
    checklist_id: checklistId,
    item_id: started.result.items[1].item_id,
    completed: true,
    expected_version: 1
  }))
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'CHECKLIST_VERSION_CONFLICT')

  let current = completed.result
  for (const item of started.result.items.slice(1)) {
    const result = await h.call('cmd_control_checklist_item_set', h.envelope('control.checklist.item.set', {
      checklist_id: checklistId,
      item_id: item.item_id,
      completed: true,
      expected_version: current.version
    }))
    assert.equal(result.ok, true, JSON.stringify(result.error))
    current = result.result
  }
  assert.equal(current.status, 'completed')
  assert.ok(current.completed_at)
  assert.equal(current.items.every((item) => item.completed), true)

  const reopened = await h.call('cmd_control_checklist_item_set', h.envelope('control.checklist.item.set', {
    checklist_id: checklistId,
    item_id: firstItem.item_id,
    completed: false,
    note: 'Need to recheck glassware',
    expected_version: current.version
  }))
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error))
  assert.equal(reopened.result.status, 'open')
  assert.equal(reopened.result.completed_at, null)

  const listed = await h.query('control.checklists.list', { from: date, to: date, template_key: 'bar.opening' })
  assert.equal(listed.data.length, 1)
  assert.equal(listed.data[0].checklist_id, checklistId)
  assert.equal(listed.data[0].items.length, 4)

  const detail = await h.query('control.checklist.get', { checklist_id: checklistId })
  assert.equal(detail.data.checklist_id, checklistId)
  assert.equal(detail.data.status, 'open')

  const incident = await h.call('cmd_control_incident_log', h.envelope('control.incident.log', {
    incident_date: date,
    category: 'Safety',
    severity: 'high',
    description: 'Broken glass near the service station',
    immediate_action: 'Area cleared and swept'
  }))
  assert.equal(incident.ok, true, JSON.stringify(incident.error))
  assert.equal(incident.result.status, 'open')
  assert.equal(incident.result.version, 1)
  const incidentId = incident.result.id

  const staleResolve = await h.call('cmd_control_incident_resolve', h.envelope('control.incident.resolve', {
    incident_id: incidentId,
    expected_version: 99,
    resolution: 'Removed and disposed safely'
  }))
  assert.equal(staleResolve.ok, false)
  assert.equal(staleResolve.error.code, 'INCIDENT_VERSION_CONFLICT')

  const resolved = await h.call('cmd_control_incident_resolve', h.envelope('control.incident.resolve', {
    incident_id: incidentId,
    expected_version: 1,
    resolution: 'Removed and disposed safely'
  }))
  assert.equal(resolved.ok, true, JSON.stringify(resolved.error))
  assert.equal(resolved.result.status, 'resolved')
  assert.equal(resolved.result.version, 2)
  assert.ok(resolved.result.resolved_at)

  const duplicateResolve = await h.call('cmd_control_incident_resolve', h.envelope('control.incident.resolve', {
    incident_id: incidentId,
    expected_version: 2,
    resolution: 'Resolved again'
  }))
  assert.equal(duplicateResolve.ok, false)
  assert.equal(duplicateResolve.error.code, 'INCIDENT_STATE_CONFLICT')

  const incidents = await h.query('control.incidents.list', { from: date, to: date, status: 'resolved' })
  assert.equal(incidents.data.length, 1)
  assert.equal(incidents.data[0].id, incidentId)
  assert.equal(incidents.data[0].severity, 'high')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'control.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'control.checklist.started',
    'control.checklist.item.updated',
    'control.checklist.item.updated',
    'control.checklist.item.updated',
    'control.checklist.item.updated',
    'control.checklist.item.updated',
    'control.incident.logged',
    'control.incident.resolved'
  ])
})
