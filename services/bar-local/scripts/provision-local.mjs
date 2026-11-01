#!/usr/bin/env node
// Production provisioning for the installed local Bar service.
//
// This is deliberately separate from bootstrap-local.mjs, which is test-only
// and requires BAR_LOCAL_TEST_DB and a bar_local_test database. This script
// never creates or accepts a test guard, never uses a hosted connection, and
// binds the database to an explicit PostgreSQL data directory.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { listMigrations, runMigrations, seedSetupSecret } from './lib/migrate.mjs'
import { hasPopulatedTestGuard } from './lib/provision-policy.mjs'

const { Client } = pg
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = path.join(SERVICE_ROOT, 'db', 'migrations')
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const PRODUCTION_DB_RE = /^bar_local(?:_|$)/
const TEST_DB_RE = /^bar_local_test(?:_|$)/
const ROLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const RUNTIME_ROLE = 'bar_local_runtime'
const MARKER_TABLE = 'bar_local.provision_marker'
const FORBIDDEN_CONNECTION_VARS = ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_POOLER_URL']
const PROVISIONER_VERSION = '1'

class ProvisionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProvisionError'
  }
}

function required(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new ProvisionError(`Missing required environment variable ${name}.`)
  }
  return String(value).trim()
}

function optional(name) {
  const value = process.env[name]
  return value && String(value).trim() ? String(value).trim() : null
}

function boolean(name) {
  const value = optional(name)
  return value === '1' || (value !== null && value.toLowerCase() === 'true')
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase()
}

function assertProductionEnvironment() {
  if (process.env.BAR_LOCAL_PROVISION !== '1') {
    throw new ProvisionError('Refusing to provision production data: set BAR_LOCAL_PROVISION=1 explicitly.')
  }
  if (process.env.BAR_LOCAL_TEST_DB === '1') {
    throw new ProvisionError('Refusing to run production provisioning while BAR_LOCAL_TEST_DB=1 is set.')
  }
  for (const name of FORBIDDEN_CONNECTION_VARS) {
    if (process.env[name]) {
      throw new ProvisionError(`Refusing to provision: ${name} is set. The local Bar service never uses a hosted connection variable.`)
    }
  }
  if (process.env.PGHOST && !LOOPBACK_HOSTS.has(process.env.PGHOST.toLowerCase())) {
    throw new ProvisionError('Refusing to provision: PGHOST points outside loopback. Provision only a local PostgreSQL cluster.')
  }
  const host = required('BAR_LOCAL_DB_HOST').toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ProvisionError('Refusing to provision: BAR_LOCAL_DB_HOST must be a loopback host.')
  }
  const port = Number.parseInt(required('BAR_LOCAL_DB_PORT'), 10)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ProvisionError('BAR_LOCAL_DB_PORT must be an explicit TCP port between 1024 and 65535.')
  }
  if (port === 5432) {
    throw new ProvisionError('BAR_LOCAL_DB_PORT must not be the default port 5432. Use a dedicated Bar instance port.')
  }
  const database = required('BAR_LOCAL_DB_NAME')
  if (!PRODUCTION_DB_RE.test(database)) {
    throw new ProvisionError('BAR_LOCAL_DB_NAME must start with bar_local (for example bar_local or bar_local_prod).')
  }
  if (TEST_DB_RE.test(database)) {
    throw new ProvisionError('Refusing to provision a bar_local_test database. Test databases use scripts/bootstrap-local.mjs only.')
  }
  const dataDir = required('BAR_LOCAL_PG_DATA_DIR')
  if (!path.isAbsolute(dataDir)) {
    throw new ProvisionError('BAR_LOCAL_PG_DATA_DIR must be an absolute path.')
  }
  const migratorUser = optional('BAR_LOCAL_MIGRATOR_USER') || 'bar_local_migrator'
  const runtimeUser = optional('BAR_LOCAL_RUNTIME_USER') || RUNTIME_ROLE
  if (!ROLE_RE.test(migratorUser) || !ROLE_RE.test(runtimeUser)) {
    throw new ProvisionError('Migrator and runtime role names must be valid unquoted PostgreSQL identifiers.')
  }
  if (migratorUser === runtimeUser) {
    throw new ProvisionError('The migrator and runtime roles must be distinct.')
  }
  if (runtimeUser !== RUNTIME_ROLE) {
    throw new ProvisionError(`The runtime role must be ${RUNTIME_ROLE}; the versioned grant migration is bound to that role name.`)
  }
  const migratorPassword = required('BAR_LOCAL_MIGRATOR_PASSWORD')
  const runtimePassword = required('BAR_LOCAL_RUNTIME_PASSWORD')
  if (migratorPassword.length < 24 || runtimePassword.length < 24) {
    throw new ProvisionError('Migrator and runtime passwords must each contain at least 24 characters.')
  }
  return {
    host,
    port,
    database,
    dataDir: path.resolve(dataDir),
    migratorUser,
    runtimeUser,
    migratorPassword,
    runtimePassword,
    upgrade: boolean('BAR_LOCAL_PROVISION_UPGRADE')
  }
}

