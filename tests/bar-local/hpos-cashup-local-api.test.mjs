import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposCashupApi, createLocalHposMyCashupApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposCashupApi.js'

const envelope = (data, { next_cursor = null, has_more = false } = {}) => ({
  data,
  pagination: { next_cursor, has_more },
  snapshot_watermark: 12,
  scope: { business_id: 'business', outlet_id: 'outlet', actor_staff_id: 'manager', role: 'owner', device_id: 'device' },
  as_of: '2026-11-05T10:00:00.000Z',
  complete: true,
  unavailable: []
})

test('established Cash & Close adapter loads a complete local queue and commits approved review under the same operation ID', async () => {
  const calls = []
  const bridge = {
    async getOpenIntents() { return [] },
    async retryOperation() { throw new Error('No saved review should be retried') },
    async query(name, filters) {
      calls.push(['query', name, filters])
      if (filters.cursor) return envelope([])
      return envelope([{
        cashup_id: 'cashup-1', shift_id: 'shift-1', staff_id: 'cashier-1', cashier_name: 'Cashier One',
        counted_cash: '18.25', expected_cash: '20.00', variance: '-1.75', counted_card: '0.00', status: 'submitted',
        notes: 'Counted', submitted_at: '2026-11-05T09:00:00.000Z', proof_refs: [], business_date: '2026-11-05'
      }], { next_cursor: 'cashup-1', has_more: true })
    },
    async requestApprovalForCommand(request) {
      calls.push(['approval', request])
      return { approval_id: 'approval-1' }
    },
    async command(request) {
      calls.push(['command', request])
      return { outcome: 'committed_local', result: { cashup_id: 'cashup-1', status: 'approved' } }
    }
  }
  const api = createLocalHposCashupApi(bridge, { outletId: 'outlet', outletName: 'Main Bar' })
  const rows = await api.listPending()
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].counted_by_method, { cash: '18.25', card: '0.00' })
  assert.equal(rows[0].expected_cash_drawer, '20.00')
  assert.equal(calls.filter(([type]) => type === 'query').length, 2)

  const result = await api.review({ cashupId: 'cashup-1', decision: 'approved', reason: '', pin: '1234', operationId: 'operation-1' })
  assert.equal(result.outcome, 'committed_local')
  const approval = calls.find(([type]) => type === 'approval')[1]
  const command = calls.find(([type]) => type === 'command')[1]
  assert.equal(approval.command, 'cashup.review')
  assert.equal(approval.operation_id, 'operation-1')
  assert.equal(approval.payload.decision, 'approved')
  assert.equal(command.operation_id, 'operation-1')
  assert.equal(command.payload.approval_id, 'approval-1')
})

test('local cash-up review refuses an incomplete query and a rejected decision without reason', async () => {
  const bridge = {
    async getOpenIntents() { return [] },
    async retryOperation() { throw new Error('No saved review should be retried') },
    async query() { return { data: [], complete: false } },
    async requestApprovalForCommand() { throw new Error('approval should not be requested') },
    async command() { throw new Error('command should not be sent') }
  }
  const api = createLocalHposCashupApi(bridge, { outletId: 'outlet' })
  await assert.rejects(api.listPending(), /incomplete|snapshot|pagination/i)
  await assert.rejects(api.review({ cashupId: 'cashup-1', decision: 'rejected', reason: '', pin: '1234', operationId: 'operation-1' }), /correction note/i)
})

test('an uncertain review retries the exact durable operation without issuing another approval', async () => {
  const calls = []
  const bridge = {
    async query() { return envelope([]) },
    async getOpenIntents() { return [] },
    async requestApprovalForCommand(request) { calls.push(['approval', request]); return { approval_id: 'approval-1' } },
    async command(request) { calls.push(['command', request]); return { outcome: 'unknown', error: { message: 'Reply was lost' } } },
    async retryOperation(id) { calls.push(['retry', id]); return { outcome: 'committed_local' } }
  }
  const api = createLocalHposCashupApi(bridge, { outletId: 'outlet' })
  const request = { cashupId: 'cashup-1', decision: 'approved', reason: '', pin: '1234', operationId: 'operation-1' }
  await assert.rejects(api.review(request), /Reply was lost/)
  assert.equal((await api.review(request)).outcome, 'committed_local')
  assert.equal(calls.filter(([kind]) => kind === 'approval').length, 1)
  assert.equal(calls.filter(([kind]) => kind === 'command').length, 1)
  assert.deepEqual(calls.at(-1), ['retry', 'operation-1'])
})

test('after a renderer restart saved reviews are discoverable and recover only through their original operation', async () => {
  const calls = []
  const bridge = {
    async query() { return envelope([]) },
    async getOpenIntents() { return [{ command: 'cashup.review', operation_id: 'saved-1', state: 'uncertain' }] },
    async requestApprovalForCommand() { throw new Error('A saved review must not receive a new approval') },
    async command() { throw new Error('A saved review must not create a new command') },
    async retryOperation(id) { calls.push(id); return { outcome: 'committed_local' } }
  }
  const api = createLocalHposCashupApi(bridge, { outletId: 'outlet' })
  assert.equal((await api.listRecovery())[0].operation_id, 'saved-1')
  assert.equal((await api.recover('saved-1')).outcome, 'committed_local')
  assert.deepEqual(calls, ['saved-1'])
})

test('My Cash-up reads only its authenticated staff projection and sends an exact blind count in one command', async () => {
  const calls = []
  const bridge = {
    async query(name, filters) {
      calls.push(['query', name, filters])
      return envelope({ shift: { id: 'shift-1', staff_id: 'manager', version: 1, opening_float: '10.00', status: 'open' }, submission: null })
    },
    async getOpenIntents() { return [] },
    async command(request) { calls.push(['command', request]); return { outcome: 'committed_local' } },
    async retryOperation(id) { calls.push(['retry', id]); return { outcome: 'committed_local' } }
  }
  const api = createLocalHposMyCashupApi(bridge, { outletId: 'outlet', staffId: 'manager' })
  assert.equal((await api.readMine()).shift.id, 'shift-1')
  await api.submit({ shiftId: 'shift-1', shiftVersion: 1, countedCash: '0.10', notes: 'Count', operationId: 'handover-1' })
  const command = calls.find(([kind]) => kind === 'command')[1]
  assert.equal(command.command, 'cashup.handover')
  assert.deepEqual(command.payload, { shift_id: 'shift-1', expected_shift_version: 1, counted_cash: '0.10', notes: 'Count' })
  const otherStaff = createLocalHposMyCashupApi(bridge, { outletId: 'outlet', staffId: 'other-staff' })
  await assert.rejects(otherStaff.readMine(), /different session/)
})
