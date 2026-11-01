import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

const ACCOUNTING_FEATURES = ['bar_growth_multi_outlet', 'bar_accounting_workforce']

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

async function seedChart(h) {
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('1010','Card clearing','asset'), ('1020','Bank','asset'),
       ('1030','Mobile money clearing','asset'), ('1040','External clearing','asset'),
       ('1100','Accounts receivable','asset'), ('2100','Tax payable','liability'),
       ('2200','Voucher liability','liability'), ('2300','Tips payable','liability'),
       ('4000','Sales revenue','revenue')`
  )
}

async function createProduct(h, overrides = {}) {
  const result = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: overrides.sku ?? 'GL-TEST',
    name: overrides.name ?? 'GL test item',
    category: 'Test',
    price: overrides.price ?? '10.00',
    tax_rate: overrides.tax_rate ?? '0.10',
    track_stock: false
  }))
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.product_id
}

function saleEnvelope(h, shiftId, productId, { quantity = '1', method = 'cash', amount = '11.00' } = {}) {
  return h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [method === 'cash'
      ? { method, amount, tendered: amount }
      : { method, amount, reference: 'CARD-1' }]
  })
}

async function entryFor(h, sourceType, sourceId) {
  const result = await h.migrator.query(
    `SELECT je.id, je.source_type, je.source_id, je.operation_id, je.period,
            to_char(je.entry_date, 'YYYY-MM-DD') AS entry_date
       FROM bar_local.source_gl_postings p
       JOIN bar_local.journal_entries je ON je.id = p.journal_entry_id
      WHERE p.source_type = $1 AND p.source_id = $2`,
    [sourceType, sourceId]
  )
  assert.equal(result.rowCount, 1, `expected one source posting for ${sourceType}/${sourceId}`)
  return result.rows[0]
}

async function entryLines(h, entryId) {
  const result = await h.migrator.query(
    `SELECT account_code, debit, credit FROM bar_local.journal_lines WHERE entry_id = $1 ORDER BY id`,
    [entryId]
  )
  return result.rows
}

function totals(lines) {
  return lines.reduce((acc, line) => ({
    debit: acc.debit + Number(line.debit),
    credit: acc.credit + Number(line.credit)
  }), { debit: 0, credit: 0 })
}

test('completed sale, partial return and void each post one balanced source journal', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ACCOUNTING_FEATURES })
  await seedChart(h)
  const date = await businessDate(h)
  const period = date.slice(0, 7)
  const shiftId = await h.openShift('100.00')
  const productId = await createProduct(h)

  const salePayload = saleEnvelope(h, shiftId, productId, { quantity: '2', amount: '22.00' })
  const sale = await h.call('cmd_sale_commit', salePayload)
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id

  const saleEntry = await entryFor(h, 'sale', saleId)
  assert.equal(saleEntry.period, period)
  assert.equal(saleEntry.entry_date, date)
  const saleLines = await entryLines(h, saleEntry.id)
  const saleTotals = totals(saleLines)
  assert.equal(saleTotals.debit, 22)
  assert.equal(saleTotals.credit, 22)
  assert.equal(saleLines.filter((line) => line.account_code === '1000' && Number(line.debit) === 22).length, 1)
  assert.equal(saleLines.filter((line) => line.account_code === '4000' && Number(line.credit) === 20).length, 1)
  assert.equal(saleLines.filter((line) => line.account_code === '2100' && Number(line.credit) === 2).length, 1)

  const replay = await h.call('cmd_sale_commit', salePayload)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
  const salePosts = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.source_gl_postings WHERE source_type = 'sale' AND source_id = $1`,
    [saleId]
  )
  assert.equal(salePosts.rows[0].count, 1)

  const returnPayload = {
    sale_id: saleId,
    lines: [{ sale_line_id: sale.result.receipt.lines[0].sale_line_id, quantity: '1' }],
    reason: 'Partial return',
    disposition: 'restock'
  }
  const returnHash = sha256Json(returnPayload)
  const returnApproval = await h.approve('pos.void', returnHash, { targetType: 'sale', targetId: saleId })
  const returned = await h.callWith(h.runtime, 'cmd_sale_return', h.envelope('sale.return', {
    ...returnPayload,
    approval_id: returnApproval
  }), { hash: returnHash, approvalHash: returnHash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  assert.equal(Number(returned.result.total), -11)

  const returnEntry = await entryFor(h, 'sale.return', returned.result.sale_id)
  const returnLines = await entryLines(h, returnEntry.id)
  const returnTotals = totals(returnLines)
  assert.equal(returnTotals.debit, 11)
  assert.equal(returnTotals.credit, 11)
  assert.equal(returnLines.filter((line) => line.account_code === '4000' && Number(line.debit) === 10).length, 1)
  assert.equal(returnLines.filter((line) => line.account_code === '2100' && Number(line.debit) === 1).length, 1)
  assert.equal(returnLines.filter((line) => line.account_code === '1000' && Number(line.credit) === 11).length, 1)

  const cardSale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, productId, { method: 'card', amount: '11.00' }))
  assert.equal(cardSale.ok, true, JSON.stringify(cardSale.error))
  const cardSaleId = cardSale.result.sale_id
  const cardEntry = await entryFor(h, 'sale', cardSaleId)
  const cardLines = await entryLines(h, cardEntry.id)
  assert.equal(cardLines.filter((line) => line.account_code === '1010' && Number(line.debit) === 11).length, 1)

  const voidPayload = { sale_id: cardSaleId, reason: 'Wrong order' }
  const voidHash = sha256Json(voidPayload)
  const voidApproval = await h.approve('pos.void', voidHash, { targetType: 'sale', targetId: cardSaleId })
  const voided = await h.callWith(h.runtime, 'cmd_sale_void', h.envelope('sale.void', {
    ...voidPayload,
    approval_id: voidApproval
  }), { hash: voidHash, approvalHash: voidHash })
  assert.equal(voided.ok, true, JSON.stringify(voided.error))
  assert.equal(Number(voided.result.total), -11)

  const voidEntry = await entryFor(h, 'sale.void', voided.result.sale_id)
  const voidLines = await entryLines(h, voidEntry.id)
  const voidTotals = totals(voidLines)
  assert.equal(voidTotals.debit, 11)
  assert.equal(voidTotals.credit, 11)
  assert.equal(voidLines.filter((line) => line.account_code === '4000' && Number(line.debit) === 10).length, 1)
  assert.equal(voidLines.filter((line) => line.account_code === '2100' && Number(line.debit) === 1).length, 1)
  assert.equal(voidLines.filter((line) => line.account_code === '1010' && Number(line.credit) === 11).length, 1)

  const coverage = await h.migrator.query(
    `SELECT (SELECT count(*) FROM bar_local.sales)::int AS sales,
            (SELECT count(*) FROM bar_local.source_gl_postings)::int AS links,
            (SELECT count(*) FROM (
               SELECT source_id FROM bar_local.source_gl_postings GROUP BY source_id HAVING count(*) > 1
             ) duplicates)::int AS duplicate_sources`
  )
  assert.equal(coverage.rows[0].sales, coverage.rows[0].links)
  assert.equal(coverage.rows[0].duplicate_sources, 0)

  const unbalanced = await h.migrator.query(
    `SELECT count(*)::int AS count FROM (
       SELECT je.id
         FROM bar_local.journal_entries je
         JOIN bar_local.journal_lines jl ON jl.entry_id = je.id
        WHERE je.source_type IN ('sale', 'sale.return', 'sale.void')
        GROUP BY je.id
       HAVING round(sum(jl.debit), 2) <> round(sum(jl.credit), 2)
     ) rows`
  )
  assert.equal(unbalanced.rows[0].count, 0)
})

