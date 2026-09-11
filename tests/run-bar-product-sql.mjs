// Runs tests/bar-product-atomic.sql against an explicit test database.
// Requires BAR_PRODUCT_TEST_DB_URL. Without it, skips with exit 0 so
// normal suites never touch a database. Never defaults to the linked
// project: product acceptance must be opt-in per invocation. Set
// BAR_PRODUCT_STRICT_RELEASE=1 to fail instead of skipping.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = (process.env.BAR_PRODUCT_TEST_DB_URL || '').trim();
const strictRelease = ['1', 'true', 'yes'].includes(String(process.env.BAR_PRODUCT_STRICT_RELEASE || '').trim().toLowerCase());
if (!connectionString) {
  if (strictRelease) {
    console.error('FAIL: BAR_PRODUCT_TEST_DB_URL is not set; strict release mode refuses to skip product SQL verification.');
    process.exit(1);
  }
  console.log('SKIP: BAR_PRODUCT_TEST_DB_URL is not set; product SQL verification skipped.');
  process.exit(0);
}

const { Client } = await import('pg');
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bar-product-atomic.sql'), 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
client.on('notice', (notice) => console.log(String(notice?.message || '').trim()));
try {
  await client.connect();
  await client.query(sql);
  console.log('Product SQL verification passed.');
} catch (error) {
  console.error(`Product SQL verification FAILED: ${error?.message || error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
