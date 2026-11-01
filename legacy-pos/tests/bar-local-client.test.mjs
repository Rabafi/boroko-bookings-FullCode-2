import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'http';
import { IntentJournal, classifyLegacyWorkItem, operationPayloadHash } from '../src/main/bar-local/intents.js';
import {
  ALLOWED_COMMANDS,
  ALLOWED_QUERIES,
  completeLegacyBarPairing,
  createLegacyBarLocalTransport,
  LegacyBarLocalClient
} from '../src/main/bar-local/client.js';

const scope = Object.freeze({
  authority_id: 'a1000000-0000-4000-8000-000000000001',
  authority_epoch: 1,
  business_id: 'b1000000-0000-4000-8000-000000000001',
  outlet_id: 'c1000000-0000-4000-8000-000000000001',
  device_id: 'd1000000-0000-4000-8000-000000000001',
  deviceToken: 'local-device-token-for-legacy-test'
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-bar-local-client-'));
  const journal = new IntentJournal({ filePath: join(dir, 'intents.jsonl') });
  return { dir, journal, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Legacy retains the original operation when both commit and uncertainty checkpoints fail', async () => {
  const env=setup()
  let sentId=null
  const transport={request:async(_method,path,options)=>{
    if(path==='/v1/sessions') return {status:201,body:{ok:true,session_token:'local-session-token-1234567890',session_id:'e1000000-0000-4000-8000-000000000001',authority_epoch:1,business_id:scope.business_id,outlet_id:scope.outlet_id,staff:{id:'f1000000-0000-4000-8000-000000000001'}}}
    sentId=options.body.operation_id
    return {status:200,body:{ok:true,outcome:'committed_local',operation_id:sentId,receipt:validReceipt(sentId),result:{shift_id:'synthetic-shift'}}}
  },close(){}}
  try{
    const client=new LegacyBarLocalClient({scope,journal:env.journal,transport})
    await client.login('f1000000-0000-4000-8000-000000000001','482915')
    env.journal.markCommitted=()=>{throw new Error('Synthetic commit checkpoint failure')}
    env.journal.markUncertain=()=>{throw new Error('Synthetic uncertainty checkpoint failure')}
    await assert.rejects(client.command('shift.open',{opening_float:'0.00'}),error=>error.outcome_unknown===true && error.operation_id===sentId && error.retry_same_operation===true)
    assert.equal(env.journal.listIntents().length,1)
    assert.equal(env.journal.listIntents()[0].operation_id,sentId)
  }finally{env.cleanup()}
})

function validReceipt(operationId, overrides = {}) {
  return {
    operation_id: operationId, outcome: 'committed_local', authority_id: scope.authority_id,
    authority_epoch: scope.authority_epoch, business_id: scope.business_id, outlet_id: scope.outlet_id,
    device_id: scope.device_id, actor_staff_id: 'f1000000-0000-4000-8000-000000000001',
    commit_sequence: 1, business_date: '2026-10-20', server_committed_at: '2026-10-20T10:00:00.000Z',
    cloud_status: 'integration_disabled', ...overrides
  };
}

test('Legacy client persists an intent before dispatch and retries the exact original envelope', async () => {
  const env = setup();
  const requests = [];
  let attempts = 0;
  const transport = {
    request: async (method, path, options) => {
      requests.push({ method, path, options });
      if (path === '/v1/sessions') return { status: 201, body: {
        ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
        authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' }
      } };
      attempts += 1;
      if (attempts === 1) return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', outcome: 'unknown' } };
      return { status: 200, body: {
        ok: true, outcome: 'committed_local', replayed: true, operation_id: options.body.operation_id,
        receipt: validReceipt(options.body.operation_id), result: { sale_id: 'sale-1' }
      } };
    },
    close() {}
  };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    await assert.rejects(client.command('sale.commit', { shift_id: 'shift-1', items: [] }), {
      code: 'SERVICE_UNAVAILABLE', retry_same_operation: true, outcome_unknown: true
    });
    const intent = env.journal.listIntents()[0];
    assert.equal(intent.state, 'uncertain');
    assert.equal(requests[1].options.body.operation_id, intent.operation_id);
    assert.equal(requests[1].options.body.authority_id, scope.authority_id);
    const outcome = await client.retry(intent.operation_id);
    assert.equal(outcome.outcome, 'committed_local');
    assert.equal(env.journal.getIntent(intent.operation_id).state, 'committed');
    assert.deepEqual(requests[1].options.body, requests[2].options.body);
  } finally {
    env.cleanup();
  }
});

