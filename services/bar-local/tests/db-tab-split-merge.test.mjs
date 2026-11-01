import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

test('tab split and merge conserve lines, versions and settlement totals', async (t) => {
  const h = await createHarness(t)
  await h.openShift()

  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'SPLIT-1', name: 'Split Product', category: 'Test', price: '10.00', tax_rate: '0.14', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id

  const sourceTab = await h.call('cmd_tab_open', h.envelope('tab.open', { table_label: 'Split Source' }))
  assert.equal(sourceTab.ok, true, JSON.stringify(sourceTab.error))
  const sourceTabId = sourceTab.result.tab_id

  const addOne = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: sourceTabId, expected_version: 1, items: [{ product_id: productId, quantity: '1' }]
  }))
  assert.equal(addOne.ok, true, JSON.stringify(addOne.error))
  const addTwo = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: sourceTabId, expected_version: 2, items: [{ product_id: productId, quantity: '2' }]
  }))
  assert.equal(addTwo.ok, true, JSON.stringify(addTwo.error))

  const beforeSplit = await h.query('tab.get', { tab_id: sourceTabId })
  assert.equal(beforeSplit.data.version, 3)
  assert.equal(beforeSplit.data.lines.length, 2)
  assert.equal(Number(beforeSplit.data.gross_total), 34.2)
  const movedLineId = beforeSplit.data.lines[0].tab_line_id
  const remainingLineId = beforeSplit.data.lines[1].tab_line_id

  const splitPayload = {
    source_tab_id: sourceTabId,
    expected_version: 3,
    line_ids: [movedLineId],
    table_label: 'Split Target',
    reason: 'guests moved'
  }
  const splitHash = sha256Json(splitPayload)
  splitPayload.approval_id = await h.approve('pos.manage', splitHash, { targetType: 'tab', targetId: sourceTabId })
  const splitEnvelope = h.envelope('tab.split', splitPayload)
  const split = await h.call('cmd_tab_split', splitEnvelope, { approvalHash: splitHash })
  assert.equal(split.ok, true, JSON.stringify(split.error))
  assert.equal(split.result.source_version, 4)
  assert.equal(split.result.target_version, 1)
  assert.equal(split.result.moved_lines, 1)
  const targetTabId = split.result.target_tab_id

  const splitReplay = await h.call('cmd_tab_split', splitEnvelope, { approvalHash: splitHash })
  assert.equal(splitReplay.ok, true, JSON.stringify(splitReplay.error))
  assert.equal(splitReplay.replayed, true)
  assert.equal(splitReplay.receipt.operation_id, split.receipt.operation_id)
  assert.equal(splitReplay.result.target_tab_id, targetTabId)

  const sourceAfterSplit = await h.query('tab.get', { tab_id: sourceTabId })
  const targetAfterSplit = await h.query('tab.get', { tab_id: targetTabId })
  assert.equal(sourceAfterSplit.data.lines.length, 1)
  assert.equal(sourceAfterSplit.data.lines[0].tab_line_id, remainingLineId)
  assert.equal(targetAfterSplit.data.lines.length, 1)
  assert.equal(Number(sourceAfterSplit.data.gross_total) + Number(targetAfterSplit.data.gross_total), 34.2)

  const emptySourcePayload = {
    source_tab_id: sourceTabId,
    expected_version: 4,
    line_ids: [remainingLineId],
    reason: 'invalid full split'
  }
  const emptySourceHash = sha256Json(emptySourcePayload)
  emptySourcePayload.approval_id = await h.approve('pos.manage', emptySourceHash, { targetType: 'tab', targetId: sourceTabId })
  const emptySource = await h.call('cmd_tab_split', h.envelope('tab.split', emptySourcePayload), { approvalHash: emptySourceHash })
  assert.equal(emptySource.ok, false)
  assert.equal(emptySource.error.code, 'TAB_SPLIT_EMPTY_SOURCE')

  const mergePayload = {
    source_tab_id: sourceTabId,
    source_expected_version: 4,
    target_tab_id: targetTabId,
    target_expected_version: 1,
    reason: 'combine checks'
  }
  const mergeHash = sha256Json(mergePayload)
  mergePayload.approval_id = await h.approve('pos.manage', mergeHash, { targetType: 'tab', targetId: sourceTabId })
  const merge = await h.call('cmd_tab_merge', h.envelope('tab.merge', mergePayload), { approvalHash: mergeHash })
  assert.equal(merge.ok, true, JSON.stringify(merge.error))
  assert.equal(merge.result.source_status, 'transferred')
  assert.equal(merge.result.moved_lines, 1)
  assert.equal(merge.result.source_version, 5)
  assert.equal(merge.result.target_version, 2)

  const sourceAfterMerge = await h.query('tab.get', { tab_id: sourceTabId })
  const targetAfterMerge = await h.query('tab.get', { tab_id: targetTabId })
  assert.equal(sourceAfterMerge.data.status, 'transferred')
  assert.equal(sourceAfterMerge.data.lines.length, 0)
  assert.equal(targetAfterMerge.data.status, 'open')
  assert.equal(targetAfterMerge.data.version, 2)
  assert.equal(targetAfterMerge.data.lines.length, 2)
  assert.equal(Number(targetAfterMerge.data.gross_total), 34.2)
  assert.deepEqual(targetAfterMerge.data.lines.map((line) => line.line_number), [1, 2])

  const settle = await h.call('cmd_tab_settle', h.envelope('tab.settle', {
    tab_id: targetTabId,
    expected_version: 2,
    tenders: [{ method: 'cash', amount: '34.20' }]
  }))
  assert.equal(settle.ok, true, JSON.stringify(settle.error))
  assert.equal(Number(settle.receipt.total), 34.2)
  assert.equal(Number(settle.receipt.subtotal), 30)
})