function bootstrapCredentials() {
  const user = optional('BAR_LOCAL_BOOTSTRAP_USER') || 'postgres'
  if (!ROLE_RE.test(user)) {
    throw new ProvisionError('BAR_LOCAL_BOOTSTRAP_USER must be a valid unquoted PostgreSQL identifier.')
  }
  const direct = optional('BAR_LOCAL_BOOTSTRAP_PASSWORD')
  const file = optional('BAR_LOCAL_BOOTSTRAP_PASSWORD_FILE')
  if (direct && file) {
    throw new ProvisionError('Set either BAR_LOCAL_BOOTSTRAP_PASSWORD or BAR_LOCAL_BOOTSTRAP_PASSWORD_FILE, not both.')
  }
  return { user, password: direct, passwordFile: file }
}

async function bootstrapPassword(credentials) {
  if (credentials.password) return credentials.password
  if (!credentials.passwordFile) {
    throw new ProvisionError('A PostgreSQL bootstrap password is required to create roles and the database. Set BAR_LOCAL_BOOTSTRAP_PASSWORD_FILE (preferred) or BAR_LOCAL_BOOTSTRAP_PASSWORD.')
  }
  try {
    const value = (await readFile(path.resolve(credentials.passwordFile), 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!value) throw new Error('empty file')
    return value
  } catch {
    throw new ProvisionError(`The PostgreSQL bootstrap password file could not be read: ${credentials.passwordFile}`)
  }
}

function connectionOptions(target, { user, password, database }) {
  return {
    host: target.host,
    port: target.port,
    database,
    user,
    password: password || undefined,
    application_name: 'bar-local-provision',
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000
  }
}

async function connect(target, options, purpose) {
  const client = new Client(connectionOptions(target, options))
  client.on('error', () => {})
  try {
    await client.connect()
  } catch (error) {
    throw new ProvisionError(`Could not connect to PostgreSQL as ${options.user} for ${purpose}: ${error.message}`)
  }
  return client
}

async function assertClusterIdentity(client, target) {
  let dataDirectory
  let port
  try {
    dataDirectory = (await client.query('SHOW data_directory')).rows[0].data_directory
    port = Number.parseInt((await client.query('SHOW port')).rows[0].port, 10)
  } catch (error) {
    throw new ProvisionError(`Could not read the PostgreSQL data directory. Provisioning requires a superuser bootstrap connection: ${error.message}`)
  }
  if (normalizePath(dataDirectory) !== normalizePath(target.dataDir)) {
    throw new ProvisionError(`Refusing to provision: connected cluster data directory ${dataDirectory} does not match BAR_LOCAL_PG_DATA_DIR ${target.dataDir}.`)
  }
  if (port !== target.port) {
    throw new ProvisionError(`Refusing to provision: connected server port ${port} does not match BAR_LOCAL_DB_PORT ${target.port}.`)
  }
  const address = (await client.query('SELECT inet_server_addr()::text AS address')).rows[0].address
  if (address) {
    const host = address.split('/')[0].toLowerCase()
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new ProvisionError(`Refusing to provision: connected server address ${address} is not loopback.`)
    }
  }
  const version = (await client.query('SHOW server_version')).rows[0].server_version
  const major = Number.parseInt(version, 10)
  if (major !== 17) {
    throw new ProvisionError(`PostgreSQL 17 is required for this local Bar release; the connected server reports ${version}.`)
  }
  return { dataDirectory, port, version }
}

