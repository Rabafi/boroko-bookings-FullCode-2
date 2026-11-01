import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function checksumOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function listMigrations() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

async function migrationsTableExists(client) {
  const result = await client.query("SELECT to_regclass('bar_local.schema_migrations') AS table_name")
  return Boolean(result.rows[0].table_name)
}

export async function runMigrations(client, { log = () => {} } = {}) {
  // Serialize the history check as well as DDL. Checking before the lock lets
  // two installers both execute a pending non-repeatable migration.
  await client.query('SELECT pg_advisory_lock(173552001)')
  try {
    return await runMigrationsLocked(client, { log })
  } finally {
    await client.query('SELECT pg_advisory_unlock(173552001)')
  }
}

async function runMigrationsLocked(client, { log }) {
  const applied = []
  for (const fileName of await listMigrations()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, fileName), 'utf8')
    const checksum = checksumOf(sql)
    const hasTable = await migrationsTableExists(client)
    if (hasTable) {
      const existing = await client.query('SELECT checksum FROM bar_local.schema_migrations WHERE version = $1', [fileName])
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${fileName}. The local database was built from different bytes.`)
        }
        continue
      }
    }
    log(`applying ${fileName}`)
    await client.query('BEGIN')
    try {
      await client.query('SELECT pg_advisory_xact_lock(173552001)')
      await client.query(sql)
      await client.query(
        'INSERT INTO bar_local.schema_migrations (version, checksum, applied_by) VALUES ($1, $2, current_user) ON CONFLICT (version) DO NOTHING',
        [fileName, checksum]
      )
      await client.query('COMMIT')
      applied.push(fileName)
    } catch (error) {
      await client.query('ROLLBACK')
      const diagnostics = [
        error.code ? `SQLSTATE ${error.code}` : null,
        error.position ? `position ${error.position}` : null,
        error.where ? `context: ${error.where}` : null,
        error.hint ? `hint: ${error.hint}` : null
      ].filter(Boolean).join('; ')
      throw new Error(`Migration ${fileName} failed: ${error.message}${diagnostics ? ` (${diagnostics})` : ''}`, { cause: error })
    }
  }
  return applied
}

export async function resetSchema(client) {
  await client.query('DROP SCHEMA IF EXISTS bar_local CASCADE')
}

export async function seedTestGuard(client, clusterIdentity) {  await client.query(
    `INSERT INTO bar_local.test_guard (singleton, cluster_identity)
     VALUES (true, $1)
     ON CONFLICT (singleton) DO UPDATE SET cluster_identity = EXCLUDED.cluster_identity`,
    [clusterIdentity]
  )
}

export async function seedSetupSecret(client, secretHash, ttlHours = 168) {
  const result = await client.query(
    `INSERT INTO bar_local.setup_state (singleton, secret_hash, expires_at)
     VALUES (true, $1, now() + make_interval(hours => $2))
     ON CONFLICT (singleton) DO UPDATE
       SET secret_hash = EXCLUDED.secret_hash, expires_at = EXCLUDED.expires_at
       WHERE bar_local.setup_state.used_at IS NULL
     RETURNING used_at`,
    [secretHash, ttlHours]
  )
  return result.rowCount > 0 && result.rows[0].used_at === null
}