test('Legacy client refuses same-key payload changes and cross-scope login results', async () => {
  const env = setup();
  let mismatch = false;
  const transport = {
    request: async (method, path, options) => {
      if (path === '/v1/sessions') return { status: 201, body: {
        ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
        authority_epoch: 1, business_id: mismatch ? 'b2000000-0000-4000-8000-000000000002' : scope.business_id,
        outlet_id: scope.outlet_id, staff: { id: options.body.staff_id }
      } };
      return { status: 200, body: { ok: true, outcome: 'committed_local', operation_id: options.body.operation_id,
        receipt: validReceipt(options.body.operation_id), result: { sale_id: 'sale-1' } } };
    },
    close() {}
  };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    mismatch = true;
    await assert.rejects(client.login('f1000000-0000-4000-8000-000000000001', '482915'), { code: 'WRONG_AUTHORITY' });
    mismatch = false;
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const operationId = '11111111-1111-4111-8111-111111111111';
    await client.command('sale.commit', { amount: '1.00' }, { operationId });
    await assert.rejects(client.command('sale.commit', { amount: '2.00' }, { operationId }), { code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
  } finally {
    env.cleanup();
  }
});

test('Legacy client records the actual nested command refusal shape as terminal without an operation id', async () => {
  const env = setup();
  const transport = { request: async (_method, path, options) => path === '/v1/sessions'
    ? { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } }
    : { status: 200, body: { ok: false, outcome: 'refused', error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.', retry_same_operation: false, requires_manager: false } } }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const result = await client.command('sale.commit', { shift_id: 'shift-1', items: [] });
    assert.equal(result.outcome, 'refused');
    assert.equal(result.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(env.journal.listIntents()[0].state, 'refused');
    assert.equal(client.journal.listOpenIntents().length, 0);
  } finally { env.cleanup(); }
});

test('Legacy client keeps a mismatched authority receipt unresolved', async () => {
  const env = setup();
  const transport = { request: async (_method, path, options) => path === '/v1/sessions'
    ? { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } }
    : { status: 200, body: { ok: true, outcome: 'committed_local', operation_id: options.body.operation_id,
      receipt: validReceipt(options.body.operation_id, { authority_epoch: 99 }), result: { sale_id: 'sale-1' } } }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    await assert.rejects(client.command('sale.commit', { shift_id: 'shift-1', items: [] }), { code: 'RECEIPT_INVALID', outcome_unknown: true });
    assert.equal(env.journal.listOpenIntents().length, 1);
    assert.equal(env.journal.listOpenIntents()[0].state, 'uncertain');
  } finally { env.cleanup(); }
});

test('Legacy event feed is authenticated, outlet scoped, and requires a safe cursor for gaps', async () => {
  const env = setup();
  const requests = [];
  let gap = false;
  const transport = { request: async (method, path, options) => {
    requests.push({ method, path, options });
    if (path === '/v1/sessions') return { status: 201, body: {
      ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
      authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: options.body.staff_id }
    } };
    return { status: 200, body: {
      ok: true, events: [{ commit_sequence: 8, event_index: 0, event_type: 'catalogue.product.upserted' }],
      next_cursor: 8, gap_detected: gap, ...(gap ? { retention_floor_sequence: 5 } : {}),
      scope: { business_id: scope.business_id, outlet_id: scope.outlet_id, device_id: scope.device_id }
    } };
  }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const feed = await client.events(7, 200);
    assert.equal(feed.next_cursor, 8);
    const eventRequest = requests.at(-1);
    assert.equal(eventRequest.method, 'GET');
    assert.equal(eventRequest.path, '/v1/events');
    assert.equal(eventRequest.options.query.after, '7');
    assert.equal(eventRequest.options.sessionToken, 'local-session-token-1234567890');
    assert.equal(eventRequest.options.deviceId, scope.device_id);
    gap = true;
    assert.equal((await client.events(2, 200)).retention_floor_sequence, 5);
    const crossed = { method: 'GET', path: '/v1/events', options: { query: { after: '2', limit: '200' } } };
    transport.request = async (method, path, options) => path === '/v1/sessions'
      ? { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: options.body.staff_id } } }
      : { status: 200, body: { ok: true, events: [], next_cursor: 3, gap_detected: false, scope: { business_id: 'b2000000-0000-4000-8000-000000000002', outlet_id: scope.outlet_id, device_id: scope.device_id } } };
    const other = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await other.login('f1000000-0000-4000-8000-000000000001', '482915');
    await assert.rejects(other.events(2, 200), { code: 'EVENT_FEED_INVALID' });
  } finally { env.cleanup(); }
});

