#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

function usage(message) {
  if (message) console.error(`Recovery drill failed: ${message}`)
  console.error(`Usage:
  node scripts/run-supabase-recovery-drill.mjs \\
    --sql-root <unpacked-backup-sql-folder> \\
    --psql <path-to-psql.exe> \\
    --host <pooler-host> --port <port> --database <database> --user <user>

Set PGPASSWORD securely before running. This script never reads or writes a password file.`)
  process.exit(2)
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) return null
    args[flag.slice(2)] = value
  }
  return args
}

function requireFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} was not found: ${filePath}`)
  return filePath
}

function runPsql({ psqlPath, connection, filePath, label }) {
  console.log(`Restoring ${label}...`)
  const result = spawnSync(psqlPath, [
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    `--dbname=${connection.database}`,
    `--username=${connection.user}`,
    '-X',
    '-1',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    filePath
  ], {
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} restore exited with code ${result.status}.`)
}

function runPsqlCommand({ psqlPath, connection, sql, label }) {
  console.log(`Preparing ${label}...`)
  const result = spawnSync(psqlPath, [
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    `--dbname=${connection.database}`,
    `--username=${connection.user}`,
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql
  ], {
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} preparation exited with code ${result.status}.`)
}

async function restoreSchema({ schemaPath, connection }) {
  console.log('Restoring schema atomically...')
  const client = new pg.Client({
    host: connection.host,
    port: Number(connection.port),
    database: connection.database,
    user: connection.user,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000
  })

  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query(await import('node:fs/promises').then(({ readFile }) => readFile(schemaPath, 'utf8')))
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

const args = parseArgs(process.argv.slice(2))
if (!args) usage('Arguments must be supplied as --name value pairs.')

const required = ['sql-root', 'psql', 'host', 'port', 'database', 'user']
for (const name of required) {
  if (!args?.[name]) usage(`Missing --${name}.`)
}
if (!process.env.PGPASSWORD) usage('PGPASSWORD is not set.')

const sqlRoot = path.resolve(args['sql-root'])
const psqlPath = path.resolve(args.psql)
const files = {
  roles: requireFile(path.join(sqlRoot, 'roles.sql'), 'roles.sql'),
  schema: requireFile(path.join(sqlRoot, 'schema.sql'), 'schema.sql'),
  data: requireFile(path.join(sqlRoot, 'data.sql'), 'data.sql'),
  migrations: requireFile(path.join(sqlRoot, 'migration-history.sql'), 'migration-history.sql')
}
requireFile(psqlPath, 'psql executable')

const connection = {
  host: args.host,
  port: args.port,
  database: args.database,
  user: args.user
}

try {
  runPsql({ psqlPath, connection, filePath: files.roles, label: 'platform role settings' })
  await restoreSchema({ schemaPath: files.schema, connection })
  runPsql({ psqlPath, connection, filePath: files.data, label: 'Auth, Storage metadata, and business data' })
  runPsqlCommand({
    psqlPath,
    connection,
    label: 'migration-history storage',
    sql: `
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
    `
  })
  runPsql({ psqlPath, connection, filePath: files.migrations, label: 'migration history' })
  console.log('RECOVERY_RESTORE_COMPLETE')
} catch (error) {
  console.error(`RECOVERY_RESTORE_FAILED: ${error.message}`)
  process.exitCode = 1
}