test('tab split and merge reject stale versions and foreign lines without side effects', async (t) => {
  const h = await createHarness(t)
  await h.openShift()

  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'SPLIT-2', name: 'Guard Product', category: 'Test', price: '5.00', tax_rate: '0.00', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id

  const tabA = await h.call('cmd_tab_open', h.envelope('tab.open', { table_label: 'Guard A' }))
  const tabB = await h.call('cmd_tab_open', h.envelope('tab.open', { table_label: 'Guard B' }))
  assert.equal(tabA.ok, true, JSON.stringify(tabA.error))
  assert.equal(tabB.ok, true, JSON.stringify(tabB.error))

  const addA = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: tabA.result.tab_id, expected_version: 1, items: [{ product_id: productId, quantity: '1' }]
  }))
  const addB = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: tabB.result.tab_id, expected_version: 1, items: [{ product_id: productId, quantity: '1' }]
  }))
  assert.equal(addA.ok, true, JSON.stringify(addA.error))
  assert.equal(addB.ok, true, JSON.stringify(addB.error))

  const tabALines = await h.query('tab.get', { tab_id: tabA.result.tab_id })
  const tabBLines = await h.query('tab.get', { tab_id: tabB.result.tab_id })

  const staleMergePayload = {
    source_tab_id: tabA.result.tab_id,
    source_expected_version: 2,
    target_tab_id: tabB.result.tab_id,
    target_expected_version: 1,
    reason: 'stale merge'
  }
  const staleMergeHash = sha256Json(staleMergePayload)
  staleMergePayload.approval_id = await h.approve('pos.manage', staleMergeHash, { targetType: 'tab', targetId: tabA.result.tab_id })
  const staleMerge = await h.call('cmd_tab_merge', h.envelope('tab.merge', staleMergePayload), { approvalHash: staleMergeHash })
  assert.equal(staleMerge.ok, false)
  assert.equal(staleMerge.error.code, 'TAB_VERSION_CONFLICT')

  const foreignLinePayload = {
    source_tab_id: tabA.result.tab_id,
    expected_version: 2,
    line_ids: [tabBLines.data.lines[0].tab_line_id],
    reason: 'foreign line'
  }
  const foreignLineHash = sha256Json(foreignLinePayload)
  foreignLinePayload.approval_id = await h.approve('pos.manage', foreignLineHash, { targetType: 'tab', targetId: tabA.result.tab_id })
  const foreignLine = await h.call('cmd_tab_split', h.envelope('tab.split', foreignLinePayload), { approvalHash: foreignLineHash })
  assert.equal(foreignLine.ok, false)
  assert.equal(foreignLine.error.code, 'TAB_LINE_NOT_FOUND')

  const staleSplitPayload = {
    source_tab_id: tabA.result.tab_id,
    expected_version: 1,
    line_ids: [tabALines.data.lines[0].tab_line_id],
    reason: 'stale split'
  }
  const staleSplitHash = sha256Json(staleSplitPayload)
  staleSplitPayload.approval_id = await h.approve('pos.manage', staleSplitHash, { targetType: 'tab', targetId: tabA.result.tab_id })
  const staleSplit = await h.call('cmd_tab_split', h.envelope('tab.split', staleSplitPayload), { approvalHash: staleSplitHash })
  assert.equal(staleSplit.ok, false)
  assert.equal(staleSplit.error.code, 'TAB_VERSION_CONFLICT')

  const tabAAfter = await h.query('tab.get', { tab_id: tabA.result.tab_id })
  const tabBAfter = await h.query('tab.get', { tab_id: tabB.result.tab_id })
  assert.equal(tabAAfter.data.status, 'open')
  assert.equal(tabAAfter.data.version, 2)
  assert.equal(tabAAfter.data.lines.length, 1)
  assert.equal(tabAAfter.data.lines[0].tab_line_id, tabALines.data.lines[0].tab_line_id)
  assert.equal(tabBAfter.data.status, 'open')
  assert.equal(tabBAfter.data.version, 2)
  assert.equal(tabBAfter.data.lines.length, 1)

  const tabs = await h.query('tabs.list', {})
  assert.equal(tabs.data.length, 2)
  assert.equal(tabs.data.every((tab) => tab.status === 'open'), true)
})
