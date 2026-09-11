import test from 'node:test'
import assert from 'node:assert/strict'

import { createProductSaveFlow } from '../src/shared/productSaveFlow.js'
import { isDefinitiveProductRejection, isMissingRpcError } from '../src/shared/productRequest.js'
import { runPublicationSweep, summarizePublication } from '../src/shared/catalogPublication.js'

const WIZARD_DATA = (overrides = {}) => ({
  operation_key: 'op-1',
  name: 'Heineken 330ml',
  category: 'Beer',
  price: 30,
  barcode: '6001001',
  depletion_qty: '1',
  stock_mode: 'create',
  stock_unit: 'bottle',
  outlet_id: 'outlet-1',
  opening_stock: '12',
  reorder_level: '6',
  unit_cost: '18',
  selling_price: '30',
  pack6: false,
  pack12: false,
  pack24: false,
  ...overrides,
})

// In-memory store with real read-back semantics (throws only when told to).
function makeStore({ failWrites = false } = {}) {
  const rows = new Map()
  return {
    rows,
    readRequest: (key) => rows.get(String(key)) || null,
    listRequests: () => [...rows.values()],
    writeRequest: (entry) => {
      if (failWrites) throw new Error('disk full');
      rows.set(entry.operation_key, JSON.parse(JSON.stringify(entry)));
    },
    removeRequest: (key) => {
      rows.delete(String(key));
    },
  };
}

// Fake server: records applied effects per operation key. Transport failures
// can be armed to simulate response-lost-after-commit (effect applied, reply
// dropped) versus pre-commit failure (no effect).
function makeServer() {
  const effects = []
  const committed = new Map()
  const calls = []
  const transport = { mode: 'ok' }
  return {
    effects,
    calls,
    transport,
    async rpc(payload) {
      calls.push(JSON.parse(JSON.stringify(payload)));
      const key = payload.operation_key
      if (committed.has(key)) return { transported: true, result: { ...committed.get(key), replayed: true } };
      if (transport.mode === 'drop-after-commit') {
        const result = {
          success: true,
          menu_item_id: `menu-${key}`,
          inventory_item_id: payload.inventory_item_id,
          operation_key: key,
          outlet_ids: [payload.stock.outlet_id],
        };
        effects.push({ key, inventory: payload.inventory_item_id, opening: payload.stock.opening_stock });
        committed.set(key, result)
        transport.mode = 'ok'
        throw new Error('socket hang up');
      }
      if (transport.mode === 'fail-before-commit') {
        transport.mode = 'ok'
        throw new Error('socket hang up');
      }
      if (transport.mode === 'missing') {
        transport.mode = 'ok'
        return { transported: true, missing: true, error: new Error('function save_bar_product_with_stock does not exist') };
      }
      if (transport.mode === 'reject') {
        transport.mode = 'ok'
        return { transported: true, rejected: true, result: { success: false, error: 'Barcode is already used by another sellable product.' } };
      }
      if (transport.mode === 'duplicate-name') {
        transport.mode = 'ok'
        // Mirrors the server guard + domain classification: SQLSTATE 23505
        // refusal returned as a definitive rejection (see dispatchOnline).
        return {
          transported: true,
          rejected: true,
          error: { code: '23505', message: 'A product named "Heineken 330ml" already exists. Use the existing product instead.' },
        };
      }
      const result = {
        success: true,
        menu_item_id: `menu-${key}`,
        inventory_item_id: payload.inventory_item_id,
        operation_key: key,
        outlet_ids: [payload.stock.outlet_id],
      };
      effects.push({ key, inventory: payload.inventory_item_id, opening: payload.stock.opening_stock });
      committed.set(key, result)
      return { transported: true, result };
    },
  };
}

function makeFlow(store, server, extras = {}) {
  return createProductSaveFlow({
    readRequest: store.readRequest,
    listRequests: store.listRequests,
    writeRequest: store.writeRequest,
    removeRequest: store.removeRequest,
    queueOffline: async () => {},
    dispatchOnline: (payload) => server.rpc(payload),
    finalizeCommitted: async (entry, result) => ({ publication: 'published' }),
    isOnline: () => extras.online !== false,
    newId: () => extras.inventoryId || 'inv-fresh',
  });
}