test('Legacy client allowlist covers every required command and query', () => {
  const commands = `
    sale.commit sale.return sale.void sale.correct_after_close tab.open tab.add tab.settle tab.transfer tab.split tab.merge
    shift.open shift.close drawer.movement cashup.submit cashup.review cashup.reopen stock.receive
    stock.adjust stock.stocktake stock.waste stock.lot.waste stock.lot.release stock.transfer supplier.upsert purchase_order.create
    purchase_order.cancel purchase_order.receive customer.create customer.credit.payment voucher.issue
    catalogue.upsert catalogue.availability.set expense.create expense.void accounting.account.upsert
    control.checklist.start control.checklist.item.set control.incident.log control.incident.resolve
    workforce.shift.schedule workforce.shift.cancel workforce.clock.in workforce.clock.out staff.create
    staff.status settings.update accounting.journal.post accounting.period.close
    catalogue.modifier_group.upsert catalogue.modifier_option.upsert catalogue.product_modifier.set
    catalogue.recipe.set promotion.upsert loyalty.program.upsert loyalty.account.enrol loyalty.points.earn
    loyalty.points.redeem loyalty.points.adjust workforce.tip.allocate workforce.tip.payout
    workforce.tip.payout.reverse support.report.create export.bundle.create accounting.ap.invoice.upsert
    accounting.ap.invoice.approve accounting.ap.payment.post accounting.ap.payment.reverse
    accounting.bank_account.upsert accounting.bank_statement.import accounting.bank.reconcile
    accounting.tax_code.upsert accounting.tax_return.prepare accounting.payroll_run.create
    accounting.payroll_run.prepare accounting.payroll_run.finalise accounting.budget.upsert
  `.trim().split(/\s+/);
  const queries = `
    bootstrap menu.list menu.availability menu.modifiers menu.promotions expenses.list expense.get accounting.accounts.list tabs.list
    tab.get sales.list reports.sales_summary reports.stock reports.cashup control.templates.list
    control.checklists.list control.checklist.get control.incidents.list workforce.roster
    workforce.attendance.list workforce.attendance.current sale.get shift.current cashup.summary
    stock.list stock.lot_expiry stock.lot_balances suppliers.list purchase_orders.list purchase_order.get customers.list vouchers.list
    staff.list audit.search outbox.status outbox.bundle.get loyalty.programs.list loyalty.account.get accounting.trial_balance accounting.records workforce.tip_payouts drawer.open_shifts support.reports.list reports.post_close_corrections
  `.trim().split(/\s+/);
  assert.equal(ALLOWED_COMMANDS.size, commands.length);
  assert.equal(ALLOWED_QUERIES.size, queries.length);
  for (const command of commands) assert.equal(ALLOWED_COMMANDS.has(command), true, command);
  for (const query of queries) assert.equal(ALLOWED_QUERIES.has(query), true, query);
});

test('Legacy client refuses unregistered commands and queries before any service call', async () => {
  const env = setup();
  const calls = [];
  const transport = {
    request: async (method, path, options) => {
      calls.push({ method, path, body: options.body });
      return { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } };
    },
    close() {}
  };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    calls.length = 0;
    await assert.rejects(client.command('sale.commit.extra', { amount: '1.00' }), { code: 'COMMAND_NOT_REGISTERED' });
    await assert.rejects(client.command('select * from bookings', { amount: '1.00' }), { code: 'COMMAND_NOT_REGISTERED' });
    await assert.rejects(client.query('reports.profit', {}), { code: 'QUERY_NOT_REGISTERED' });
    assert.deepEqual(calls, []);
    assert.equal(env.journal.listIntents().length, 0);
  } finally { env.cleanup(); }
});

test('Legacy client treats a top-level HTTP refusal as terminal but keeps retryable refusals uncertain', async () => {
  const env = setup();
  let response = null;
  const transport = {
    request: async (_method, path, options) => path === '/v1/sessions'
      ? { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } }
      : response(options.body.operation_id),
    close() {}
  };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    response = () => ({ status: 409, body: {
      ok: false, outcome: 'refused', code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.',
      retry_same_operation: false, requires_manager: false, details: null, correlation_id: 'corr-1'
    } });
    const refused = await client.command('sale.commit', { amount: '1.00' });
    assert.equal(refused.outcome, 'refused');
    assert.equal(refused.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(env.journal.listIntents()[0].state, 'refused');

    response = () => ({ status: 401, body: {
      ok: false, outcome: 'refused', code: 'SESSION_EXPIRED', message: 'Session expired.',
      retry_same_operation: false, requires_manager: false, details: null, correlation_id: 'corr-2'
    } });
    await assert.rejects(client.command('sale.commit', { amount: '2.00' }), {
      code: 'SESSION_EXPIRED', retry_same_operation: true, outcome_unknown: true
    });
    const pending = env.journal.listOpenIntents();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].state, 'uncertain');
  } finally { env.cleanup(); }
});

