// Runs tests/pos-till-attribution-demo.sql against an explicit test database.
// Requires POS_SETTLEMENT_TEST_DB_URL (reuses the settlement target: the
// demo is always-rolled-back like the settlement proof). Without it, skips
// with exit 0 so normal suites never touch a database. Never defaults to
// the linked project. In strict release mode a missing URL fails instead
// of skipping.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = (process.env.POS_SETTLEMENT_TEST_DB_URL || '').trim();
const strictRelease = ['1', 'true', 'yes'].includes(String(process.env.POS_SETTLEMENT_STRICT_RELEASE || '').trim().toLowerCase());
if (!connectionString) {
  if (strictRelease) {
    console.error('FAIL: POS_SETTLEMENT_TEST_DB_URL is not set; strict release mode refuses to skip attribution proof.');
    process.exit(1);
  }
  console.log('SKIP: POS_SETTLEMENT_TEST_DB_URL is not set; attribution proof skipped.');
  process.exit(0);
}

const { Client } = await import('pg');
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pos-till-attribution-demo.sql'), 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
client.on('notice', (notice) => console.log(String(notice?.message || '').trim()));
try {
  await client.connect();
  await client.query(sql);
  console.log('Attribution proof passed.');
} catch (error) {
  console.error(`Attribution proof FAILED: ${error?.message || error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
