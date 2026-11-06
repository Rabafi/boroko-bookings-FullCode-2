import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacy = readFileSync(new URL('../../legacy-pos/src/renderer/src/components/BarLocalAdminPanel.jsx', import.meta.url), 'utf8');
const legacyOperations = readFileSync(new URL('../../legacy-pos/src/renderer/src/components/BarLocalOperationsPanel.jsx', import.meta.url), 'utf8');

test('Legacy export UI requires a confirmed complete unsigned batch and retains same-batch recovery', () => {
  assert.match(legacy, /export\.bundle\.create/);
  assert.match(legacy, /outbox\.bundle\.get/);
  assert.match(legacy, /outbox\.status/);
  assert.match(legacy, /signature_status.*unavailable/);
  assert.match(legacy, /transport_status.*integration_disabled/);
  assert.match(legacy, /event_count.*events.*length/);
  assert.match(legacy, /integrity_valid/);
  assert.match(legacy, /batches_truncated/);
  assert.match(legacy, /50 most recent batches/);
  assert.match(legacy, /exportBatchId/);
  assert.match(legacy, /Save this batch again/);
  assert.match(legacy, /has not been uploaded or acknowledged/);
  assert.match(legacy, /Highest exported sequence/);
  assert.equal((legacy.match(/Highest acknowledged sequence/g) || []).length, 2);
  assert.match(legacy, /gaps and pending work may remain before them/);
  assert.match(legacy, /does not confirm complete ingestion/);
  assert.doesNotMatch(legacy, /Exported checkpoint:|Acknowledged watermark/);
});

test('Legacy loyalty programme editor reads scoped programmes and uses version-checked local writes', () => {
  assert.match(legacy, /loyalty\.programs\.list/);
  assert.match(legacy, /loyalty\.program\.upsert/);
  assert.match(legacy, /expected_version/);
  assert.match(legacy, /business-wide programme/);
  assert.match(legacy, /new-outlet/);
  assert.match(legacy, /business-wide programmes affect all outlets/);
  assert.match(legacy, /hasGlobalLoyaltyProgram/);
  assert.match(legacy, /minimum points must be a whole number/);
});

test('Legacy customer loyalty panel displays a timestamped service balance and rechecks redemption', () => {
  assert.match(legacyOperations, /loyalty\.account\.get/);
  assert.match(legacyOperations, /loyaltyBalanceAsOf/);
  assert.match(legacyOperations, /local authority rechecks balance and programme rules when the operation commits/i);
});