test('Legacy client rejects a committed receipt for a different operation and keeps the intent', async () => {
  const env = setup();
  const transport = { request: async (_method, path, options) => path === '/v1/sessions'
    ? { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } }
    : { status: 200, body: { ok: true, outcome: 'committed_local', operation_id: options.body.operation_id,
      receipt: validReceipt('99999999-9999-4999-8999-999999999999'), result: { sale_id: 'sale-1' } } }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    await assert.rejects(client.command('sale.commit', { amount: '1.00' }), { code: 'RECEIPT_INVALID', outcome_unknown: true });
    assert.equal(env.journal.listOpenIntents().length, 1);
    assert.equal(env.journal.listOpenIntents()[0].state, 'uncertain');
  } finally { env.cleanup(); }
});

test('Legacy client replays a committed operation without a second service command', async () => {
  const env = setup();
  let commandCalls = 0;
  const transport = { request: async (_method, path, options) => {
    if (path === '/v1/sessions') return { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } };
    commandCalls += 1;
    return { status: 200, body: { ok: true, outcome: 'committed_local', operation_id: options.body.operation_id,
      receipt: validReceipt(options.body.operation_id), result: { sale_id: 'sale-1' } } };
  }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const operationId = '11111111-1111-4111-8111-111111111111';
    const payload = { amount: '1.00' };
    const first = await client.command('sale.commit', payload, { operationId });
    const second = await client.command('sale.commit', payload, { operationId });
    assert.equal(first.outcome, 'committed_local');
    assert.equal(second.replayed, true);
    assert.equal(second.receipt.commit_sequence, 1);
    assert.equal(commandCalls, 1);
  } finally { env.cleanup(); }
});

