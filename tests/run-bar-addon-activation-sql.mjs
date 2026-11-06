// Runs tests/bar-addon-activation-isolated.sql against an explicit isolated
// database. Requires BAR_ADDON_ACTIVATION_TEST_DB_URL. Without it, skips with
// exit 0 so normal suites never touch a database. The SQL is transactional and
// rolls back all fixtures. Set BAR_ADDON_ACTIVATION_STRICT_RELEASE=1 to fail
// instead of skipping.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const connectionString = (process.env.BAR_ADDON_ACTIVATION_TEST_DB_URL || '').trim()
const strictRelease = ['1', 'true', 'yes'].includes(String(process.env.BAR_ADDON_ACTIVATION_STRICT_RELEASE || '').trim().toLowerCase())
if (!connectionString) {
  if (strictRelease) {
    console.error('FAIL: BAR_ADDON_ACTIVATION_TEST_DB_URL is not set; strict release mode refuses to skip activation SQL verification.')
    process.exit(1)
  }
  console.log('SKIP: BAR_ADDON_ACTIVATION_TEST_DB_URL is not set; Bar add-on activation SQL verification skipped.')
  process.exit(0)
}

const { Client } = await import('pg')
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bar-addon-activation-isolated.sql'), 'utf8')
const disableSsl = /sslmode=disable/i.test(connectionString)
const client = new Client({ connectionString, ssl: disableSsl ? false : { rejectUnauthorized: false } })
client.on('notice', (notice) => console.log(String(notice?.message || '').trim()))
try {
  await client.connect()
  await client.query(sql)
  console.log('Bar add-on activation SQL verification passed.')
} catch (error) {
  console.error(`Bar add-on activation SQL verification FAILED: ${error?.message || error}`)
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
