import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modern = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/BarLocalAdminPanel.jsx', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../../legacy-pos/src/renderer/src/components/BarLocalAdminPanel.jsx', import.meta.url), 'utf8');
const modernOperations = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/bar-local/BarLocalOperationsPanel.jsx', import.meta.url), 'utf8');
const legacyOperations = readFileSync(new URL('../../legacy-pos/src/renderer/src/components/BarLocalOperationsPanel.jsx', import.meta.url), 'utf8');

for (const [name, source] of [['Modern', modern], ['Legacy', legacy]]) {
  test(`${name} export UI requires a confirmed complete unsigned batch and retains same-batch recovery`, () => {
    assert.match(source, /export\.bundle\.create/);
    assert.match(source, /outbox\.bundle\.get/);
    assert.match(source, /outbox\.status/);
    assert.match(source, /signature_status.*unavailable/);
    assert.match(source, /transport_status.*integration_disabled/);
    assert.match(source, /event_count.*events.*length/);
    assert.match(source, /integrity_valid/);
    assert.match(source, /batches_truncated/);
    assert.match(source, /50 most recent batches/);
    assert.match(source, /exportBatchId/);
    assert.match(source, /Save this batch again/);
    assert.match(source, /has not been uploaded or acknowledged/);
    assert.match(source, /Highest exported sequence/);
    assert.equal((source.match(/Highest acknowledged sequence/g) || []).length, 2);
    assert.match(source, /gaps and pending work may remain before them/);
    assert.match(source, /does not confirm complete ingestion/);
    assert.doesNotMatch(source, /Exported checkpoint:|Acknowledged watermark/);
  });

  test(`${name} loyalty programme editor reads scoped programmes and uses version-checked local writes`, () => {
    assert.match(source, /loyalty\.programs\.list/);
    assert.match(source, /loyalty\.program\.upsert/);
    assert.match(source, /expected_version/);
    assert.match(source, /business-wide programme/);
    assert.match(source, /new-outlet/);
    assert.match(source, /business-wide programmes affect all outlets/);
    assert.match(source, /hasGlobalLoyaltyProgram/);
    assert.match(source, /minimum points must be a whole number/);
  });
}

for (const [name, source] of [['Modern', modernOperations], ['Legacy', legacyOperations]]) {
  test(`${name} customer loyalty panel displays a timestamped service balance and rechecks redemption`, () => {
    assert.match(source, /loyalty\.account\.get/);
    assert.match(source, /loyaltyBalanceAsOf/);
    assert.match(source, /local authority rechecks balance and programme rules when the operation commits/i);
  });
}
