// Run the rollback-only public booking SQL acceptance against the explicitly
// verified LodgingOS disposable target. This script never applies migrations.
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  connectVerifiedDisposableDatabase,
  DisposableDatabaseBlocked
} from '../tests/helpers/luna-disposable-database.mjs'

let connected
try {
  connected = await connectVerifiedDisposableDatabase()
} catch (error) {
  if (error instanceof DisposableDatabaseBlocked) {
    console.error('BLOCKED public-booking-disposable: ' + error.message)
    console.error('The explicit disposable marker and database/project identity must pass before SQL acceptance runs.')
    process.exit(2)
  }
  throw error
}

const { client, identity } = connected
try {
  const sqlPath = fileURLToPath(new URL('../tests/public-tent-booking-acceptance.sql', import.meta.url))
  const sql = await fs.readFile(sqlPath, 'utf8')
  const results = await client.query(sql)
  const resultList = Array.isArray(results) ? results : [results]
  const summary = resultList.flatMap((result) => result?.rows || [])
    .find((row) => row.suite === 'public-tent-booking')
  if (!summary || !Number.isInteger(Number(summary.checks))) {
    throw new Error('public booking SQL acceptance did not return its suite summary')
  }
  console.log(`public-booking-disposable: ${summary.checks} SQL checks passed on verified disposable ${identity.projectRef}/${identity.databaseName}; the suite rolled back.`)
} catch (error) {
  await client.query('rollback').catch(() => {})
  console.error('public-booking-disposable: FAILED (' + (error?.code || 'SQL acceptance error') + '); server text and connection details are suppressed.')
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
