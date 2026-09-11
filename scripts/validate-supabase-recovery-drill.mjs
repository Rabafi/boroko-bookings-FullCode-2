#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

function usage(message) {
  if (message) console.error(`Recovery validation failed: ${message}`)
  console.error(`Usage:
  node scripts/validate-supabase-recovery-drill.mjs \\
    --sql-root <unpacked-backup-sql-folder> \\
    --host <pooler-host> --port <port> --database <database> --user <user>

Set PGPASSWORD securely before running. The validator reports counts only; it never prints customer, Auth, or financial records.`)
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

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function parseCopyRowCounts(dump) {
  const counts = new Map()
  let active = null

  for (const line of dump.split(/\r?\n/)) {
    const copy = line.match(/^COPY "([^"]+)"\."([^"]+)" \(/)
    if (copy) {
      active = { schema: copy[1], table: copy[2], count: 0 }
      continue
    }
    if (!active) continue
    if (line === '\\.') {
      counts.set(`${active.schema}.${active.table}`, active)
      active = null
    } else {
      active.count += 1
    }
  }

  if (active) throw new Error(`Unterminated COPY block for ${active.schema}.${active.table}.`)
  return [...counts.values()]
}

async function countTables(client, entries) {
  const actual = new Map()
  const chunkSize = 75

  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize)
    const query = chunk.map(({ schema, table }) => (
      `select '${schema.replaceAll("'", "''")}' as schema_name, '${table.replaceAll("'", "''")}' as table_name, count(*)::text as row_count from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    )).join(' union all ')
    const result = await client.query(query)
    for (const row of result.rows) actual.set(`${row.schema_name}.${row.table_name}`, Number(row.row_count))
  }

  return actual
}

const args = parseArgs(process.argv.slice(2))
if (!args) usage('Arguments must be supplied as --name value pairs.')
for (const name of ['sql-root', 'host', 'port', 'database', 'user']) {
  if (!args?.[name]) usage(`Missing --${name}.`)
}
if (!process.env.PGPASSWORD) usage('PGPASSWORD is not set.')

const sqlRoot = path.resolve(args['sql-root'])
const dataPath = path.join(sqlRoot, 'data.sql')
const schemaPath = path.join(sqlRoot, 'schema.sql')

try {
  const [dataDump, schemaDump] = await Promise.all([
    readFile(dataPath, 'utf8'),
    readFile(schemaPath, 'utf8')
  ])
  const expectedTables = parseCopyRowCounts(dataDump)
  const expectedPublicTables = (schemaDump.match(/^CREATE TABLE(?: IF NOT EXISTS)? "public"\./gm) ?? []).length
  const expectedPublicPolicies = (schemaDump.match(/^CREATE POLICY /gm) ?? []).length

  const client = new pg.Client({
    host: args.host,
    port: Number(args.port),
    database: args.database,
    user: args.user,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000
  })

  try {
    await client.connect()
    const actualRows = await countTables(client, expectedTables)
    const structure = await client.query(`
      select
        (select count(*)::int from pg_tables where schemaname = 'public') as public_tables,
        (select count(*)::int from pg_policies where schemaname = 'public') as public_policies
    `)
    const mismatches = expectedTables
      .filter(({ schema, table, count }) => actualRows.get(`${schema}.${table}`) !== count)
      .map(({ schema, table, count }) => ({
        table: `${schema}.${table}`,
        expected_rows: count,
        actual_rows: actualRows.get(`${schema}.${table}`) ?? null
      }))

    const report = {
      recovery_validation_passed: mismatches.length === 0
        && structure.rows[0].public_tables === expectedPublicTables
        && structure.rows[0].public_policies === expectedPublicPolicies,
      tables_checked: expectedTables.length,
      row_count_mismatches: mismatches,
      expected_public_tables: expectedPublicTables,
      actual_public_tables: structure.rows[0].public_tables,
      expected_public_policies: expectedPublicPolicies,
      actual_public_policies: structure.rows[0].public_policies
    }
    console.log(JSON.stringify(report, null, 2))
    if (!report.recovery_validation_passed) process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
} catch (error) {
  console.error(`RECOVERY_VALIDATION_FAILED: ${error.message}`)
  process.exitCode = 1
}
