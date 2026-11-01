import test from 'node:test'
import assert from 'node:assert/strict'
import { adminBackupPackages, adminNetworkRows, adminReplicationPayload, adminStatusPayload } from '../../src/renderer/src/components/hospitality-pos/bar-local/adminResponse.js'

test('Modern admin panel unwraps the service status and replication envelopes', () => {
  const status = adminStatusPayload({ ok: true, status: { database: { database: 'bar_local' }, backup: { destination_status: 'unavailable' } } })
  const replication = adminReplicationPayload({ ok: true, command: 'replication-status', replication: { role: 'primary', automatic_failover: { verified: false } } })
  assert.equal(status.database.database, 'bar_local')
  assert.equal(status.backup.destination_status, 'unavailable')
  assert.equal(replication.role, 'primary')
  assert.deepEqual(replication.automatic_failover, { verified: false })
})

test('Modern admin backup list reads packages and skips malformed entries', () => {
  assert.deepEqual(adminBackupPackages({ ok: true, packages: [{ file_name: 'backup.blb' }, null, 'invalid'] }), [{ file_name: 'backup.blb' }])
  assert.deepEqual(adminBackupPackages({ ok: true, packages: [] }), [])
})

test('network diagnostics distinguish endpoint reachability from readiness and failover evidence', () => {
  const rows = adminNetworkRows({ status: {
    network: {
      address: { host: '192.168.1.20', port: 8787, scope: 'private' },
      service: { requested: true, reachable: true, live: true, readiness: 'auth_required', readiness_status_code: 401 },
      database: { status: 'reachable' },
      tls: { enabled: true, expired: false },
      write_authority: { granted: false, basis: 'session_required' },
      capabilities: { automatic_failover: { status: 'unavailable', detail: 'No witness evidence.' } }
    },
    database: { database: 'bar_local' }
  } })
  assert.deepEqual(rows, [
    ['Client endpoint', '192.168.1.20:8787 · private'],
    ['Service probe', 'endpoint reachable · liveness live · readiness auth_required (HTTP 401)'],
    ['Database', 'reachable · bar_local'],
    ['TLS', 'enabled · current'],
    ['Write authority', 'blocked · session_required'],
    ['Automatic failover', 'unavailable · No witness evidence.']
  ])
  assert.deepEqual(adminNetworkRows({ status: { network: { service: { requested: false } } } }), [
    ['Service probe', 'not configured · liveness not configured · readiness unknown']
  ])
  assert.deepEqual(adminNetworkRows({}), [])
})
