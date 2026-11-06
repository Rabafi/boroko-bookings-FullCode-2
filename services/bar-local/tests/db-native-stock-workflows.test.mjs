import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness } from './harness.mjs'

const item = (name, opening = '0') => ({ name, category: 'Drinks', unit: 'bottle', barcode: name,
  reorder_level: '2', unit_cost: '1.2500', opening_stock: opening })

test('native counted-stock creation replays once, stays off the menu, and edits preserve financial and stock identity', async (t) => {
  const h = await createHarness(t)
  const envelope = h.envelope('catalogue.stock_item.save', item('Native stock', '12'))
  const created = await h.call('cmd_catalogue_stock_item_save', envelope)
  assert.equal(created.ok, true, JSON.stringify(created.error))
  const replay = await h.call('cmd_catalogue_stock_item_save', envelope)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, created.result)
  const id = created.result.product_id
  const menu = await h.query('menu.availability', { include_inactive: true })
  assert.equal(menu.data.some((row) => row.product_id === id), false)
  const stock = (await h.query('stock.list')).data.find((row) => row.product_id === id)
  assert.equal(Number(stock.quantity), 12)
  await h.migrator.query('UPDATE bar_local.products SET price=8,tax_rate=0.14,sellable=true WHERE id=$1', [id])
  const edited = await h.call('cmd_catalogue_stock_item_save', h.envelope('catalogue.stock_item.save', {
    ...item('Renamed stock'), product_id: id, expected_version: stock.product_version, barcode: 'NEW-NATIVE-BARCODE'
  }))
  assert.equal(edited.ok, true, JSON.stringify(edited.error))
  const current = (await h.migrator.query('SELECT price,tax_rate,track_stock,sellable FROM bar_local.products WHERE id=$1', [id])).rows[0]
  assert.equal(Number(current.price), 8)
  assert.equal(Number(current.tax_rate), 0.14)
  assert.equal(current.track_stock, true)
  assert.equal(current.sellable, true)
  const unitChange = await h.call('cmd_catalogue_stock_item_save', h.envelope('catalogue.stock_item.save', {
    ...item('Renamed stock'), product_id: id, expected_version: edited.result.version, unit: 'litre'
  }))
  assert.equal(unitChange.ok, false)
  assert.equal(unitChange.error.code, 'STOCK_UNIT_LOCKED')
  const forgedOutlet = await h.call('cmd_catalogue_stock_item_save', h.envelope('catalogue.stock_item.save', { ...item('Forbidden stock'), outlet_id: randomUUID() }))
  assert.equal(forgedOutlet.ok, false)
  assert.equal(forgedOutlet.error.code, 'OUTLET_SCOPE_MISMATCH')
  const movements = await h.query('stock.history', { product_id: id })
  assert.equal(movements.complete, true)
  assert.equal(movements.data.length, 1)
  assert.equal(Number(movements.data[0].quantity), 12)
  const aging = await h.query('stock.aging')
  assert.equal(aging.data.some((row) => row.item_id === id && row.last_received_at), true)
})

test('native stock batches replay atomically and refuse every count line when one baseline changed', async (t) => {
  const h = await createHarness(t)
  const ids = []
  for (const name of ['First stock', 'Second stock']) {
    const created = await h.call('cmd_catalogue_stock_item_save', h.envelope('catalogue.stock_item.save', item(name, '10')))
    assert.equal(created.ok, true, JSON.stringify(created.error))
    ids.push(created.result.product_id)
  }
  ids.sort()
  const delivery = h.envelope('stock.batch.record', { mode: 'receive', notes: 'Synthetic delivery',
    lines: ids.map((product_id) => ({ product_id, quantity: '3', reason: 'Delivery received' })) })
  const received = await h.call('cmd_stock_batch_record', delivery)
  assert.equal(received.ok, true, JSON.stringify(received.error))
  assert.equal((await h.call('cmd_stock_batch_record', delivery)).replayed, true)
  let stock = (await h.query('stock.list')).data
  assert.deepEqual(stock.map((row) => Number(row.quantity)), [13, 13])
  const baseline = new Map(stock.map((row) => [row.product_id, row.version]))
  const extraReceipt = await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: ids[1], quantity: '1' }))
  assert.equal(extraReceipt.ok, true)
  const stale = await h.call('cmd_stock_batch_record', h.envelope('stock.batch.record', { mode: 'count',
    lines: ids.map((product_id) => ({ product_id, quantity: '5', expected_stock_version: baseline.get(product_id), reason: 'Counted on sheet' })) }))
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STOCK_VERSION_CONFLICT')
  stock = (await h.query('stock.list')).data
  assert.equal(Number(stock.find((row) => row.product_id === ids[0]).quantity), 13, 'the otherwise valid first line must roll back')
  assert.equal(Number(stock.find((row) => row.product_id === ids[1]).quantity), 14)
  const counted = h.envelope('stock.batch.record', { mode: 'count', notes: 'Fresh count',
    lines: stock.map((row) => ({ product_id: row.product_id, quantity: row.quantity, expected_stock_version: row.version, reason: 'Verified no variance' })) })
  const first = await h.call('cmd_stock_batch_record', counted)
  assert.equal(first.ok, true, JSON.stringify(first.error))
  assert.equal((await h.call('cmd_stock_batch_record', counted)).replayed, true)
  const history = await h.query('stock.history', { counts_only: true })
  assert.equal(history.data.length, 2, 'no-variance counts still have one auditable line each')
  assert.equal(history.data.every((row) => Number(row.delta) === 0 && row.expected_qty === row.actual_qty), true)
  const lotBalances = await h.query('stock.lot_balances')
  assert.equal(lotBalances.data.filter((row) => ids.includes(row.product_id)).reduce((sum, row) => sum + Number(row.remaining_quantity), 0), 27)
  await assert.rejects(h.call('cmd_stock_batch_record', { ...delivery, payload: { ...delivery.payload, notes: 'Changed payload' } }),
    (error) => error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT')
})

test('native stock command and read capability checks remain server-enforced', async (t) => {
  const h = await createHarness(t, { managerCapabilities: ['pos.view'] })
  await assert.rejects(h.call('cmd_catalogue_stock_item_save', h.envelope('catalogue.stock_item.save', item('Denied')),
    { tokenHash: h.managerTokenHash }), /capability|permission|authoris/i)
  await assert.rejects(h.call('cmd_stock_batch_record', h.envelope('stock.batch.record', { mode: 'receive', lines: [] }),
    { tokenHash: h.managerTokenHash }), /capability|permission|authoris/i)
  await assert.rejects(h.query('stock.history', {}, { tokenHash: h.managerTokenHash }), /capability|permission|authoris/i)
})
