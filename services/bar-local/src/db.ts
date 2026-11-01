import pg from 'pg'
import type { Pool, QueryResult, QueryResultRow } from 'pg'
import { mapDatabaseError } from './errors.js'
import type { ServiceConfig } from './config.js'

const { Pool: PgPool } = pg

export interface FunctionArgument {
  value: unknown
  cast?: string
}

export type JsonRecord = Record<string, unknown>

export function createPool(config: ServiceConfig): Pool {
  const pool = new PgPool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password ?? undefined,
    max: config.db.max,
    application_name: 'bar-local-service',
    options: `-c statement_timeout=${config.db.statementTimeoutMs} -c lock_timeout=${config.db.lockTimeoutMs} -c idle_in_transaction_session_timeout=30000`,
    allowExitOnIdle: false
  })
  pool.on('error', () => {
    // Idle-client failures are surfaced on the next query; logging here would
    // risk leaking connection details from the driver.
  })
  return pool
}

function placeholders(args: readonly FunctionArgument[]): string {
  return args.map((arg, index) => {
    const position = `$${index + 1}`
    return arg.cast ? `${position}::${arg.cast}` : position
  }).join(',')
}

export async function query<T extends QueryResultRow = QueryResultRow>(pool: Pool, text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, params as unknown[])
  } catch (error) {
    throw mapDatabaseError(error)
  }
}

export async function callFunction<T = unknown>(pool: Pool, functionName: string, args: readonly FunctionArgument[]): Promise<T | null> {
  if (!/^bar_local\.[a-z_][a-z0-9_]*$/.test(functionName)) {
    throw new Error('Invalid local database function name.')
  }
  const sql = `SELECT ${functionName}(${placeholders(args)}) AS result`
  const result = await query(pool, sql, args.map((arg) => arg.value))
  return (result.rows[0]?.result as T | undefined) ?? null
}

export async function assertDatabaseReachable(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function closePool(pool: Pool): Promise<void> {
  try {
    await pool.end()
  } catch {
    // Shutdown is best effort; the process exit closes remaining sockets.
  }
}
