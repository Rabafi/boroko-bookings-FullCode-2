import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyRestoredDatabase } from '../dist/operations/backup.js'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'db', 'migrations')

async function appliedMigrations() {
  const entries = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
  const rows = []
  for (const name of entries) {
    const text = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    rows.push({ version: name, checksum: createHash('sha256').update(text, 'utf8').digest('hex') })
  }
  return rows
}

function passingProbe() {
  return {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('current_user') && sql.includes('service_authority')) {
          return { rows: [{
            current_user: 'bar_local_runtime',
            authority: {
              authority_id: '11111111-1111-1111-1111-111111111111',
              business_id: '22222222-2222-2222-2222-222222222222',
              authority_epoch: '1'
            }
          }] }
        }
        if (sql.includes('cmd_sale_commit')) {
          const error = new Error('invalid session')
          error.code = 'BL001'
          error.detail = 'AUTH_INVALID'
          throw error
        }
        if (sql.includes('sha256_hex') || sql.includes('CREATE TABLE') || sql.includes('INSERT INTO') || sql.includes('FROM bar_local.sales')) {
          const error = new Error('permission denied')
          error.code = '42501'
          throw error
        }
        return { rows: [] }
      },
      end: async () => {}
    })
  }
}

function restoreClient({ applied, authorityFeatures = ['bar_accounting_workforce'], overrides = {} }) {
  return {
    query: async (sql) => {
      for (const [fragment, rows] of Object.entries(overrides)) {
        if (sql.includes(fragment)) return { rows, rowCount: rows.length }
      }
      if (sql.includes('FROM bar_local.schema_migrations') && sql.includes('ORDER BY version')) {
        return { rows: applied, rowCount: applied.length }
      }
      if (sql.includes('FROM bar_local.authority WHERE singleton')) {
        return { rows: [{
          authority_id: '11111111-1111-1111-1111-111111111111',
          authority_epoch: '1',
          business_id: '22222222-2222-2222-2222-222222222222',
          commissioned_at: '2026-01-01T00:00:00.000Z',
          catalogue_version: '1',
          entitlement_version: '1',
          entitlement_features: authorityFeatures
        }], rowCount: 1 }
      }
      if (sql.includes('FROM bar_local.business WHERE id = $1')) {
        return { rows: [{ businesses: 1 }], rowCount: 1 }
      }
      if (sql.includes('FROM bar_local.authority_counter c') && sql.includes('commit_sequence::text')) {
        return { rows: [{
          commit_sequence: '0', receipt_sequence: '0', acknowledged_watermark: '0', exported_watermark: '0', pending_outbox: 0
        }], rowCount: 1 }
      }
      return { rows: [{ violations: 0 }], rowCount: 1 }
    }
  }
}

async function verify({ overrides = {}, authorityFeatures = ['bar_accounting_workforce'], probe = passingProbe() } = {}) {
  return verifyRestoredDatabase(
    restoreClient({ applied: await appliedMigrations(), authorityFeatures, overrides }),
    {
      migrationsDir: MIGRATIONS_DIR,
      database: 'bar_local_test',
      runtimeRole: 'bar_local_runtime',
      expectedMigrationOwner: 'bar_local_migrator',
      runtimeProbe: probe
    }
  )
}

function check(report, name) {
  const found = report.checks.find((entry) => entry.name === name)
  assert.ok(found, `expected check ${name} in ${report.checks.map((entry) => entry.name).join(', ')}`)
  return found
}

test('a consistent restore with a passing runtime probe verifies cleanly', async () => {
  const report = await verify()
  assert.equal(report.ok, true, JSON.stringify(report.failures))
  assert.equal(report.status, 'verified')
  for (const name of [
    'sale_tender_total_matches',
    'source_to_gl_coverage',
    'source_to_gl_not_vacuous',
    'source_to_gl_journal_linkage',
    'source_to_gl_journal_balanced',
    'expense_source_to_gl_coverage',
    'return_line_allocations_match_originals',
    'return_line_cumulative_limits',
    'stock_recipe_depletion_matches',
    'customer_credit_tender_conservation',
    'cashup_expected_cash_recomputes',
    'runtime_authenticated_connectivity',
    'runtime_allowlisted_command_access'
  ]) {
    assert.equal(check(report, name).status, 'pass', name)
  }
})