test('source posting stays disabled when the accounting entitlement is absent', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift('100.00')
  const productId = await createProduct(h)

  const sale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, productId))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))

  const journals = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.journal_entries')
  const postings = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.source_gl_postings')
  const sales = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.sales')
  assert.equal(journals.rows[0].count, 0)
  assert.equal(postings.rows[0].count, 0)
  assert.equal(sales.rows[0].count, 1)
})

test('a missing required account refuses the sale and rolls back the financial mutation', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ACCOUNTING_FEATURES })
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES ('4000','Sales revenue','revenue')`
  )
  const shiftId = await h.openShift('100.00')
  const productId = await createProduct(h)

  const sale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, productId))
  assert.equal(sale.ok, false)
  assert.equal(sale.error.code, 'SOURCE_POSTING_ACCOUNT_MISSING')

  const sales = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.sales')
  const journals = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.journal_entries')
  const postings = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.source_gl_postings')
  assert.equal(sales.rows[0].count, 0)
  assert.equal(journals.rows[0].count, 0)
  assert.equal(postings.rows[0].count, 0)
})

test('a closed accounting period refuses the sale and leaves no financial work unposted', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ACCOUNTING_FEATURES })
  await seedChart(h)
  const date = await businessDate(h)
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_periods (period, status, closed_at) VALUES ($1, 'closed', now())`,
    [date.slice(0, 7)]
  )
  const shiftId = await h.openShift('100.00')
  const productId = await createProduct(h)

  const sale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, productId))
  assert.equal(sale.ok, false)
  assert.equal(sale.error.code, 'PERIOD_LOCKED')

  const sales = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.sales')
  const journals = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.journal_entries')
  assert.equal(sales.rows[0].count, 0)
  assert.equal(journals.rows[0].count, 0)
})
