import test from 'node:test';
import assert from 'node:assert/strict';
import { barLocalNetworkRows } from '../src/renderer/src/components/barLocalAdminResponse.js';

test('Legacy admin network rows distinguish endpoint reachability, readiness and failover evidence', () => {
  const rows = barLocalNetworkRows({
    network: {
      address: { host: '192.168.1.20', port: 8787, scope: 'private' },
      service: { requested: true, reachable: true, live: true, readiness: 'auth_required', readiness_status_code: 401 },
      database: { status: 'reachable' },
      tls: { enabled: true, expired: false },
      write_authority: { granted: false, basis: 'session_required' },
      capabilities: { automatic_failover: { status: 'unavailable', detail: 'No witness evidence.' } }
    },
    database: { database: 'bar_local' }
  });
  assert.deepEqual(rows, [
    ['Client endpoint', '192.168.1.20:8787 · private'],
    ['Service probe', 'endpoint reachable · liveness live · readiness auth_required (HTTP 401)'],
    ['Database', 'reachable · bar_local'],
    ['TLS', 'enabled · current'],
    ['Write authority', 'blocked · session_required'],
    ['Automatic failover', 'unavailable · No witness evidence.']
  ]);
  assert.deepEqual(barLocalNetworkRows({ network: { service: { requested: false } } }), [
    ['Service probe', 'not configured · liveness not configured · readiness unknown']
  ]);
  assert.deepEqual(barLocalNetworkRows({}), []);
});