test('restore evidence labels batch maxima and includes reserved unacknowledged outbox work', async () => {
  let counterSql = ''
  const client = restoreClient({ applied: await appliedMigrations() })
  const query = client.query
  client.query = async (sql, ...args) => {
    if (sql.includes('FROM bar_local.authority_counter c') && sql.includes('commit_sequence::text')) {
      counterSql = sql
      return { rows: [{
        commit_sequence: '12', receipt_sequence: '3', acknowledged_watermark: '10',
        exported_watermark: '12', pending_outbox: 2
      }], rowCount: 1 }
    }
    return query(sql, ...args)
  }
  const report = await verifyRestoredDatabase(client, {
    migrationsDir: MIGRATIONS_DIR,
    database: 'bar_local_test',
    runtimeRole: 'bar_local_runtime',
    expectedMigrationOwner: 'bar_local_migrator',
    runtimeProbe: passingProbe()
  })
  assert.equal(report.counters.highest_acknowledged_sequence, '10')
  assert.equal(report.counters.highest_exported_sequence, '12')
  assert.equal(report.counters.acknowledged_contiguous_checkpoint, null)
  assert.equal(report.counters.pending_outbox, 2)
  assert.match(check(report, 'acknowledgement_watermark_valid').detail, /do not prove a contiguous checkpoint/)
  assert.match(counterSql, /LEFT JOIN bar_local\.export_batches b ON b\.batch_id = o\.export_batch_id/)
  assert.match(counterSql, /o\.export_batch_id IS NULL OR b\.acknowledged_at IS NULL/)
})

test('missing source-to-GL coverage fails with capped evidence', async () => {
  const report = await verify({
    overrides: {
      'check:source_to_gl_coverage': [{ violations: 2, evidence: ['sale-a', 'sale-b'] }]
    }
  })
  assert.equal(report.ok, false)
  assert.ok(report.failures.includes('source_to_gl_coverage'), JSON.stringify(report.failures))
  const found = check(report, 'source_to_gl_coverage')
  assert.equal(found.status, 'fail')
  assert.equal(found.violations, 2)
  assert.deepEqual(found.evidence, ['sale-a', 'sale-b'])
})

test('unbalanced source journals and broken linkages fail closed', async () => {
  const unbalanced = await verify({ overrides: { 'l.debits <> l.credits': [{ violations: 1 }] } })
  assert.equal(check(unbalanced, 'source_to_gl_journal_balanced').status, 'fail')

  const linkage = await verify({ overrides: { 'j.operation_id <> p.operation_id': [{ violations: 3, evidence: ['sale-c'] }] } })
  assert.equal(check(linkage, 'source_to_gl_journal_linkage').status, 'fail')
  assert.equal(check(linkage, 'source_to_gl_journal_linkage').violations, 3)
})

test('return allocation drift from originals and cumulative limits fail closed', async () => {
  const originals = await verify({ overrides: { 'l.returned_quantity': [{ violations: 1, evidence: ['line-1'] }] } })
  assert.equal(check(originals, 'return_line_allocations_match_originals').status, 'fail')

  const cumulative = await verify({ overrides: { allocated_quantity: [{ violations: 1 }] } })
  assert.equal(check(cumulative, 'return_line_cumulative_limits').status, 'fail')
})

test('recipe depletion, customer credit and cash-up inconsistencies fail closed', async () => {
  const recipe = await verify({ overrides: { 'sale.recipe.depletion': [{ violations: 1 }] } })
  assert.equal(check(recipe, 'stock_recipe_depletion_matches').status, 'fail')

  const credit = await verify({ overrides: { credit_tenders: [{ violations: 1, evidence: ['sale-d'] }] } })
  assert.equal(check(credit, 'customer_credit_tender_conservation').status, 'fail')

  const cashup = await verify({ overrides: { 'expected_shift_cash': [{ violations: 1 }] } })
  assert.equal(check(cashup, 'cashup_expected_cash_recomputes').status, 'fail')
})

test('source-to-GL coverage is not required when the accounting feature is disabled', async () => {
  const report = await verify({
    authorityFeatures: [],
    overrides: {
      'check:source_to_gl_coverage': [{ violations: 5 }],
      'sale.recipe.depletion': [{ violations: 9 }]
    }
  })
  const coverage = check(report, 'source_to_gl_coverage')
  assert.equal(coverage.status, 'pass')
  assert.equal(coverage.violations, 0)
  assert.match(coverage.detail, /not required/)
})

test('an unavailable runtime probe fails the restore closed', async () => {
  const report = await verify({
    probe: { connect: async () => { throw new Error('no runtime credentials available') } }
  })
  assert.equal(report.ok, false)
  assert.ok(report.failures.includes('runtime_authenticated_connectivity'))
  assert.equal(check(report, 'runtime_authenticated_connectivity').status, 'fail')
})
