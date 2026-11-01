import pg from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { assertClusterIdentity, connectionConfig, loadTarget } from '../scripts/lib/db-target.mjs'
import { resetSchema, runMigrations, seedSetupSecret, seedTestGuard } from '../scripts/lib/migrate.mjs'
import { loadConfig } from '../dist/config.js'
import { startServer } from '../dist/server.js'
import { createHttpServer } from '../dist/server.js'
import { createApp } from '../dist/app.js'
import { createPool, closePool } from '../dist/db.js'
import { createCloudSyncController } from '../dist/operations/cloudSync.js'
import { createFailoverController } from '../dist/operations/failover.js'
import { TEST_SETUP_SECRET, TEST_SETUP_SECRET_HASH } from './harness.mjs'

const { Client } = pg

export async function createApiHarness(t, { env = {}, testOnlyWitnessController = false } = {}) {
  const target = loadTarget()
  const migratorUser = process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator'
  const runtimeUser = process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime'
  const migrator = new Client(connectionConfig({ ...target, user: migratorUser, maintenance: false }))
  await migrator.connect()
  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true })
  await resetSchema(migrator)
  await runMigrations(migrator)
  await seedTestGuard(migrator, target.clusterData)
  await seedSetupSecret(migrator, TEST_SETUP_SECRET_HASH)
  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true })

  const config = loadConfig({
    BAR_LOCAL_ALLOW_TEST_DB: '1',
    BAR_LOCAL_SETUP_SECRET: TEST_SETUP_SECRET,
    BAR_LOCAL_HTTP_HOST: '127.0.0.1',
    BAR_LOCAL_DB_HOST: target.host,
    BAR_LOCAL_DB_PORT: String(target.port),
    BAR_LOCAL_DB_NAME: target.database,
    BAR_LOCAL_RUNTIME_USER: runtimeUser,
    BAR_LOCAL_RUNTIME_PASSWORD: process.env.BAR_LOCAL_RUNTIME_PASSWORD ?? process.env.BAR_LOCAL_DB_PASSWORD,
    BAR_LOCAL_SESSION_TTL_SECONDS: '3600',
    BAR_LOCAL_PIN_ITERATIONS: '100000',
    ...env
  })
  // This intentionally bypasses the production witness-mode refusal solely
  // to exercise the unfinished controller and HTTP integration in isolation.
  // It must never be used as a service startup path.
  let running
  if (testOnlyWitnessController) {
    if (config.failover.mode !== 'witness') throw new Error('Test-only witness harness requires witness mode')
    const logger = { info() {}, error() {} }
    const pool = createPool(config)
    const cloudSync = createCloudSyncController({ config, pool, logger })
    const failover = createFailoverController({ config, pool, logger })
    const server = createHttpServer(config, createApp({ config, pool, logger, cloudSync, failover }))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, config.http.host, () => { server.off('error', reject); resolve() })
    })
    cloudSync.start()
    failover.start()
    running = { server, pool, config, failover, async close() {
      await failover.stop()
      await cloudSync.stop()
      const closed = new Promise((resolve) => server.close(resolve))
      await closed
      await closePool(pool)
    } }
  } else {
    running = await startServer({ config, port: 0, logger: { info() {}, error() {} } })
  }
  const address = running.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  t.after(async () => {
    await running.close()
    await migrator.end()
  })

  async function request(path, { method = 'POST', body, rawBody, token, deviceId, deviceToken, headers = {}, stageProvisioning = true } = {}) {
    let stagedDeviceToken = null
    if (stageProvisioning && body && typeof body === 'object' && !Array.isArray(body)
      && (path === '/v1/setup/owner' || path === '/v1/pairing/complete')) {
      body = { ...body }
      body.provisioning_id ??= randomUUID()
      body.device_token ??= `bld_${randomBytes(32).toString('base64url')}`
      stagedDeviceToken = body.device_token
    }
    const requestHeaders = { ...headers }
    if (body !== undefined || rawBody !== undefined) requestHeaders['content-type'] = 'application/json'
    if (token) requestHeaders.authorization = `Bearer ${token}`
    if (deviceId) requestHeaders['x-bar-device-id'] = deviceId
    if (deviceToken) requestHeaders['x-bar-device-token'] = deviceToken
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: response.status, body: json, headers: response.headers, stagedDeviceToken }
  }

  return {
    target,
    migrator,
    config,
    running,
    baseUrl,
    request,
    close: async () => { await running.close() }
  }
}
