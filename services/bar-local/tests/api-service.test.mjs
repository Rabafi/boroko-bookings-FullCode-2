import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

test('local Bar HTTP service commissions, trades, replays and enforces approvals', async (t) => {
  const h = await createApiHarness(t)
  const live = await h.request('/v1/health/live', { method: 'GET' })
  assert.equal(live.status, 200)
  assert.equal(live.body.ok, true)

  const unauth = await h.request('/v1/commands', { body: { command: 'sale.commit' } })
  assert.equal(unauth.status, 401)
  assert.equal(unauth.body.code, 'AUTH_REQUIRED')

  const wrongSecret = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: 'wrong-secret-0123456789',
      business_name: 'API Test Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner API',
      pin: '1234',
      device_name: 'Till API'
    }
  })
  assert.equal(wrongSecret.status, 401)
  assert.equal(wrongSecret.body.code, 'SETUP_SECRET_INVALID')

  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'API Test Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner API',
      pin: '1234',
      currency: 'BWP',
      timezone: 'Africa/Gaborone',
      device_name: 'Till API',
      device_platform: 'modern'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  assert.equal(setup.body.ok, true)
  assert.equal(setup.body.outcome, 'commissioned_local')
  assert.equal(setup.body.device_token, undefined, 'the service must not return a raw device credential')
  assert.match(setup.stagedDeviceToken, /^bld_/)
  assert.equal(setup.body.authority_epoch, 1)
  assert.equal(typeof setup.body.device_id, 'string')

  const repeatSetup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Again',
      outlet_name: 'Again',
      owner_name: 'Again',
      pin: '1234',
      device_name: 'Again'
    }
  })
  assert.equal(repeatSetup.status, 409)
  assert.equal(repeatSetup.body.code, 'AUTHORITY_ALREADY_COMMISSIONED')

  const deviceId = setup.body.device_id
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  assert.equal(login.body.ok, true)
  assert.match(login.body.session_token, /^bls_/)
  assert.equal(login.body.staff.role, 'owner')
  const ownerToken = login.body.session_token

  const scope = {
    authority_id: setup.body.authority_id,
    authority_epoch: setup.body.authority_epoch,
    business_id: setup.body.business_id,
    outlet_id: setup.body.outlet_id,
    device_id: deviceId
  }
  const envelope = (command, payload, operationId = randomUUID()) => ({
    contract_version: 1,
    operation_id: operationId,
    command,
    ...scope,
    payload
  })
  const auth = { token: ownerToken, deviceId }

  const duplicateKeys = await h.request('/v1/commands', {
    ...auth,
    rawBody: '{"command":"sale.commit","command":"sale.void"}'
  })
  assert.equal(duplicateKeys.status, 400, JSON.stringify(duplicateKeys.body))
  assert.match(duplicateKeys.body.message, /duplicate object key/i)

  const earlyReady = await h.request('/v1/health/ready', { method: 'GET', ...auth })
  assert.equal(earlyReady.status, 503)
  assert.equal(earlyReady.body.ready, false)
  assert.deepEqual(earlyReady.body.blockers, ['empty_catalogue'])

  const catalogueEnvelope = envelope('catalogue.upsert', {
    sku: 'BEER-330',
    name: 'Local Beer 330ml',
    category: 'Beer',
    price: '10.00',
    tax_rate: '0',
    track_stock: false
  })
  const catalogue = await h.request('/v1/commands', { ...auth, body: catalogueEnvelope })
  assert.equal(catalogue.status, 200, JSON.stringify(catalogue.body))
  assert.equal(catalogue.body.ok, true, JSON.stringify(catalogue.body.error))
  assert.equal(catalogue.body.outcome, 'committed_local')
  const productId = catalogue.body.result.product_id
  assert.equal(typeof productId, 'string')

  const shiftEnvelope = envelope('shift.open', { opening_float: '100.00' })
  const shift = await h.request('/v1/commands', { ...auth, body: shiftEnvelope })
  assert.equal(shift.body.ok, true, JSON.stringify(shift.body.error))
  const shiftId = shift.body.result.shift_id

  const saleEnvelope = envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '2' }],
    tenders: [{ method: 'cash', amount: '20.00', tendered: '20.00' }]
  })
  const sale = await h.request('/v1/commands', { ...auth, body: saleEnvelope })
  assert.equal(sale.status, 200, JSON.stringify(sale.body))
  assert.equal(sale.body.ok, true, JSON.stringify(sale.body.error))
  assert.equal(sale.body.result.receipt.total, 20)
  assert.equal(sale.body.result.receipt.lines.length, 1)
  const saleId = sale.body.result.sale_id
  const saleLineId = sale.body.result.receipt.lines[0].sale_line_id
  const receiptNumber = sale.body.result.receipt.receipt_number

  const replay = await h.request('/v1/commands', { ...auth, body: saleEnvelope })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.ok, true)
  assert.equal(replay.body.replayed, true)
  assert.equal(replay.body.receipt.receipt_number, receiptNumber)

  const conflictEnvelope = {
    ...saleEnvelope,
    payload: { ...saleEnvelope.payload, items: [{ product_id: productId, quantity: '1' }] }
  }
  const conflict = await h.request('/v1/commands', { ...auth, body: conflictEnvelope })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT')

  const receiptQuery = await h.request('/v1/queries/sale.get', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: { sale_id: saleId }
    }
  })
  assert.equal(receiptQuery.status, 200, JSON.stringify(receiptQuery.body))
  assert.equal(receiptQuery.body.ok, true)
  assert.equal(receiptQuery.body.query, 'sale.get')
  assert.equal(receiptQuery.body.data.receipt_number, receiptNumber)
  assert.equal(receiptQuery.body.data.lines[0].sale_line_id, saleLineId)
  assert.equal(receiptQuery.body.complete, true)
  assert.deepEqual(receiptQuery.body.unavailable, [])
  assert.equal(typeof receiptQuery.body.snapshot_watermark, 'number')
  assert.equal(receiptQuery.body.scope.actor_staff_id, setup.body.owner_staff_id)
  assert.equal(receiptQuery.body.scope.outlet_id, setup.body.outlet_id)

  const status = await h.request(`/v1/operations/${saleEnvelope.operation_id}`, { method: 'GET', ...auth })
  assert.equal(status.status, 200)
  assert.equal(status.body.status, 'committed')
  assert.equal(status.body.receipt.total, 20)

  const staffCreateId = randomUUID()
  const staffEnvelope = envelope('staff.create', {
    display_name: 'Manager API',
    role: 'manager',
    pin: '5678'
  }, staffCreateId)
  const staffCreate = await h.request('/v1/commands', { ...auth, body: staffEnvelope })
  assert.equal(staffCreate.status, 200, JSON.stringify(staffCreate.body))
  assert.equal(staffCreate.body.ok, true, JSON.stringify(staffCreate.body.error))
  const managerStaffId = staffCreate.body.result.staff_id
  const stored = await h.migrator.query('SELECT payload FROM bar_local.operations WHERE operation_id = $1', [staffCreateId])
  assert.equal(stored.rows[0].payload.pin, undefined)
  assert.equal(stored.rows[0].payload.display_name, 'Manager API')

  const ownerEscalation = await h.request('/v1/commands', {
    ...auth,
    body: envelope('staff.create', {
      display_name: 'Escalated Owner', role: 'owner', pin: '6789',
      capabilities: ['pos.view', 'staff.manage', 'accounting.approve', 'backup.manage']
    })
  })
  assert.equal(ownerEscalation.status, 200, JSON.stringify(ownerEscalation.body))
  assert.equal(ownerEscalation.body.ok, false)
  assert.equal(ownerEscalation.body.error.code, 'ROLE_NOT_DELEGABLE')

  const cashierEscalation = await h.request('/v1/commands', {
    ...auth,
    body: envelope('staff.create', {
      display_name: 'Escalated Cashier', role: 'cashier', pin: '6780',
      capabilities: ['pos.view', 'staff.manage', 'accounting.approve']
    })
  })
  assert.equal(cashierEscalation.status, 200, JSON.stringify(cashierEscalation.body))
  assert.equal(cashierEscalation.body.ok, false)
  assert.equal(cashierEscalation.body.error.code, 'CAPABILITY_DENIED')

  const managerLogin = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { staff_id: managerStaffId, pin: '5678' }
  })
  assert.equal(managerLogin.status, 201, JSON.stringify(managerLogin.body))
  const managerToken = managerLogin.body.session_token

  const returnEnvelope = envelope('sale.return', {
    sale_id: saleId,
    reason: 'Customer changed mind',
    lines: [{ sale_line_id: saleLineId, quantity: '1' }],
    disposition: 'restock'
  })
  const approval = await h.request('/v1/approvals', {
    token: managerToken,
    deviceId,
    body: {
      operation: returnEnvelope,
      capability: 'pos.void',
      pin: '5678',
      target_type: 'sale',
      target_id: saleId
    }
  })
  assert.equal(approval.status, 201, JSON.stringify(approval.body))
  assert.equal(approval.body.ok, true)
  assert.equal(typeof approval.body.approval_id, 'string')
  returnEnvelope.payload.approval_id = approval.body.approval_id

  const returned = await h.request('/v1/commands', { ...auth, body: returnEnvelope })
  assert.equal(returned.status, 200, JSON.stringify(returned.body))
  assert.equal(returned.body.ok, true, JSON.stringify(returned.body.error))
  assert.equal(returned.body.result.total, -10)

  const ownerReturn = envelope('sale.return', {
    sale_id: saleId,
    reason: 'Second return attempt',
    lines: [{ sale_line_id: saleLineId, quantity: '1' }],
    disposition: 'restock'
  })
  const ownerApproval = await h.request('/v1/approvals', {
    ...auth,
    body: {
      operation: ownerReturn,
      capability: 'pos.void',
      pin: '1234'
    }
  })
  assert.equal(ownerApproval.status, 201, JSON.stringify(ownerApproval.body))
  ownerReturn.payload.approval_id = ownerApproval.body.approval_id
  const makerChecker = await h.request('/v1/commands', { ...auth, body: ownerReturn })
  assert.equal(makerChecker.status, 200)
  assert.equal(makerChecker.body.ok, false)
  assert.equal(makerChecker.body.error.code, 'MAKER_CHECKER_VIOLATION')

  const pairing = await h.request('/v1/pairing/start', { ...auth, body: {} })
  assert.equal(pairing.status, 201, JSON.stringify(pairing.body))
  assert.match(pairing.body.pairing_code, /^\d{8}$/)
  assert.equal(pairing.body.server_certificate_fingerprint, null, 'the loopback test server has no TLS certificate')

  const paired = await h.request('/v1/pairing/complete', {
    body: { pairing_code: pairing.body.pairing_code, name: 'Legacy Till 2', platform: 'legacy' }
  })
  assert.equal(paired.status, 201, JSON.stringify(paired.body))
  assert.equal(paired.body.ok, true)
  assert.equal(typeof paired.body.device_id, 'string')
  assert.equal(paired.body.authority_id, setup.body.authority_id)
  assert.equal(paired.body.authority_epoch, setup.body.authority_epoch)
  assert.equal(paired.body.business_id, setup.body.business_id)
  assert.equal(paired.body.outlet_id, setup.body.outlet_id)
  const secondDeviceId = paired.body.device_id

  const secondLogin = await h.request('/v1/sessions', {
    deviceToken: paired.stagedDeviceToken,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(secondLogin.status, 201, JSON.stringify(secondLogin.body))
  const secondToken = secondLogin.body.session_token
  const secondSessionId = secondLogin.body.session_id

  const refresh = await h.request('/v1/sessions/refresh', {
    token: secondToken,
    deviceId: secondDeviceId,
    body: {}
  })
  assert.equal(refresh.status, 200, JSON.stringify(refresh.body))
  const refreshedToken = refresh.body.session_token
  assert.notEqual(refreshedToken, secondToken)

  const stale = await h.request('/v1/health/ready', { method: 'GET', token: secondToken, deviceId: secondDeviceId })
  assert.equal(stale.status, 401)
  const fresh = await h.request('/v1/health/ready', { method: 'GET', token: refreshedToken, deviceId: secondDeviceId })
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body))
  assert.equal(fresh.body.ready, true)

  const revoke = await h.request('/v1/sessions/revoke', {
    ...auth,
    body: { session_id: secondSessionId }
  })
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body))
  const revoked = await h.request('/v1/health/ready', { method: 'GET', token: refreshedToken, deviceId: secondDeviceId })
  assert.equal(revoked.status, 401)

  const outbox = await h.request('/v1/queries/outbox.status', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: {}
    }
  })
  assert.equal(outbox.status, 200, JSON.stringify(outbox.body))
  assert.equal(outbox.body.data.cloud_transport, 'disabled')
  assert.equal(outbox.body.scope.business_id, scope.business_id)
  assert.equal(outbox.body.scope.outlet_id, scope.outlet_id)
  assert.equal(outbox.body.data.pending_events >= 3, true)
  assert.equal(outbox.body.data.latest_commit_sequence >= 3, true)

  const eventCommit = await h.migrator.query(`
    UPDATE bar_local.authority_counter
       SET commit_sequence = GREATEST(commit_sequence, (SELECT COALESCE(max(commit_sequence), 0) FROM bar_local.outbox)) + 1
     WHERE singleton
     RETURNING commit_sequence
  `)
  const eventSequence = eventCommit.rows[0].commit_sequence
  const eventOperationId = randomUUID()
  await h.migrator.query(`
    INSERT INTO bar_local.outbox (commit_sequence, event_index, business_id, outlet_id, event_type, operation_id, authority_epoch, payload, payload_hash)
    VALUES ($1, 0, $2, $3, 'test.first', $4, 1, '{}'::jsonb, repeat('a', 64)),
           ($1, 1, $2, $3, 'test.second', $4, 1, '{}'::jsonb, repeat('b', 64))
  `, [eventSequence, setup.body.business_id, setup.body.outlet_id, eventOperationId])

  const oneCommitPage = await h.request(`/v1/events?after=${Number(eventSequence) - 1}&limit=1`, { method: 'GET', ...auth })
  assert.equal(oneCommitPage.status, 200, JSON.stringify(oneCommitPage.body))
  assert.equal(oneCommitPage.body.event_count, 2, 'a commit cursor page must include every event in its commit group')
  assert.deepEqual(oneCommitPage.body.events.map((event) => event.event_type), ['test.first', 'test.second'])
  assert.equal(oneCommitPage.body.next_cursor, Number(eventSequence))

  const otherOutletId = randomUUID()
  await h.migrator.query(`INSERT INTO bar_local.outlets (id, business_id, name, code) VALUES ($1, $2, 'Other Outlet', 'OTHER')`, [otherOutletId, setup.body.business_id])
  const otherOutletSequence = Number(eventSequence) + 1
  await h.migrator.query('UPDATE bar_local.authority_counter SET commit_sequence = $1 WHERE singleton', [otherOutletSequence])
  await h.migrator.query(`
    INSERT INTO bar_local.outbox (commit_sequence, event_index, business_id, outlet_id, event_type, operation_id, authority_epoch, payload, payload_hash)
    VALUES ($1, 0, $2, $3, 'other.outlet.only', $4, 1, '{}'::jsonb, repeat('c', 64))
  `, [otherOutletSequence, setup.body.business_id, otherOutletId, randomUUID()])
  const outletCatchup = await h.request(`/v1/events?after=${Number(eventSequence)}&limit=1`, { method: 'GET', ...auth })
  assert.equal(outletCatchup.status, 200, JSON.stringify(outletCatchup.body))
  assert.deepEqual(outletCatchup.body.events, [])
  assert.equal(outletCatchup.body.latest_event_sequence, Number(eventSequence), 'another outlet must not advance this outlet event cursor')
  assert.equal(outletCatchup.body.complete, true)

  const events = await h.request('/v1/events?after=0&limit=100', { method: 'GET', ...auth })
  assert.equal(events.status, 200, JSON.stringify(events.body))
  assert.equal(events.body.event_count >= 4, true)
  assert.equal(events.body.complete, true)
  assert.equal(events.body.gap_detected, false)
  const eventTypes = new Set(events.body.events.map((event) => event.event_type))
  assert.equal(eventTypes.has('catalogue.upsert'), true)
  assert.equal(eventTypes.has('sale.committed'), true)
  assert.equal(eventTypes.has('sale.returned'), true)
  assert.equal(eventTypes.has('staff.created'), true)
  assert.equal(events.body.next_cursor, events.body.events.at(-1).commit_sequence)

  const badCursor = await h.request('/v1/events?after=-1', { method: 'GET', ...auth })
  assert.equal(badCursor.status, 400)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await h.request('/v1/sessions', {
      deviceToken: paired.stagedDeviceToken,
      body: { staff_id: managerStaffId, pin: '0000' }
    })
    assert.equal(failedLogin.status, 401, JSON.stringify(failedLogin.body))
  }
  const lockedLogin = await h.request('/v1/sessions', {
    deviceToken: paired.stagedDeviceToken,
    body: { staff_id: managerStaffId, pin: '5678' }
  })
  assert.equal(lockedLogin.status, 429, JSON.stringify(lockedLogin.body))
  assert.equal(lockedLogin.body.code, 'ACCOUNT_LOCKED')
  assert.equal(typeof lockedLogin.body.details.retry_after_seconds, 'number')

  await h.migrator.query('UPDATE bar_local.staff SET locked_until = NULL, failed_login_attempts = 0 WHERE id = $1', [managerStaffId])
  const unlockedLogin = await h.request('/v1/sessions', {
    deviceToken: paired.stagedDeviceToken,
    body: { staff_id: managerStaffId, pin: '5678' }
  })
  assert.equal(unlockedLogin.status, 201, JSON.stringify(unlockedLogin.body))

  const devices = await h.request('/v1/devices', { method: 'GET', ...auth })
  assert.equal(devices.status, 200, JSON.stringify(devices.body))
  assert.equal(devices.body.devices.length, 2)
  assert.equal(devices.body.devices.find((device) => device.device_id === deviceId).is_current, true)

  const selfRevoke = await h.request('/v1/devices/revoke', { ...auth, body: { device_id: deviceId } })
  assert.equal(selfRevoke.status, 400, JSON.stringify(selfRevoke.body))
  assert.equal(selfRevoke.body.code, 'VALIDATION_FAILED')

  const revokeDevice = await h.request('/v1/devices/revoke', { ...auth, body: { device_id: secondDeviceId } })
  assert.equal(revokeDevice.status, 200, JSON.stringify(revokeDevice.body))
  assert.equal(revokeDevice.body.outcome, 'device_revoked')

  const revokedDeviceLogin = await h.request('/v1/sessions', {
    deviceToken: paired.stagedDeviceToken,
    body: { staff_id: managerStaffId, pin: '5678' }
  })
  assert.equal(revokedDeviceLogin.status, 401, JSON.stringify(revokedDeviceLogin.body))
  assert.equal(revokedDeviceLogin.body.code, 'DEVICE_REVOKED')

  const ownerTokenHash = createHash('sha256').update(ownerToken, 'utf8').digest('hex')
  const existingEntitlement = await h.migrator.query('SELECT entitlement_features FROM bar_local.authority WHERE singleton')
  const entitlementFeatures = [...new Set([
    ...(existingEntitlement.rows[0]?.entitlement_features || []),
    'bar_accounting_workforce'
  ])]
  await h.migrator.query('SELECT bar_local.service_set_entitlement($1,$2,$3,$4,$5)', [
    ownerTokenHash, deviceId, 1, entitlementFeatures, 'api-tip-payout-test'
  ])
  const tipPayouts = await h.request('/v1/queries/workforce.tip_payouts', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: {}
    }
  })
  assert.equal(tipPayouts.status, 200, JSON.stringify(tipPayouts.body))
  assert.equal(tipPayouts.body.ok, true)
  assert.equal(tipPayouts.body.scope.role, 'owner')
  assert.equal(tipPayouts.body.scope.actor_staff_id, setup.body.owner_staff_id)
  assert.deepEqual(tipPayouts.body.data, [])
})
