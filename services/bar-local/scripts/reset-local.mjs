import pg from 'pg'
import { assertClusterIdentity, connectionConfig, loadTarget } from './lib/db-target.mjs'
import { resetSchema } from './lib/migrate.mjs'

const { Client } = pg

async function main() {
  const target = loadTarget({ maintenance: false })
  const user = process.env.BAR_LOCAL_MIGRATOR_USER || target.user
  const client = new Client(connectionConfig({ ...target, user }))
  await client.connect()
  try {
    await assertClusterIdentity(client, { ...target, user }, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    await resetSchema(client)
    console.log(`bar_local schema dropped from ${target.database}; run db:bootstrap to rebuild it`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`reset failed: ${error.message}`)
  process.exitCode = 1
})