test('Legacy client starts pairing only through the authenticated thin transport', async () => {
  const env = setup();
  const requests = [];
  const transport = { request: async (method, path, options) => {
    requests.push({ method, path, options });
    if (path === '/v1/sessions') return { status: 201, body: { ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001', authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: 'f1000000-0000-4000-8000-000000000001' } } };
    if (path === '/v1/pairing/start') return { status: 201, body: { ok: true, pairing_code: '12345678', expires_in: 300 } };
    throw new Error(`Unexpected path ${path}`);
  }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const pairing = await client.startPairing({ ttl_seconds: 300 });
    assert.deepEqual(pairing, { ok: true, pairing_code: '12345678', expires_in: 300 });
    const call = requests.find((item) => item.path === '/v1/pairing/start');
    assert.equal(call.options.sessionToken, 'local-session-token-1234567890');
    assert.equal(call.options.deviceToken, scope.deviceToken);
    assert.deepEqual(call.options.body, { ttl_seconds: 300 });
  } finally { env.cleanup(); }
});

test('Legacy approval is authenticated, exact-payload bound, and reuses the operation identity', async () => {
  const env = setup();
  const requests = [];
  const transport = { request: async (_method, path, options) => {
    requests.push({ path, options });
    if (path === '/v1/sessions') return { status: 201, body: {
      ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
      authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id, staff: { id: options.body.staff_id }
    } };
    if (path === '/v1/approvals') return { status: 201, body: {
      ok: true, approval_id: 'a2000000-0000-4000-8000-000000000002', expires_in: 300,
      operation_hash: operationPayloadHash(options.body.operation)
    } };
    return { status: 200, body: { ok: true, outcome: 'committed_local', operation_id: options.body.operation_id,
      receipt: validReceipt(options.body.operation_id), result: { sale_id: 'return-1' } } };
  }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const operationId = '11111111-1111-4111-8111-111111111111';
    const payload = { sale_id: 'sale-1', reason: 'Damaged item', disposition: 'waste', lines: [{ sale_line_id: 'line-1', quantity: '1' }, { sale_line_id: 'line-2', quantity: '0.5' }] };
    await assert.rejects(client.requestApproval('sale.return', payload, 'bad', { operationId }), { code: 'VALIDATION_FAILED' });
    const approval = await client.requestApproval('sale.return', payload, '917264', { operationId });
    assert.equal(approval.operation_id, operationId);
    assert.equal(requests[1].path, '/v1/approvals');
    assert.equal(requests[1].options.body.operation.operation_id, operationId);
    assert.equal(requests[1].options.body.capability, 'pos.void');
    assert.equal(requests[1].options.body.pin, '917264');
    assert.deepEqual(requests[1].options.body.operation.payload.lines, payload.lines);
    assert.equal(requests[1].options.body.target_type, 'sale.return');
    const committed = await client.command('sale.return', { ...payload, approval_id: approval.approval_id }, { operationId });
    assert.equal(committed.operation_id, operationId);
    assert.equal(requests[2].options.body.operation_id, operationId);
    const approvalHash = (envelope) => operationPayloadHash({
      ...envelope,
      payload: Object.fromEntries(Object.entries(envelope.payload).filter(([key]) => key !== 'approval_id'))
    });
    assert.equal(approvalHash(requests[1].options.body.operation), approvalHash(requests[2].options.body));
    const cashupApproval = await client.requestApproval('cashup.review', {
      cashup_id: '88888888-8888-4888-8888-888888888888', decision: 'rejected', reason: 'Count does not reconcile'
    }, '917264');
    assert.equal(typeof cashupApproval.approval_id, 'string');
    assert.equal(requests[3].options.body.capability, 'pos.cashup');
    assert.equal(requests[3].options.body.operation.command, 'cashup.review');
    const reopenApproval = await client.requestApproval('cashup.reopen', {
      cashup_id: '88888888-8888-4888-8888-888888888888', expected_status: 'approved',
      counted_cash: '12.00', counted_card: '0.00', proof_refs: [], reason: 'Recount correction'
    }, '917264');
    assert.equal(typeof reopenApproval.approval_id, 'string');
    assert.equal(requests[4].options.body.capability, 'pos.cashup');
    assert.equal(requests[4].options.body.operation.command, 'cashup.reopen');
    const voidApproval = await client.requestApproval('sale.void', { sale_id: 'sale-1', reason: 'Duplicate charge' }, '917264');
    assert.equal(typeof voidApproval.approval_id, 'string');
    assert.equal(requests[5].options.body.capability, 'pos.void');
    assert.equal(requests[5].options.body.operation.command, 'sale.void');
  } finally { env.cleanup(); }
});

test('Legacy journal refuses to store committed or refused terminal states without verified proof', () => {
  const env = setup();
  try {
    const operationId = '22222222-2222-4222-8222-222222222222';
    const envelope = {
      contract_version: 1, authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
      business_id: scope.business_id, outlet_id: scope.outlet_id, device_id: scope.device_id,
      operation_id: operationId, command: 'sale.commit', payload_version: 1, payload: { amount: '1.00' }
    };
    env.journal.createIntent({ operationId, envelope });
    assert.throws(() => env.journal.markCommitted(operationId, { receipt: null, result: {} }), {
      code: 'JOURNAL_VALIDATION_FAILED'
    });
    assert.throws(() => env.journal.markRefused(operationId, {
      code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.', retry_same_operation: true
    }), { code: 'JOURNAL_VALIDATION_FAILED' });
    assert.equal(env.journal.getIntent(operationId).state, 'pending');
  } finally { env.cleanup(); }
});

test('Legacy queue classification keeps local intents and fences cloud or mesh work', () => {
  const local = classifyLegacyWorkItem({ authority_mode: 'bar_local', journal_kind: 'bar_local_intent' });
  assert.equal(local.accepted, true);
  assert.equal(local.replay_to_local, true);
  const cloud = classifyLegacyWorkItem({ type: 'rpc', functionName: 'create_order', payload: {} });
  assert.equal(cloud.accepted, false);
  assert.equal(cloud.code, 'LEGACY_CLOUD_QUEUE_FENCED');
  const mesh = classifyLegacyWorkItem({ _mesh_imported: true, type: 'rpc' });
  assert.equal(mesh.accepted, false);
  assert.equal(mesh.code, 'LEGACY_MESH_QUEUE_FENCED');
});

test('Legacy local transport requires HTTPS pinning on LAN and a pin for HTTPS', () => {
  assert.throws(() => createLegacyBarLocalTransport({ baseUrl: 'http://192.168.1.20:4317' }), { code: 'TLS_REQUIRED' });
  assert.throws(() => createLegacyBarLocalTransport({ baseUrl: 'https://bar.local:4317' }), { code: 'TLS_PIN_REQUIRED' });
  const transport = createLegacyBarLocalTransport({ baseUrl: 'http://127.0.0.1:4317' });
  assert.equal(transport.baseUrl, 'http://127.0.0.1:4317');
  transport.close();
});

test('Legacy local transport uses the service device headers required for authenticated endpoints', async () => {
  let received = null;
  const server = createServer((request, response) => {
    received = { headers: request.headers, url: request.url };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const transport = createLegacyBarLocalTransport({ baseUrl: `http://127.0.0.1:${address.port}` });
  try {
    await transport.request('GET', '/v1/health/ready', {
      deviceToken: scope.deviceToken,
      deviceId: scope.device_id,
      sessionToken: 'local-session-token',
      query: { after: '12', limit: '200' }
    });
    assert.equal(received.headers['x-bar-device-token'], scope.deviceToken);
    assert.equal(received.headers['x-bar-device-id'], scope.device_id);
    assert.equal(received.headers.authorization, 'Bearer local-session-token');
    assert.equal(received.headers['x-device-token'], undefined);
    assert.equal(received.url, '/v1/health/ready?after=12&limit=200');
  } finally {
    transport.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Legacy restart re-attempts an intent left submitting with the same operation ID', async () => {
  const env = setup();
  try {
    const operationId = '33333333-3333-4333-8333-333333333333';
    const envelope = {
      contract_version: 1, authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
      business_id: scope.business_id, outlet_id: scope.outlet_id, device_id: scope.device_id,
      operation_id: operationId, command: 'sale.commit', payload_version: 1, payload: { amount: '1.00' }
    };
    env.journal.createIntent({ operationId, envelope });
    env.journal.beginAttempt(operationId);

    // A crash between the durable `submitting` record and the reply must not
    // strand the till: reopening the journal keeps the attempt and the same ID.
    const reopened = new IntentJournal({ filePath: join(env.dir, 'intents.jsonl') });
    assert.equal(reopened.getIntent(operationId).state, 'submitting');
    assert.equal(reopened.listOpenIntents().length, 1);

    const requests = [];
    const transport = {
      request: async (method, path, options) => {
        requests.push({ method, path, options });
        if (path === '/v1/sessions') {
          return { status: 201, body: {
            ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
            authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id,
            staff: { id: 'f1000000-0000-4000-8000-000000000001' }
          } };
        }
        return { status: 200, body: {
          ok: true, outcome: 'committed_local', replayed: true, operation_id: options.body.operation_id,
          receipt: validReceipt(options.body.operation_id), result: { sale_id: 'sale-1' }
        } };
      },
      close() {}
    };
    const client = new LegacyBarLocalClient({ scope, journal: reopened, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    const outcome = await client.retry(operationId);
    assert.equal(outcome.outcome, 'committed_local');
    assert.equal(reopened.getIntent(operationId).state, 'committed');
    assert.equal(reopened.getIntent(operationId).attempts, 2);
    const dispatch = requests.find((item) => item.path === '/v1/commands');
    assert.equal(dispatch.options.body.operation_id, operationId);
    assert.deepEqual(dispatch.options.body.payload, envelope.payload);
  } finally { env.cleanup(); }
});

test('Legacy resolution uses the authority record without resubmitting the operation', async () => {
  const env = setup();
  const operationId = '44444444-4444-4444-8444-444444444444';
  const envelope = {
    contract_version: 1, authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
    business_id: scope.business_id, outlet_id: scope.outlet_id, device_id: scope.device_id,
    operation_id: operationId, command: 'sale.commit', payload_version: 1, payload: { amount: '1.00' }
  };
  const requests = [];
  let status = 'executing';
  const transport = {
    request: async (method, path, options) => {
      requests.push({ method, path, options });
      if (path === '/v1/sessions') {
        return { status: 201, body: {
          ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
          authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id,
          staff: { id: 'f1000000-0000-4000-8000-000000000001' }
        } };
      }
      if (status === 'committed') {
        return { status: 200, body: {
          ok: true, operation_id: operationId, command: 'sale.commit', status: 'committed', outcome: 'committed_local',
          receipt: validReceipt(operationId), result: { sale_id: 'sale-1' }
        } };
      }
      if (status === 'refused') {
        return { status: 200, body: {
          ok: true, operation_id: operationId, command: 'sale.commit', status: 'refused', outcome: 'refused',
          error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.', retry_same_operation: false, requires_manager: false }
        } };
      }
      return { status: 200, body: { ok: true, operation_id: operationId, command: 'sale.commit', status: 'executing' } };
    },
    close() {}
  };
  try {
    env.journal.createIntent({ operationId, envelope });
    env.journal.beginAttempt(operationId);
    env.journal.markUncertain(operationId, { code: 'UNKNOWN_OUTCOME', message: 'Reply lost.' });
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');

    const inProgress = await client.resolve(operationId);
    assert.equal(inProgress.outcome, 'executing');
    assert.equal(env.journal.getIntent(operationId).state, 'uncertain');
    assert.equal(requests.filter((item) => item.path === '/v1/commands').length, 0);

    status = 'committed';
    const committed = await client.resolve(operationId);
    assert.equal(committed.outcome, 'committed_local');
    assert.equal(committed.resolved, true);
    assert.equal(committed.receipt.commit_sequence, 1);
    assert.equal(env.journal.getIntent(operationId).state, 'committed');
    assert.equal(requests.filter((item) => item.path === '/v1/commands').length, 0);
  } finally { env.cleanup(); }
});

test('Legacy resolution refuses to trust an unverified refusal and keeps the intent open', async () => {
  const env = setup();
  const operationId = '55555555-5555-4555-8555-555555555555';
  const envelope = {
    contract_version: 1, authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
    business_id: scope.business_id, outlet_id: scope.outlet_id, device_id: scope.device_id,
    operation_id: operationId, command: 'sale.commit', payload_version: 1, payload: { amount: '1.00' }
  };
  let unverified = true;
  const transport = {
    request: async (_method, path) => path === '/v1/sessions'
      ? { status: 201, body: {
        ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
        authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id,
        staff: { id: 'f1000000-0000-4000-8000-000000000001' }
      } }
      : { status: 200, body: {
        ok: true, operation_id: operationId, command: 'sale.commit', status: 'refused', outcome: 'refused',
        error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.', retry_same_operation: unverified }
      } },
    close() {}
  };
  try {
    env.journal.createIntent({ operationId, envelope });
    env.journal.beginAttempt(operationId);
    env.journal.markUncertain(operationId, { code: 'UNKNOWN_OUTCOME', message: 'Reply lost.' });
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    await assert.rejects(client.resolve(operationId), { code: 'REFUSAL_INVALID' });
    assert.equal(env.journal.getIntent(operationId).state, 'uncertain');
    unverified = false;
    const refused = await client.resolve(operationId);
    assert.equal(refused.outcome, 'refused');
    assert.equal(refused.resolved, true);
    assert.equal(env.journal.getIntent(operationId).state, 'refused');
  } finally { env.cleanup(); }
});

test('Legacy pairing sends a staged intent and keeps its device token in main-process result', async () => {
  let sent = null;
  const transport = {
    fingerprint: null,
    baseUrl: 'http://127.0.0.1:4317',
    close() {},
    request: async (method, path, options) => {
      sent = { method, path, body: options.body };
      return { status: 201, body: {
        ok: true, outcome: 'device_paired',
        authority_id: scope.authority_id, authority_epoch: scope.authority_epoch,
        business_id: scope.business_id, outlet_id: scope.outlet_id,
        device_id: scope.device_id, device_token: scope.deviceToken,
        server_certificate_fingerprint: null
      } };
    }
  };
  const pairingToken = `bld_${'c'.repeat(48)}`;
  const provisioningId = '77777777-7777-4777-8777-777777777777';
  const paired = await completeLegacyBarPairing({
    pairingCode: '12345678', deviceName: 'Legacy Till', transport,
    provisioningId, deviceToken: pairingToken
  });
  assert.deepEqual(sent, {
    method: 'POST', path: '/v1/pairing/complete',
    body: {
      pairing_code: '12345678', name: 'Legacy Till', platform: 'legacy',
      provisioning_id: provisioningId, device_token: pairingToken, certificate_fingerprint: null
    }
  });
  assert.equal(paired.profile.authority_id, scope.authority_id);
  assert.equal(paired.profile.device_id, scope.device_id);
  assert.equal(paired.deviceToken, pairingToken);
});

test('Legacy administration uses the authenticated session and rejects malformed privileged input before dispatch', async () => {
  const env = setup();
  const requests = [];
  const transport = { request: async (method, path, options) => {
    requests.push({ method, path, options });
    if (path === '/v1/sessions') return { status: 201, body: {
      ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
      authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id,
      staff: { id: 'f1000000-0000-4000-8000-000000000001' }
    } };
    if (path === '/v1/admin/status') return { status: 200, body: { ok: true, status: {
      service: { version: '1.0.0', uptime_seconds: 10 }, network: {}, replication: {},
      backup: {}, update: {}, devices: {}, database: { reachable: true, database: 'bar', port: 5432 }
    } } };
    if (path === '/v1/admin/backup/verify') return { status: 200, body: {
      ok: true, command: 'backup-verify', file_name: options.body.file_name,
      integrity_verified: true, restore_verified: false
    } };
    if (path === '/v1/admin/replication/switchover') return { status: 409, body: {
      ok: false, command: 'replication-switchover', authority_state: 'fenced_no_promotion',
      error: { code: 'REPLICATION_PROMOTION_FAILED', message: 'Promotion failed.' },
      recovery: { message: 'Keep all clients stopped and complete manual promotion.' }
    } };
    return { status: 200, body: { ok: true } };
  }, close() {} };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    requests.length = 0;
    const status = await client.adminStatus();
    assert.equal(status.status.database.reachable, true);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/v1/admin/status');
    assert.equal(requests[0].options.sessionToken, 'local-session-token-1234567890');
    assert.equal(requests[0].options.deviceId, scope.device_id);

    requests.length = 0;
    await assert.rejects(client.adminRunBackup({ label: 'nightly', extra: true }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminVerifyBackup({ file_name: '../bar.blbkup' }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminSetDurability({ profile: 'async' }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminSwitchover({ confirm: 'YES', reason: 'Manual drill' }), { code: 'VALIDATION_FAILED' });
    assert.deepEqual(requests, []);

    const verified = await client.adminVerifyBackup({ file_name: 'bar-2026.blb' });
    assert.equal(verified.integrity_verified, true);
    await assert.rejects(client.adminSwitchover({ confirm: 'SWITCHOVER', reason: 'Manual drill' }), {
      code: 'REPLICATION_PROMOTION_FAILED', retry_same_operation: false
    });
  } finally { env.cleanup(); }
});

test('Legacy cloud-sync administration validates status, config and failed run results without inventing acceptance', async () => {
  const env = setup();
  const requests = [];
  let statusBody = null;
  let runBody = null;
  const transport = { request: async (method, path, options) => {
    requests.push({ method, path, body: options.body, sessionToken: options.sessionToken, deviceId: options.deviceId });
    if (path === '/v1/sessions') return { status: 201, body: {
      ok: true, session_token: 'local-session-token-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
      authority_epoch: 1, business_id: scope.business_id, outlet_id: scope.outlet_id,
      staff: { id: 'f1000000-0000-4000-8000-000000000001' }
    } };
    if (path === '/v1/admin/cloud-sync') return { status: 200, body: { ok: true, command: 'cloud-sync-status', status: statusBody } };
    if (path === '/v1/admin/cloud-sync/config') return { status: 200, body: { ok: true, command: 'cloud-sync-config', status: statusBody } };
    if (path === '/v1/admin/cloud-sync/run') return { status: 200, body: runBody };
    return { status: 200, body: { ok: true } };
  }, close() {} };
  const baseStatus = {
    available: true, transport: 'disabled', signing_secret_configured: false,
    configured: true, enabled: false, pending_events: 3, prepared_batches: 1,
    failed_batches: 0, acknowledged_watermark: 9, receiver_url: null,
    schedule_mode: 'fifteen_minutes', daily_at: '23:30', batch_limit: 200,
    signing_key_id: null, latest_batch: null
  };
  try {
    const client = new LegacyBarLocalClient({ scope, journal: env.journal, transport });
    await client.login('f1000000-0000-4000-8000-000000000001', '482915');
    requests.length = 0;

    statusBody = { ...baseStatus };
    const status = await client.adminCloudSyncStatus();
    assert.equal(status.status.pending_events, 3);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/v1/admin/cloud-sync');
    assert.equal(requests[0].sessionToken, 'local-session-token-1234567890');
    assert.equal(requests[0].deviceId, scope.device_id);
    assert.equal(status.command, 'cloud-sync-status');

    statusBody = { ...baseStatus, pending_events: -1 };
    await assert.rejects(client.adminCloudSyncStatus(), { code: 'INVALID_RESPONSE' });
    statusBody = { ...baseStatus, transport: 'internet' };
    await assert.rejects(client.adminCloudSyncStatus(), { code: 'INVALID_RESPONSE' });
    statusBody = { ...baseStatus, latest_batch: 'batch' };
    await assert.rejects(client.adminCloudSyncStatus(), { code: 'INVALID_RESPONSE' });

    requests.length = 0;
    await assert.rejects(client.adminCloudSyncConfig({ unknown: true }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminCloudSyncConfig({ schedule_mode: 'hourly' }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminCloudSyncConfig({ daily_at: '24:00' }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminCloudSyncConfig({ batch_limit: 0 }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(client.adminCloudSyncConfig({ receiver_url: 'ftp://receiver.example' }), { code: 'VALIDATION_FAILED' });
    assert.deepEqual(requests, []);

    statusBody = { ...baseStatus, enabled: true, receiver_url: 'http://127.0.0.1:4318/ingest', signing_key_id: 'bar-test-1' };
    const configured = await client.adminCloudSyncConfig({
      enabled: true, receiver_url: 'http://127.0.0.1:4318/ingest', signing_key_id: 'bar-test-1', batch_limit: 25
    });
    assert.equal(configured.status.enabled, true);
    assert.deepEqual(requests.at(-1).body, {
      enabled: true, receiver_url: 'http://127.0.0.1:4318/ingest', signing_key_id: 'bar-test-1', batch_limit: 25
    });

    // A failed pass is a reported result with durable detail, not a refusal and
    // not a fabricated acknowledgement.
    runBody = {
      ok: false, command: 'cloud-sync-run', status: 'failed', transport: 'local_test',
      checked_at: '2026-10-27T10:00:00.000Z', uploaded_batches: 0, pending_events: 3,
      last_error_code: 'RECEIVER_UNAVAILABLE', last_error_message: 'Receiver refused the connection.',
      final: false, final_state: 'failed', status_detail: { ...baseStatus, failed_batches: 1 }
    };
    const run = await client.adminCloudSyncRun({});
    assert.equal(run.status, 'failed');
    assert.equal(run.ok, false);
    assert.equal(run.status_detail.failed_batches, 1);

    runBody = { ...runBody, status: 'sent' };
    await assert.rejects(client.adminCloudSyncRun({}), { code: 'INVALID_RESPONSE' });
    runBody = { ...runBody, status: 'failed', status_detail: { ...baseStatus, failed_batches: -2 } };
    await assert.rejects(client.adminCloudSyncRun({}), { code: 'INVALID_RESPONSE' });
    await assert.rejects(client.adminCloudSyncRun({ final: 'yes' }), { code: 'VALIDATION_FAILED' });
  } finally { env.cleanup(); }
});
