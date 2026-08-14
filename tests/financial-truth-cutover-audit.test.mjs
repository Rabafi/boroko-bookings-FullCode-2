import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCutoverPacket, parseArgs, sha256Json } from '../scripts/financial-truth-cutover-audit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'supabase/migrations/20260807390000_historical_cutover_audit_and_approval.sql'), 'utf8')

test('cutover audit packet is blocked by any historical or reconciliation exception', () => {
  const packet = buildCutoverPacket({
    lodgeId: 'lodge-1',
    cutoverDate: '2026-08-01',
    periodEnd: '2026-08-07',
    historicalAudit: {
      schema_version: 'historical-cutover-audit-v1',
      source_counts: [],
      source_manifest_hash: 'manifest-1',
      control_totals: {
        candidate_count: 3,
        candidate_total: 100,
        missing_configuration_count: 1,
        unpostable_without_evidence_count: 0
      },
      complete: false,
      blocking_reasons: ['missing_configuration']
    },
    readiness: { ready: false, missing_requirements: ['cash tender mapping'], unposted_expenses: 0, blocking_exceptions: 0 },
    sourceCoverage: { complete: false },
    reconciliation: { unbalanced_journals: 1, blocking_exceptions: 0, source_posting_exceptions: 0 }
  })
  assert.equal(packet.safe_to_approve, false)
  assert.equal(packet.safe_to_activate, false)
  assert.deepEqual(packet.blockers, [
    'missing_configuration',
    'cash tender mapping',
    'post_cutover_source_coverage_incomplete',
    'unbalanced_journals:1'
  ])
  assert.equal(packet.packet_hash, sha256Json({ ...packet, packet_hash: undefined }))
})

test('read-only mode is the default and mutation modes require explicit flags', () => {
  const args = parseArgs(['--lodge-id', 'lodge-1', '--cutover-date', '2026-08-01'])
  assert.equal(args.mode, 'dry-run')
  assert.throws(() => parseArgs(['--lodge-id', 'lodge-1', '--cutover-date', '2026-08-01', '--prepare', '--approve']))
})

test('historical cutover SQL stores a manifest and requires independent approval', () => {
  for (const marker of [
    'get_restaurant_historical_cutover_audit',
    'source_manifest_hash',
    'posted_count',
    'already_posted_count',
    'reversible_count',
    'missing_configuration_count',
    'unpostable_without_evidence_count',
    'approve_restaurant_historical_cutover',
    'apply_restaurant_historical_cutover',
    'post_restaurant_opening_balance',
    'Opening balances must be applied from an approved historical cutover batch',
    'The cutover preparer cannot approve the same batch',
    'Historical source manifest changed after preparation',
    "status = 'approved'"
  ]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
