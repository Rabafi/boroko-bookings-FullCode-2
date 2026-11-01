import { randomBytes, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertClusterIdentity, connectionConfig, loadTarget } from './lib/db-target.mjs'
import { runMigrations, seedSetupSecret, seedTestGuard } from './lib/migrate.mjs'

const { Client } = pg
const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function ensureRole(client, role, password) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
  if (!exists.rowCount) {
    const created = await client.query(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', $1::text) AS sql",
      [role]
    )
    await client.query(created.rows[0].sql)
  }
  if (password) {
    const altered = await client.query('SELECT format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text) AS sql', [role, password])
    await client.query(altered.rows[0].sql)
  }
}

async function ensureDatabase(client, database, owner) {
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
  if (!exists.rowCount) {
    const created = await client.query(
      "SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', $1::text, $2::text, 'UTF8') AS sql",
      [database, owner]
    )
    await client.query(created.rows[0].sql)
  }
}

async function grantDatabaseAccess(client, database, roles) {
  const publicRevoke = await client.query("SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', $1::text) AS sql", [database])
  await client.query(publicRevoke.rows[0].sql)
  for (const role of roles) {
    const grant = await client.query("SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS sql", [database, role])
    await client.query(grant.rows[0].sql)
  }
}

async function resolveSetupSecret() {
  const provided = process.env.BAR_LOCAL_SETUP_SECRET
  if (provided) return { secret: provided.trim(), file: null }
  const secret = randomBytes(32).toString('hex')
  const file = process.env.BAR_LOCAL_SETUP_SECRET_FILE
    ? path.resolve(process.env.BAR_LOCAL_SETUP_SECRET_FILE)
    : path.join(SERVICE_DIR, '.local', 'setup-secret.txt')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })
  return { secret, file }
}

async function main() {
  const target = loadTarget({ maintenance: true })
  const databaseName = process.env.BAR_LOCAL_DB_NAME
  if (!databaseName || !/^bar_local_test(?:_|$)/.test(databaseName)) {
    throw new Error('BAR_LOCAL_DB_NAME must name the dedicated bar_local_test database to create.')
  }
  const migratorRole = process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator'
  const runtimeRole = process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime'

  const maintenance = new Client(connectionConfig(target))
  await maintenance.connect()
  let identity
  try {
    identity = await assertClusterIdentity(maintenance, target, { allowAbsentMarker: true })
    await ensureRole(maintenance, migratorRole, process.env.BAR_LOCAL_MIGRATOR_PASSWORD)
    await ensureRole(maintenance, runtimeRole, process.env.BAR_LOCAL_RUNTIME_PASSWORD)
    await ensureDatabase(maintenance, databaseName, migratorRole)
    await grantDatabaseAccess(maintenance, databaseName, [migratorRole, runtimeRole])
  } finally {
    await maintenance.end()
  }

  const migratorTarget = {
    ...target,
    database: databaseName,
    user: migratorRole,
    password: process.env.BAR_LOCAL_MIGRATOR_PASSWORD || undefined,
    maintenance: false
  }
  const business = new Client(connectionConfig(migratorTarget))
  await business.connect()
  try {
    await assertClusterIdentity(business, migratorTarget, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    const applied = await runMigrations(business, { log: (line) => console.log(line) })
    await seedTestGuard(business, target.clusterData)
    await assertClusterIdentity(business, migratorTarget, { allowUnreadableDataDirectory: true })
    const resolved = await resolveSetupSecret()
    const secretHash = createHash('sha256').update(resolved.secret, 'utf8').digest('hex')
    const seeded = await seedSetupSecret(business, secretHash)
    console.log(`bootstrap complete: database=${databaseName} migrations=${applied.length} cluster=${identity.serverVersion}`)
    if (resolved.file) console.log(`setup secret written to ${resolved.file}`)
    console.log(`setup secret ${seeded ? 'ready' : 'already used; left unchanged'}`)
  } finally {
    await business.end()
  }
}

main().catch((error) => {
  console.error(`bootstrap failed: ${error.message}`)
  process.exitCode = 1
})
