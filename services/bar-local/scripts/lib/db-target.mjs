import path from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const TEST_DB_RE = /^bar_local_test(?:_|$)/

function required(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable ${name} for the isolated local Bar database target.`)
  }
  return String(value).trim()
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase()
}

const FORBIDDEN_CONNECTION_VARS = ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_POOLER_URL']

function rejectHostedConnectionEnvironment() {
  for (const name of FORBIDDEN_CONNECTION_VARS) {
    if (process.env[name]) {
      throw new Error(`Refusing to connect: ${name} is set. The local Bar service never uses a generic hosted/framework connection variable.`)
    }
  }
  if (process.env.PGHOST && !LOOPBACK_HOSTS.has(process.env.PGHOST.toLowerCase())) {
    throw new Error('Refusing to connect: PGHOST points outside loopback; unset it before running local Bar tooling.')
  }
  if (process.env.SUPABASE_PROJECT_REF && !process.env.BAR_LOCAL_TEST_DB) {
    throw new Error('Refusing to connect: a Supabase project reference is present without explicit local test opt-in.')
  }
}

export function loadTarget({ maintenance = false } = {}) {
  if (process.env.BAR_LOCAL_TEST_DB !== '1') {
    throw new Error('Refusing to connect: set BAR_LOCAL_TEST_DB=1 and use only an isolated local test cluster.')
  }
  rejectHostedConnectionEnvironment()
  const host = required('BAR_LOCAL_DB_HOST')
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
    throw new Error('Refusing to connect: BAR_LOCAL_DB_HOST must be a loopback host for automated local tests.')
  }
  const port = Number(required('BAR_LOCAL_DB_PORT'))
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error('Refusing to connect: BAR_LOCAL_DB_PORT must be an explicit non-default TCP port.')
  }
  const database = maintenance ? 'postgres' : required('BAR_LOCAL_DB_NAME')
  if (maintenance && database !== 'postgres') {
    throw new Error('Bootstrap maintenance connections must target the postgres maintenance database.')
  }
  if (!maintenance && !TEST_DB_RE.test(database)) {
    throw new Error('Refusing to connect: BAR_LOCAL_DB_NAME must be a dedicated bar_local_test database name.')
  }
  const user = maintenance
    ? (process.env.BAR_LOCAL_BOOTSTRAP_USER || 'postgres').trim()
    : required('BAR_LOCAL_MIGRATOR_USER')
  if (/^(admin|root|service_role)$/i.test(user)) {
    throw new Error(`Refusing to connect: the database user ${user} is not permitted for the local Bar service.`)
  }
  if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
    throw new Error('Refusing to connect: generic hosted database connection variables are not used by the local Bar runner.')
  }
  return {
    host,
    port,
    database,
    user,
    password: process.env.BAR_LOCAL_DB_PASSWORD || undefined,
    clusterData: required('BAR_LOCAL_TEST_CLUSTER_DATA'),
    maintenance
  }
}

export function connectionConfig(target) {
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    application_name: target.maintenance ? 'bar-local-bootstrap' : 'bar-local-migrate',
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000
  }
}

export async function assertClusterIdentity(client, target, { allowUnreadableDataDirectory = false, allowAbsentMarker = false } = {}) {
  let dataDirectory = null
  try {
    dataDirectory = (await client.query('SHOW data_directory')).rows[0].data_directory
  } catch (error) {
    if (!allowUnreadableDataDirectory) throw error
  }
  if (dataDirectory && normalizePath(dataDirectory) !== normalizePath(target.clusterData)) {
    throw new Error(`Refusing to operate: connected cluster data directory ${dataDirectory} does not match BAR_LOCAL_TEST_CLUSTER_DATA.`)
  }
  const serverPort = Number.parseInt((await client.query('SHOW port')).rows[0].port, 10)
  if (serverPort !== target.port) {
    throw new Error(`Refusing to operate: connected server port ${serverPort} does not match the requested port ${target.port}.`)
  }
  const address = (await client.query('SELECT inet_server_addr()::text AS address')).rows[0].address
  const addressHost = address ? address.split('/')[0].toLowerCase() : null
  if (addressHost && !LOOPBACK_HOSTS.has(addressHost)) {
    throw new Error(`Refusing to operate: connected server address ${address} is not loopback.`)
  }
  const marker = await client.query("SELECT to_regclass('bar_local.test_guard') AS marker")
  if (marker.rows[0].marker) {
    const guard = await client.query('SELECT cluster_identity FROM bar_local.test_guard WHERE singleton')
    if (!guard.rowCount) {
      if (!allowAbsentMarker) {
        throw new Error('Refusing to operate: the local test database is missing its cluster identity marker.')
      }
    } else if (normalizePath(guard.rows[0].cluster_identity) !== normalizePath(target.clusterData)) {
      throw new Error('Refusing to operate: the database test-guard marker belongs to a different cluster data directory.')
    }
  } else if (!allowAbsentMarker) {
    throw new Error('Refusing to operate: the local test database has no test-guard marker table.')
  }
  const serverVersion = (await client.query('SHOW server_version')).rows[0].server_version
  return { dataDirectory, port: serverPort, serverVersion, address }
}
