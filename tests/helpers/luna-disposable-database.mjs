import { Client } from 'pg'

const REQUIRED_MARKER = 'LUNA-REMEDIATION-DISPOSABLE-v1'
const APPROVED_PROJECT_REF = 'repsrmlomedqrmrdsbga'
const DENIED_PROJECT_REFS = [
  { ref: 'oicgpknsmtvcsjacymum', label: 'linked production project' },
  { ref: 'hwzkwdfmoeayophaktsq', label: 'historical project' }
]

function rejectKnownProjectTarget(value) {
  const normalized = String(value || '').toLowerCase()
  const denied = DENIED_PROJECT_REFS.find((entry) => normalized.includes(entry.ref))
  if (denied) throw new DisposableDatabaseBlocked('The ' + denied.label + ' is explicitly denied for remediation SQL tests.')
}

export class DisposableDatabaseBlocked extends Error {
  constructor(message) {
    super(message)
    this.name = 'DisposableDatabaseBlocked'
    this.exitCode = 2
  }
}

export function readLunaDatabaseTarget(env = process.env) {
  const connectionString = String(env.LUNA_REMEDIATION_TEST_DB_URL || '').trim()
  const marker = String(env.LUNA_REMEDIATION_TARGET_MARKER || '').trim()
  const expectedDatabase = String(env.LUNA_REMEDIATION_EXPECTED_DATABASE || '').trim()
  const expectedProjectRef = String(env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF || '').trim()
  if (!connectionString) throw new DisposableDatabaseBlocked('LUNA_REMEDIATION_TEST_DB_URL is required; no database fallback is permitted.')
  if (marker !== REQUIRED_MARKER) throw new DisposableDatabaseBlocked('LUNA_REMEDIATION_TARGET_MARKER must identify the verified disposable target.')
  if (!expectedDatabase || !expectedProjectRef) {
    throw new DisposableDatabaseBlocked('LUNA_REMEDIATION_EXPECTED_DATABASE and LUNA_REMEDIATION_EXPECTED_PROJECT_REF are required.')
  }

  rejectKnownProjectTarget(expectedProjectRef)
  rejectKnownProjectTarget(connectionString)

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new DisposableDatabaseBlocked('LUNA_REMEDIATION_TEST_DB_URL must be a valid PostgreSQL URL; credentials are never printed.')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new DisposableDatabaseBlocked('Only an explicit PostgreSQL URL is accepted for remediation SQL tests.')
  }
  if (parsed.pathname.slice(1) !== expectedDatabase) {
    throw new DisposableDatabaseBlocked('PostgreSQL URL database must match LUNA_REMEDIATION_EXPECTED_DATABASE.')
  }
  if (!parsed.username || !parsed.password) {
    throw new DisposableDatabaseBlocked('PostgreSQL URL must include explicit database credentials.')
  }
  try {
    decodeURIComponent(parsed.username)
    decodeURIComponent(parsed.password)
  } catch {
    throw new DisposableDatabaseBlocked('PostgreSQL URL credentials must use valid percent encoding; credentials are never printed.')
  }

  const queryEntries = [...parsed.searchParams.entries()]
  const unsupportedQuery = queryEntries.some(([key]) => key.toLowerCase() !== 'sslmode')
  const sslModes = queryEntries.filter(([key]) => key.toLowerCase() === 'sslmode')
  if (unsupportedQuery || sslModes.length > 1
    || (sslModes.length === 1 && !['require', 'verify-ca', 'verify-full'].includes(sslModes[0][1].toLowerCase()))) {
    throw new DisposableDatabaseBlocked('PostgreSQL URL query options are not allowed to override the verified connection settings.')
  }

  rejectKnownProjectTarget(parsed.hostname)

  const directProjectHost = parsed.hostname === `db.${APPROVED_PROJECT_REF}.supabase.co`
  const poolerHost = parsed.hostname.endsWith('.pooler.supabase.com')
    && decodeURIComponent(parsed.username).endsWith(`.${APPROVED_PROJECT_REF}`)
  if (!directProjectHost && !poolerHost) {
    throw new DisposableDatabaseBlocked('Database URL host and account must identify the approved LodgingOS remediation project.')
  }

  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(expectedProjectRef)) {
    throw new DisposableDatabaseBlocked('Expected disposable project reference has an invalid shape.')
  }
  if (expectedProjectRef !== APPROVED_PROJECT_REF) {
    throw new DisposableDatabaseBlocked('Expected project reference must match the approved LodgingOS remediation disposable project.')
  }
  return { connectionString, expectedDatabase, expectedProjectRef }
}

export function createVerifiedDisposableClient(env = process.env) {
  const target = readLunaDatabaseTarget(env)
  const parsed = new URL(target.connectionString)
  const client = new Client({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ssl: { rejectUnauthorized: true }
  })
  return { client, target }
}

export async function connectVerifiedDisposableDatabase(env = process.env) {
  const { client, target } = createVerifiedDisposableClient(env)
  try {
    await client.connect()
    const identity = (await client.query('select current_database() as database_name, current_user as database_user')).rows[0]
    if (identity.database_name !== target.expectedDatabase) {
      throw new DisposableDatabaseBlocked('Connected database name does not match LUNA_REMEDIATION_EXPECTED_DATABASE.')
    }
    const markerRelation = await client.query("select to_regclass('public.luna_remediation_db_marker') as marker_table")
    if (!markerRelation.rows[0]?.marker_table) {
      throw new DisposableDatabaseBlocked('Disposable marker table public.luna_remediation_db_marker is missing.')
    }
    const markerResult = await client.query('select singleton, marker, environment_kind, database_name, project_ref, allow_mutation from public.luna_remediation_db_marker where singleton is true')
    if (markerResult.rowCount !== 1) throw new DisposableDatabaseBlocked('Exactly one disposable database marker row is required.')
    const row = markerResult.rows[0]
    if (row.marker !== REQUIRED_MARKER
      || row.environment_kind !== 'disposable'
      || row.database_name !== target.expectedDatabase
      || row.project_ref !== target.expectedProjectRef
      || row.allow_mutation !== true) {
      throw new DisposableDatabaseBlocked('Database marker does not match the explicit disposable target identity and mutation authorization.')
    }
    return { client, identity: { databaseName: identity.database_name, databaseUser: identity.database_user, projectRef: row.project_ref } }
  } catch (error) {
    await client.end().catch(() => {})
    if (error instanceof DisposableDatabaseBlocked) throw error
    throw new DisposableDatabaseBlocked('Disposable database identity could not be verified (' + (error?.code || 'connection/marker error') + '); credentials and server details are suppressed.')
  }
}

export async function runReadOnlyDatabaseContract({ label, sql }) {
  const { client, identity } = await connectVerifiedDisposableDatabase()
  try {
    await client.query('begin read only')
    await client.query("set local statement_timeout = '30s'")
    await client.query(sql)
    await client.query('rollback')
    console.log(label + ': disposable database catalog contract passed for ' + identity.projectRef + '/' + identity.databaseName + ' (read-only).')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    console.error(label + ': FAILED (' + (error?.code || 'database contract error') + '); server text is suppressed to avoid exposing data.')
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}

export function reportBlocked(error) {
  if (!(error instanceof DisposableDatabaseBlocked)) return false
  console.error('BLOCKED: ' + error.message)
  process.exitCode = error.exitCode
  return true
}