async function databaseExists(client, database) {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
  return result.rowCount > 0
}

async function databaseEncoding(client, database) {
  const result = await client.query(
    `SELECT pg_encoding_to_char(encoding) AS encoding,
            pg_get_userbyid(datdba) AS owner
       FROM pg_database
      WHERE datname = $1`,
    [database]
  )
  return result.rows[0] || null
}

async function schemaState(client) {
  const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'bar_local'")
  if (!schema.rowCount) {
    return { exists: false, objects: 0, marker: false, guarded: false, migrations: 0 }
  }
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'bar_local' AND c.relkind IN ('r','p','v','m','S','f')) AS relations,
       (SELECT count(*)::int FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'bar_local') AS functions,
       (SELECT count(*)::int FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'bar_local' AND t.typtype IN ('c','e','d')) AS types`
  )
  const row = counts.rows[0]
  const objects = Number(row.relations) + Number(row.functions) + Number(row.types)
  const marker = Boolean((await client.query("SELECT to_regclass('bar_local.provision_marker') AS marker")).rows[0].marker)
  const guarded = await hasPopulatedTestGuard(client)
  let migrations = 0
  if ((await client.query("SELECT to_regclass('bar_local.schema_migrations') AS marker")).rows[0].marker) {
    migrations = (await client.query('SELECT count(*)::int AS count FROM bar_local.schema_migrations')).rows[0].count
  }
  return { exists: true, objects, marker, guarded, migrations }
}

async function readMarker(client) {
  if (!(await client.query("SELECT to_regclass($1) AS marker", [MARKER_TABLE])).rows[0].marker) return null
  const result = await client.query(
    'SELECT pg_data_dir, database_name, created_at, updated_at FROM bar_local.provision_marker WHERE singleton'
  )
  return result.rows[0] || null
}

function checksumOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function assertAppliedMigrationsMatch(client) {
  const local = new Map()
  for (const fileName of await listMigrations()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, fileName), 'utf8')
    local.set(fileName, checksumOf(sql))
  }
  let rows
  try {
    rows = (await client.query('SELECT version, checksum FROM bar_local.schema_migrations')).rows
  } catch {
    throw new ProvisionError('The existing bar_local schema has no readable schema_migrations table. Refusing to adopt an unknown database; use an explicit reviewed adoption procedure.')
  }
  if (rows.length === 0) {
    throw new ProvisionError('The existing bar_local schema has no applied migrations. Refusing to adopt an unknown database.')
  }
  for (const row of rows) {
    const expected = local.get(row.version)
    if (!expected) {
      throw new ProvisionError(`The existing database contains migration ${row.version}, which is not present in this release. Refusing to downgrade or adopt a newer schema.`)
    }
    if (expected !== row.checksum) {
      throw new ProvisionError(`Migration checksum mismatch for ${row.version}. The existing database was built from different bytes.`)
    }
  }
}

async function ensureRole(client, role, password, { replication = false } = {}) {
  const existing = await client.query(
    `SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
    [role]
  )
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.rolsuper || row.rolcreatedb || row.rolcreaterole) {
      throw new ProvisionError(`Role ${role} already exists with superuser, CREATEDB or CREATEROLE rights. Refusing to use a privileged role for the local Bar service.`)
    }
    if (row.rolbypassrls) {
      throw new ProvisionError(`Role ${role} already exists with BYPASSRLS. Refusing to use it for the local Bar service.`)
    }
    if (!row.rolcanlogin) {
      await client.query('SELECT format(\'ALTER ROLE %I LOGIN\', $1::text)', [role]).then((result) => client.query(result.rows[0].format))
    }
    if (replication && !row.rolreplication) {
      await client.query('SELECT format(\'ALTER ROLE %I REPLICATION\', $1::text)', [role]).then((result) => client.query(result.rows[0].format))
    }
  } else {
    const createSql = replication
      ? "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS REPLICATION', $1::text) AS sql"
      : "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', $1::text) AS sql"
    const created = await client.query(createSql, [role])
    await client.query(created.rows[0].sql)
  }
  const altered = await client.query("SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql", [role, password])
  await client.query(altered.rows[0].sql)
}

