import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('audit search is read-only and requires settings management', () => {
  assert.equal(QUERIES['audit.search'].version, 1)
  assert.equal(QUERIES['audit.search'].capability, CAPABILITIES.SETTINGS_MANAGE)
  assert.deepEqual(QUERIES['audit.search'].validate({ action: 'catalogue.upsert', search: 'SKU-1', limit: 50, cursor: '400' }), {
    action: 'catalogue.upsert', search: 'SKU-1', limit: 50, cursor: '400'
  })
  assert.throws(() => QUERIES['audit.search'].validate({ outlet_id: 'foreign-outlet' }), /outlet_id/)
})

test('local support report input is bounded to the redacted report contract', () => {
  assert.equal(COMMANDS['support.report.create'].capability, CAPABILITIES.SETTINGS_MANAGE)
  const payload = {
    category: 'operations', severity: 'normal', subject: 'Till cannot start shift', message: 'The service reports blocked readiness.',
    diagnostics: { service_ready: false }, metadata: { application: 'hospitality-pos' }
  }
  assert.deepEqual(COMMANDS['support.report.create'].validate(payload), payload)
  assert.throws(() => COMMANDS['support.report.create'].validate({ ...payload, severity: 'urgent' }), /severity/)
  assert.throws(() => COMMANDS['support.report.create'].validate({ ...payload, access_token: 'secret' }), /access_token/)
})

test('local support report history is outlet-scoped and settings-managed', () => {
  assert.equal(QUERIES['support.reports.list'].capability, CAPABILITIES.SETTINGS_MANAGE)
  assert.deepEqual(QUERIES['support.reports.list'].validate({ limit: 50, cursor: '2026-10-29T12:00:00.000000Z|10000000-0000-4000-8000-000000000001' }), {
    limit: 50,
    cursor: '2026-10-29T12:00:00.000000Z|10000000-0000-4000-8000-000000000001'
  })
  assert.throws(() => QUERIES['support.reports.list'].validate({ message: 'not a filter' }), /message/)
})
