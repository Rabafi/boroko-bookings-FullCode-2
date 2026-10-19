import fs from 'node:fs'
import { Client } from 'pg'
import { readLunaDatabaseTarget, DisposableDatabaseBlocked } from './luna-disposable-database.mjs'

export function validateLedgerDisposableEnvironment(env = process.env) {
  const target = readLunaDatabaseTarget(env)
  if (target.expectedProjectRef !== 'repsrmlomedqrmrdsbga' || target.expectedDatabase !== 'postgres') {
    throw new DisposableDatabaseBlocked('Only repsrmlomedqrmrdsbga/postgres is approved.')
  }
  if (fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== 'oicgpknsmtvcsjacymum') {
    throw new DisposableDatabaseBlocked('Production link must remain oicgpknsmtvcsjacymum.')
  }
  const url = new URL(target.connectionString)
  if ((!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.com')) ||
      (!url.hostname.includes(target.expectedProjectRef) && !decodeURIComponent(url.username).includes(target.expectedProjectRef))) {
    throw new DisposableDatabaseBlocked('Connection host/user must identify the approved hosted project; no localhost fallback.')
  }
  if (url.pathname !== '/postgres') {
    throw new DisposableDatabaseBlocked('Approved disposable database URL must select postgres.')
  }
  if (!String(env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION || '').trim()) {
    throw new DisposableDatabaseBlocked('LUNA_REMEDIATION_LEDGER_STAFF_SESSION is required; no synthetic session is accepted.')
  }
  return { ...target, hostname: url.hostname }
}

export async function connectLedgerDisposableDatabase(env = process.env) {
  const target = validateLedgerDisposableEnvironment(env)
  const client = new Client({ connectionString: target.connectionString, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000 })
  try {
    await client.connect()
    const initial = (await client.query('select current_database() as database_name, current_user as database_user')).rows[0]
    if (initial.database_name !== 'postgres') throw new DisposableDatabaseBlocked('Connected database must be postgres.')
    // Explicit fixture role assumption for NOINHERIT CLI users. No GRANT or
    // client-role change is performed. Marker verification follows before DML.
    await client.query('set role postgres')
    const identity = (await client.query('select current_database() as database_name,current_user as database_user')).rows[0]
    if (identity.database_user !== 'postgres') throw new DisposableDatabaseBlocked('Approved fixture setup role assumption failed.')
    const marker = (await client.query('select marker,environment_kind,database_name,project_ref,allow_mutation from public.luna_remediation_db_marker where singleton=true')).rows
    if (marker.length !== 1 || marker[0].marker !== 'LUNA-REMEDIATION-DISPOSABLE-v1' || marker[0].environment_kind !== 'disposable' ||
        marker[0].database_name !== 'postgres' || marker[0].project_ref !== target.expectedProjectRef || marker[0].allow_mutation !== true) {
      throw new DisposableDatabaseBlocked('Exact disposable marker verification failed; mutation prohibited.')
    }
    return { client, identity: { ...identity, project_ref: target.expectedProjectRef }, marker_verified: true }
  } catch (error) {
    await client.end().catch(() => {})
    throw error instanceof DisposableDatabaseBlocked ? error : new DisposableDatabaseBlocked('Approved SQL connection/role/marker failed (' + (error?.code || 'connection') + '); server details suppressed.')
  }
}