async function ensureDatabase(client, database, owner) {
  if (!(await databaseExists(client, database))) {
    const created = await client.query(
      "SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', $1::text, $2::text, 'UTF8') AS sql",
      [database, owner]
    )
    await client.query(created.rows[0].sql)
    return { created: true }
  }
  const info = await databaseEncoding(client, database)
  if (!info) throw new ProvisionError(`Database ${database} was not found after creation.`)
  if (info.encoding !== 'UTF8') {
    throw new ProvisionError(`Database ${database} uses ${info.encoding} encoding. The local Bar database must be UTF8.`)
  }
  if (info.owner !== owner) {
    if (info.owner !== (optional('BAR_LOCAL_BOOTSTRAP_USER') || 'postgres')) {
      throw new ProvisionError(`Database ${database} is owned by ${info.owner}, not by the configured migrator role ${owner}. Refusing to take ownership of an unrelated database.`)
    }
    const altered = await client.query("SELECT format('ALTER DATABASE %I OWNER TO %I', $1::text, $2::text) AS sql", [database, owner])
    await client.query(altered.rows[0].sql)
  }
  return { created: false }
}

async function grantDatabaseAccess(client, database, roles) {
  const revoke = await client.query("SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', $1::text) AS sql", [database])
  await client.query(revoke.rows[0].sql)
  for (const role of roles) {
    const grant = await client.query("SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS sql", [database, role])
    await client.query(grant.rows[0].sql)
  }
}

async function ensureMarker(client, target) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS bar_local.provision_marker (
       singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
       pg_data_dir text NOT NULL,
       database_name text NOT NULL,
       provisioner text NOT NULL,
       provisioner_version text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  )
  await client.query(
    `INSERT INTO bar_local.provision_marker (singleton, pg_data_dir, database_name, provisioner, provisioner_version)
     VALUES (true, $1, $2, 'provision-local.mjs', $3)
     ON CONFLICT (singleton) DO UPDATE
       SET pg_data_dir = EXCLUDED.pg_data_dir,
           database_name = EXCLUDED.database_name,
           provisioner = EXCLUDED.provisioner,
           provisioner_version = EXCLUDED.provisioner_version,
           updated_at = now()`,
    [normalizePath(target.dataDir), target.database, PROVISIONER_VERSION]
  )
}

async function resolveSetupSecret() {
  const file = path.resolve(required('BAR_LOCAL_SETUP_SECRET_FILE'))
  const direct = optional('BAR_LOCAL_SETUP_SECRET')
  let secret = null
  let generated = false
  let existed = false
  try {
    const value = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim()
    if (value) {
      existed = true
      secret = value
    }
  } catch {
    // The file is created below.
  }
  if (direct && secret && direct !== secret) {
    throw new ProvisionError('BAR_LOCAL_SETUP_SECRET does not match the existing setup secret file. Refusing to replace an owner setup secret implicitly.')
  }
  if (!secret && direct) secret = direct
  if (!secret) {
    secret = randomBytes(32).toString('hex')
    generated = true
  }
  if (secret.length < 32) {
    throw new ProvisionError('The setup secret must contain at least 32 characters.')
  }
  if (generated || !existed) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  return { secret, file, generated: generated || !existed }
}

