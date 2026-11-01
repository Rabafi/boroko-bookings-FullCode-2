import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../dist/config.js'

test('loopback admin database URL is available to protected backup and recovery operations', () => {
  const adminUrl = 'postgresql://postgres:s%40fely-encoded@127.0.0.1:55432/bar_local'
  const config = loadConfig({
    BAR_LOCAL_DB_HOST: '127.0.0.1',
    BAR_LOCAL_DB_PORT: '55432',
    BAR_LOCAL_ADMIN_DATABASE_URL: adminUrl
  })
  assert.equal(config.replication.adminDatabaseUrl, adminUrl)
  assert.equal(config.backup.databaseUrl, adminUrl)
})

test('admin database URL refuses a remote PostgreSQL host', () => {
  assert.throws(() => loadConfig({
    BAR_LOCAL_DB_HOST: '127.0.0.1',
    BAR_LOCAL_ADMIN_DATABASE_URL: 'postgresql://postgres:secret@db.example.invalid:5432/bar_local'
  }), /loopback PostgreSQL host/)
})