test('F1: identical retries reuse the stored request with one stock/product effect', async () => {
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  const first = await flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1')
  assert.equal(first.success, true)
  assert.equal(server.effects.length, 1)
  assert.equal(server.effects[0].inventory, 'inv-1')
  assert.equal(server.effects[0].opening, 12)
  // A retry without ids (fresh caller state) reuses the committed result
  // without touching the server again.
  const second = await flow.save(WIZARD_DATA(), 'lodge-1')
  assert.equal(second.success, true)
  assert.equal(second.replayed, true)
  assert.equal(server.calls.length, 1)
  assert.equal(server.effects.length, 1)
})

test('F1: changed payload under a reused key is rejected, never overwritten', async () => {
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  // Leave the first attempt unresolved: force an unknown outcome.
  server.transport.mode = 'fail-before-commit'
  await assert.rejects(flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1'), /Nothing was confirmed/)
  assert.equal(server.effects.length, 0)
  // Same key, different price: must be rejected, and the stored bytes kept.
  await assert.rejects(flow.save({ ...WIZARD_DATA(), price: 35 }, 'lodge-1'), /already in use with different values/)
  const stored = store.readRequest('op-1')
  assert.equal(stored.payload.product.price, 30)
  assert.equal(stored.entity_ids.inventory_item_id, 'inv-1')
})

test('F1: storage failure blocks dispatch entirely', async () => {
  const store = makeStore({ failWrites: true })
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  await assert.rejects(flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1'), /could not be stored safely/)
  assert.equal(server.calls.length, 0)
  assert.equal(server.effects.length, 0)
})

test('F1: concurrent clicks single-flight on the operation key', async () => {
  const store = makeStore()
  const server = makeServer()
  let release
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slowServer = { ...server, rpc: async (payload) => { await gate; return server.rpc(payload); } };
  const flow = makeFlow(store, slowServer, { inventoryId: 'inv-1' })
  const attempt = flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1')
  const duplicate = flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1')
  release()
  const [first, second] = await Promise.all([attempt, duplicate])
  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(server.effects.length, 1)
})

test('F1: response lost after commit replays without a second effect', async () => {
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  server.transport.mode = 'drop-after-commit'
  await assert.rejects(flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1'), /Nothing was confirmed/)
  assert.equal(server.effects.length, 1)
  const retry = await flow.retry('op-1')
  assert.equal(retry.success, true)
  assert.equal(server.effects.length, 1)
  // The unknown-outcome retry replays byte-identical bytes.
  assert.deepEqual(server.calls[1], server.calls[0])
})

test('F1: definitive rejection is terminal; missing RPC preserves the request', async () => {
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  server.transport.mode = 'reject'
  await assert.rejects(flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1'), /already used by another sellable/)
  assert.equal(store.readRequest('op-1').state, 'rejected')
  const callsBefore = server.calls.length
  // Retrying a terminal refusal surfaces the stored business reason without
  // touching the server again.
  await assert.rejects(flow.retry('op-1'), /already used by another sellable/)
  assert.equal(server.calls.length, callsBefore)
  assert.equal(server.effects.length, 0)

  const store2 = makeStore()
  const server2 = makeServer()
  const flow2 = makeFlow(store2, server2, { inventoryId: 'inv-2' })
  server2.transport.mode = 'missing'
  await assert.rejects(
    flow2.save({ ...WIZARD_DATA({ operation_key: 'op-2' }), inventory_item_id: 'inv-2' }, 'lodge-1'),
    /latest till update/,
  )
  const pending = store2.readRequest('op-2')
  assert.equal(pending.state, 'pending-upgrade')
  assert.equal(pending.payload.product.price, 30)
})

test('missing-backend errors classify without throwing', () => {
  // The domain readiness/save error paths call this on every RPC failure,
  // so it must never throw and must only match genuinely-missing functions.
  assert.equal(isMissingRpcError(new Error('function save_bar_product_with_stock does not exist')), true)
  assert.equal(
    isMissingRpcError(new Error('Could not find the function public.get_pos_menu_stock_readiness in the schema cache')),
    true,
  )
  assert.equal(isMissingRpcError(new Error('PGRST202: function does not exist')), true)
  assert.equal(isMissingRpcError(new Error('socket hang up')), false)
  assert.equal(isMissingRpcError(new Error('Barcode is already used by another sellable product.')), false)
  assert.equal(isMissingRpcError(null), false)
  assert.equal(isMissingRpcError(undefined), false)
})

test('definitive business refusals classify as terminal, transport faults do not', () => {
  // SQLSTATE-coded refusals from the wizard contract: validation (22023) and
  // conflict (23505), including the duplicate-name guard. These must become
  // terminal rejections so recovery stops re-dispatching stale duplicates.
  assert.equal(isDefinitiveProductRejection({ code: '23505', message: 'A product named "Heineken 330ml" already exists. Use the existing product instead.' }), true)
  assert.equal(isDefinitiveProductRejection({ code: '22023', message: 'Product price must be greater than zero' }), true)
  assert.equal(isDefinitiveProductRejection({ code: '23505', message: 'Product changed underneath this edit. Reload and retry.' }), true)
  // Transport/permission/missing failures stay retryable-unknown.
  assert.equal(isDefinitiveProductRejection({ code: '42501', message: 'permission denied for function save_bar_product_with_stock' }), false)
  assert.equal(isDefinitiveProductRejection({ code: 'PGRST202', message: 'function does not exist' }), false)
  assert.equal(isDefinitiveProductRejection(new Error('socket hang up')), false)
  assert.equal(isDefinitiveProductRejection(null), false)
  assert.equal(isDefinitiveProductRejection(undefined), false)
})

test('F1: retry-storm duplicate under a new key is terminally rejected, never duplicated', async () => {
  // The original incident: every failed save minted its own operation key;
  // after the outage, retrying each stale entry created the same product
  // again. The server now refuses cross-key duplicates by name, and that
  // refusal must land as terminal (rejected) so recovery stops dispatching.
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  const first = await flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1')
  assert.equal(first.success, true)
  // A stale second entry (different key, same product name) is refused by the
  // server with the duplicate-name guard; the domain classifies SQLSTATE
  // 23505 as a definitive rejection (dispatchOnline contract).
  server.transport.mode = 'duplicate-name'
  await assert.rejects(
    flow.save({ ...WIZARD_DATA({ operation_key: 'op-2' }), inventory_item_id: 'inv-2' }, 'lodge-1'),
    /already exists\. Use the existing product instead/,
  )
  const stale = store.readRequest('op-2')
  assert.equal(stale.state, 'rejected')
  assert.match(stale.error, /A product named "Heineken 330ml" already exists/)
  // Only one product/stock effect ever exists; the stale entry is discardable.
  assert.equal(server.effects.length, 1)
  flow.discard('op-2')
  assert.equal(store.readRequest('op-2'), null)
})

test('F1: startup recovery replays actionable requests and skips terminal ones', async () => {
  const store = makeStore()
  const server = makeServer()
  const flow = makeFlow(store, server, { inventoryId: 'inv-1' })
  server.transport.mode = 'fail-before-commit'
  await assert.rejects(flow.save({ ...WIZARD_DATA(), inventory_item_id: 'inv-1' }, 'lodge-1'))
  assert.equal(store.readRequest('op-1').state, 'unknown')
  const acted = await flow.recover()
  assert.equal(acted.length, 1)
  assert.equal(acted[0].ok, true)
  assert.equal(server.effects.length, 1)
  // Second recovery finds nothing actionable.
  assert.deepEqual(await flow.recover(), [])
})

test('F4: originator failure hands over to a new claim after lease expiry', async () => {
  const lease = { live: true };
  const jobs = new Map([
    ['job-1', { job_id: 'job-1', outlet_id: 'outlet-1', version: 3, attempts: 1, token: 'token-a' }],
  ])
  let published = []
  const machine = {
    outlets: ['outlet-1'],
    claim: async () => {
      const job = jobs.get('job-1')
      if (!job) return null;
      return { job: { ...job, claim_token: job.token } };
    },
    publish: async () => {
      published.push('outlet-1');
    },
    complete: async (job) => {
      const current = jobs.get('job-1')
      if (!current || current.token !== job.claim_token || !lease.live) {
        return { completed: false, error: 'Claim expired or already completed.' };
      }
      jobs.delete('job-1')
      return { completed: true };
    },
    release: async (job, error, permanent) => {
      if (permanent) jobs.delete('job-1');
      else {lease.live = false;}
    },
  };
  // Originator publishes, then its lease expires before completion: the
  // completion is rejected and the job is reclaimed by the next run.
  await machine.publish('outlet-1', { job_id: 'job-1' })
  lease.live = false
  const stale = await machine.complete({ job_id: 'job-1', claim_token: 'token-a' })
  assert.equal(stale.completed, false)
  lease.live = true
  const handover = await runPublicationSweep(machine)
  assert.equal(handover[0].status, 'published')
  assert.deepEqual(published, ['outlet-1', 'outlet-1'])
})

test('F4: expired completion is rejected and the job is reclaimable', async () => {
  const jobs = new Map([
    ['job-1', { job_id: 'job-1', outlet_id: 'outlet-1', version: 3, attempts: 1 }],
  ])
  let owner = 'worker-a'
  const machine = {
    outlets: ['outlet-1'],
    claim: async () => {
      const job = jobs.get('job-1')
      if (!job) return null;
      // Each claim hands the lease to the other worker.
      owner = owner === 'worker-a' ? 'worker-b' : 'worker-a'
      return { job: { ...job, claim_token: owner } };
    },
    publish: async () => {},
    complete: async (job) => {
      // Only the latest claimant holds a valid lease.
      if (job.claim_token !== owner) return { completed: false, error: 'Claim expired or already completed.' };
      jobs.delete('job-1')
      return { completed: true };
    },
    release: async () => {},
  };
  // worker-b holds the lease after one claim; worker-a's token is stale.
  await machine.claim('outlet-1')
  const stale = await machine.complete({ job_id: 'job-1', claim_token: 'worker-a' })
  assert.equal(stale.completed, false)
  const fresh = await runPublicationSweep(machine)
  assert.equal(fresh[0].status, 'published')
})

test('F4: newer publication overtakes older work without regressing', async () => {
  const applied = { version: 0 };
  const machine = {
    outlets: ['outlet-1'],
    claim: async () => ({ job: { job_id: 'job-old', outlet_id: 'outlet-1', version: 2, attempts: 1, claim_token: 't' } }),
    publish: async () => {},
    complete: async () => {
      if (applied.version > 2) return { completed: true, superseded: true };
      applied.version = 2
      return { completed: true };
    },
    release: async () => {},
  };
  applied.version = 5 // a newer catalog already covers the outlet
  const results = await runPublicationSweep(machine)
  assert.equal(results[0].status, 'published')
  assert.match(results[0].note || '', /newer catalog/)
  assert.equal(applied.version, 5)
})

test('F4: partial multi-outlet completion and poison jobs report truthfully', async () => {
  const machine = {
    outlets: ['outlet-a', 'outlet-b', 'outlet-c'],
    claim: async (outletId) => {
      if (outletId === 'outlet-a') return { job: { job_id: 'j-a', outlet_id: outletId, version: 1, attempts: 1, claim_token: 't' } };
      if (outletId === 'outlet-b') return { job: { job_id: 'j-b', outlet_id: outletId, version: 1, attempts: 9, claim_token: 't' } };
      return null;
    },
    publish: async (outletId) => {
      if (outletId === 'outlet-a') return;
      throw new Error('unreachable');
    },
    complete: async () => ({ completed: true }),
    release: async () => {},
  };
  const results = await runPublicationSweep(machine)
  const byOutlet = new Map(results.map((row) => [row.outlet_id, row.status]))
  assert.equal(byOutlet.get('outlet-a'), 'published')
  assert.equal(byOutlet.get('outlet-b'), 'failed')
  assert.equal(byOutlet.get('outlet-c'), 'no-job')
  // An empty sweep is never publication proof for expected outlets.
  const summary = summarizePublication(['outlet-c', 'outlet-b'], results)
  assert.deepEqual(summary.map((row) => row.status), ['pending', 'failed'])
})