async function main() {
  const target = assertProductionEnvironment()
  const bootstrap = bootstrapCredentials()
  const password = await bootstrapPassword(bootstrap)
  const upgrade = target.upgrade
  const summary = {
    ok: true,
    database: target.database,
    host: target.host,
    port: target.port,
    pg_data_dir: target.dataDir,
    runtime_role: target.runtimeUser,
    migrator_role: target.migratorUser,
    upgrade
  }

  const maintenance = await connect(target, { user: bootstrap.user, password, database: 'postgres' }, 'provisioning')
  let applied = []
  let setupSecret = null
  let seeded = false
  let marker = null
  try {
    const identity = await assertClusterIdentity(maintenance, target)
    summary.server_version = identity.version

    const exists = await databaseExists(maintenance, target.database)
    let state = { exists: false, objects: 0, marker: false, guarded: false, migrations: 0 }
    if (exists) {
      const probe = await connect(target, { user: bootstrap.user, password, database: target.database }, 'schema inspection')
      try {
        state = await schemaState(probe)
        if (state.guarded) {
          throw new ProvisionError('The database contains bar_local.test_guard. This is a test database and must never be provisioned for production.')
        }
        if (state.objects > 0 && !upgrade) {
          throw new ProvisionError('The database already contains a non-empty bar_local schema. Re-run with BAR_LOCAL_PROVISION_UPGRADE=1 only after reviewing the upgrade.')
        }
        if (state.objects > 0) {
          const existingMarker = await readMarker(probe)
          if (existingMarker) {
            if (normalizePath(existingMarker.pg_data_dir) !== normalizePath(target.dataDir) ||
                existingMarker.database_name !== target.database) {
              throw new ProvisionError('The database provision marker belongs to a different data directory or database. Refusing to adopt it.')
            }
            marker = existingMarker
          } else {
            await assertAppliedMigrationsMatch(probe)
            console.warn('warning: adopting an existing bar_local schema without a provision marker after checksum verification.')
          }
        }
      } finally {
        await probe.end().catch(() => {})
      }
    }

    await ensureRole(maintenance, target.migratorUser, target.migratorPassword)
    await ensureRole(maintenance, target.runtimeUser, target.runtimePassword)

    const replicationUser = optional('BAR_LOCAL_REPLICATION_USER')
    const replicationPassword = optional('BAR_LOCAL_REPLICATION_PASSWORD')
    if ((replicationUser && !replicationPassword) || (!replicationUser && replicationPassword)) {
      throw new ProvisionError('Set both BAR_LOCAL_REPLICATION_USER and BAR_LOCAL_REPLICATION_PASSWORD, or neither.')
    }
    if (replicationUser) {
      if (!ROLE_RE.test(replicationUser)) {
        throw new ProvisionError('BAR_LOCAL_REPLICATION_USER must be a valid unquoted PostgreSQL identifier.')
      }
      if (replicationPassword.length < 24) {
        throw new ProvisionError('The replication password must contain at least 24 characters.')
      }
      if (replicationUser === target.migratorUser || replicationUser === target.runtimeUser) {
        throw new ProvisionError('The replication role must be distinct from the migrator and runtime roles.')
      }
      await ensureRole(maintenance, replicationUser, replicationPassword, { replication: true })
      summary.replication_role = replicationUser
    }

    const databaseResult = await ensureDatabase(maintenance, target.database, target.migratorUser)
    summary.database_created = databaseResult.created
    const connectRoles = [target.migratorUser, target.runtimeUser]
    if (replicationUser) connectRoles.push(replicationUser)
    await grantDatabaseAccess(maintenance, target.database, connectRoles)
  } finally {
    await maintenance.end().catch(() => {})
  }

  const business = await connect(
    target,
    { user: target.migratorUser, password: target.migratorPassword, database: target.database },
    'migrations'
  )
  try {
    const state = await schemaState(business)
    if (state.objects > 0 && !upgrade && !marker) {
      // The maintenance connection checked first; this guards a concurrent change.
      throw new ProvisionError('The bar_local schema became non-empty during provisioning. Re-run with BAR_LOCAL_PROVISION_UPGRADE=1 after review.')
    }
    applied = await runMigrations(business, { log: (line) => console.log(line) })
    await ensureMarker(business, target)
    marker = await readMarker(business)
    if (!marker) throw new ProvisionError('The provision marker was not created.')
    setupSecret = await resolveSetupSecret()
    const secretHash = createHash('sha256').update(setupSecret.secret, 'utf8').digest('hex')
    seeded = await seedSetupSecret(business, secretHash)
    summary.setup_secret_file = setupSecret.file
    summary.setup_secret_generated = setupSecret.generated
    summary.setup_secret_seeded = seeded
    summary.migrations_applied = applied
  } finally {
    await business.end().catch(() => {})
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`provision failed: ${message}`)
  process.exitCode = 1
})
