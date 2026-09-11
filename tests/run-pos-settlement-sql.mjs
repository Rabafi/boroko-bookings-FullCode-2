// Runs tests/pos-tab-settlement-atomic.sql against an explicit test database.
// Requires POS_SETTLEMENT_TEST_DB_URL. Without it, skips with exit 0 so
// normal suites never touch a database. Never defaults to the linked
// project: settlement verification must be opt-in per invocation.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = (process.env.POS_SETTLEMENT_TEST_DB_URL || '').trim();
const strictRelease = ['1', 'true', 'yes'].includes(String(process.env.POS_SETTLEMENT_STRICT_RELEASE || '').trim().toLowerCase());
if (!connectionString) {
  if (strictRelease) {
    console.error('FAIL: POS_SETTLEMENT_TEST_DB_URL is not set; strict release mode refuses to skip settlement SQL verification.');
    process.exit(1);
  }
  console.log('SKIP: POS_SETTLEMENT_TEST_DB_URL is not set; settlement SQL verification skipped.');
  process.exit(0);
}

const { Client } = await import('pg');
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pos-tab-settlement-atomic.sql'), 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
client.on('notice', (notice) => console.log(String(notice?.message || '').trim()));
try {
  await client.connect();
  await client.query(sql);
  console.log('Settlement SQL verification passed.');
} catch (error) {
  console.error(`Settlement SQL verification FAILED: ${error?.message || error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
