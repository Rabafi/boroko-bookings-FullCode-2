import pg from 'pg'
import { assertClusterIdentity, connectionConfig, loadTarget } from './lib/db-target.mjs'
import { runMigrations } from './lib/migrate.mjs'

const { Client } = pg

async function main() {
  const target = loadTarget({ maintenance: false })
  const user = process.env.BAR_LOCAL_MIGRATOR_USER || target.user
  const client = new Client(connectionConfig({ ...target, user }))
  await client.connect()
  try {
    await assertClusterIdentity(client, { ...target, user }, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    const applied = await runMigrations(client, { log: (line) => console.log(line) })
    console.log(`migrations complete: ${applied.length} applied`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`migrate failed: ${error.message}`)
  process.exitCode = 1
})
